/**
 * PhysicsWorld — owns the bodies, runs the fixed-timestep simulation and
 * glues detection + resolution into a stable pipeline.
 *
 * Pipeline (per fixed step `dt`):
 *   1. integrate forces   — gravity + accumulated forces -> velocity
 *   2. sync transforms    — recompute world vertices/normals/AABBs
 *   3. broad phase        — AABB overlap pairs (brute force, fine for <200 bodies)
 *   4. narrow phase       — build manifolds (SAT / circle tests)
 *   5. solve constraints  — `iterations` passes of joint constraint impulses
 *   6. solve contacts     — `iterations` passes of contact impulses (normal+friction)
 *   7. integrate velocity — position += velocity * dt
 *   8. position correction— Baumgarte stabilization for contacts + joints
 *   9. sync again         — so the renderer sees a consistent frame
 *
 * Kinematic bodies (mouse grab) are driven externally: the caller sets their
 * position + velocity each frame; the solver treats them as infinitely massive
 * so they push dynamic bodies but are never pushed back.
 *
 * CCD (continuous collision detection): if any body's per-frame displacement
 * exceeds a fraction of its size, the whole step is sub-stepped. This prevents
 * fast projectiles ("bullets") from tunnelling through thin walls.
 */

import { Vec2 } from "./vector";
import { RigidBody } from "./body";
import { Manifold, detect } from "./manifold";
import { Constraint } from "./constraints";

export interface WorldSettings {
  gravity: Vec2;
  iterations: number;
  /** velocity retained per second (0.999 -> ~0.001 loss/sec scale) */
  linearDamping: number;
  angularDamping: number;
  /** max linear speed to avoid explosions on bad solver states */
  maxSpeed: number;
  /** enable CCD substepping for fast-moving bodies */
  ccdEnabled: boolean;
  /** max displacement per substep as a fraction of body radius (CCD) */
  ccdThreshold: number;
}

export interface WorldStats {
  bodyCount: number;
  dynamicCount: number;
  contactCount: number;
  constraintCount: number;
  pairTests: number;
  substeps: number;
}

const SLOP = 0.05; // penetration allowance before position correction kicks in
const CORRECTION_PERCENT = 0.4; // fraction of penetration to correct per step

export class PhysicsWorld {
  bodies: RigidBody[] = [];
  manifolds: Manifold[] = [];
  constraints: Constraint[] = [];
  settings: WorldSettings;
  /** read by the renderer: how many substeps ran this `step()` */
  lastSubsteps = 1;

  constructor(settings?: Partial<WorldSettings>) {
    this.settings = {
      gravity: new Vec2(0, 980),
      iterations: 10,
      linearDamping: 0.4, // applied as pow(damping, dt) -> very mild
      angularDamping: 0.4,
      maxSpeed: 4000,
      ccdEnabled: true,
      ccdThreshold: 0.5,
      ...settings,
    };
  }

  add(body: RigidBody): RigidBody {
    this.bodies.push(body);
    return body;
  }

  addConstraint(c: Constraint): Constraint {
    this.constraints.push(c);
    return c;
  }

  remove(body: RigidBody): void {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    // also drop any constraints referencing it
    this.constraints = this.constraints.filter((c) => c.bodyA !== body && c.bodyB !== body);
  }

  removeConstraint(c: Constraint): void {
    const i = this.constraints.indexOf(c);
    if (i >= 0) this.constraints.splice(i, 1);
  }

  clear(): void {
    this.bodies = [];
    this.manifolds = [];
    this.constraints = [];
  }

  clearDynamic(): void {
    this.bodies = this.bodies.filter((b) => b.isStatic);
    this.manifolds = [];
    this.constraints = this.constraints.filter((c) => c.bodyA.isStatic && (c.bodyB == null || c.bodyB.isStatic));
  }

  /** live-update gravity (vertical component) */
  setGravityY(y: number): void {
    this.settings.gravity.y = y;
  }

  /** live-update material props on every dynamic body */
  applyMaterial(restitution: number, friction: number): void {
    for (const b of this.bodies) {
      if (b.isStatic) continue;
      b.restitution = restitution;
      b.staticFriction = Math.min(friction * 1.3, 1);
      b.dynamicFriction = friction;
    }
  }

  /** swap out all static bodies (used when the viewport is resized) */
  replaceStaticBodies(newStatic: RigidBody[]): void {
    this.bodies = this.bodies.filter((b) => !b.isStatic);
    for (const s of newStatic) this.bodies.push(s);
  }

  step(dt: number): WorldStats {
    const s = this.settings;

    // --- determine substep count for CCD ---
    // if any body moves more than ccdThreshold * itsSize in one step, subdivide
    let substeps = 1;
    if (s.ccdEnabled) {
      let maxRatio = 0;
      for (const b of this.bodies) {
        if (b.isStatic || b.kinematic) continue;
        const size =
          b.shape.kind === "circle"
            ? (b.shape as { radius: number }).radius
            : Math.min(b.shape.halfExtents.x, b.shape.halfExtents.y) * 2;
        const disp = b.velocity.len() * dt;
        if (size > 0) {
          const ratio = disp / size;
          if (ratio > maxRatio) maxRatio = ratio;
        }
      }
      if (maxRatio > s.ccdThreshold) {
        substeps = Math.min(8, Math.ceil(maxRatio / s.ccdThreshold));
      }
    }
    this.lastSubsteps = substeps;
    const h = dt / substeps;

    let totalPairs = 0;
    for (let sub = 0; sub < substeps; sub++) {
      totalPairs = this.substep(h);
    }

    // final NaN guard
    for (const b of this.bodies) {
      if (
        Number.isNaN(b.position.x) ||
        Number.isNaN(b.position.y) ||
        Number.isNaN(b.angle)
      ) {
        b.position.set(0, 0);
        b.velocity.set(0, 0);
        b.angularVelocity = 0;
      }
    }

    return {
      bodyCount: this.bodies.length,
      dynamicCount: this.bodies.filter((b) => !b.isStatic).length,
      contactCount: this.manifolds.length,
      constraintCount: this.constraints.length,
      pairTests: totalPairs,
      substeps,
    };
  }

  private substep(dt: number): number {
    const s = this.settings;

    // 1. integrate forces -> velocity (gravity + damping)
    for (const b of this.bodies) {
      if (b.isStatic || b.kinematic) continue;
      b.velocity.iaddMul(s.gravity, dt);
      b.velocity.iaddMul(b.force, b.invMass * dt);
      b.angularVelocity += b.torque * b.invInertia * dt;
      b.force.set(0, 0);
      b.torque = 0;

      const ld = Math.pow(s.linearDamping, dt);
      const ad = Math.pow(s.angularDamping, dt);
      b.velocity.imul(ld);
      b.angularVelocity *= ad;

      const sp2 = b.velocity.lenSq();
      if (sp2 > s.maxSpeed * s.maxSpeed) {
        b.velocity.imul(s.maxSpeed / Math.sqrt(sp2));
      }
    }

    // 2. sync transforms
    for (const b of this.bodies) b.sync();

    // 3. broad phase
    const pairs = this.broadphase();

    // 4. narrow phase
    this.manifolds.length = 0;
    for (const [a, b] of pairs) {
      const m = detect(a, b);
      if (m) this.manifolds.push(m);
    }

    // 5. prepare + solve constraints (joints first, then contacts, interleaved)
    for (const c of this.constraints) c.prepare(dt);

    for (let iter = 0; iter < s.iterations; iter++) {
      // joints before contacts each iteration (keeps welded structures rigid)
      for (const c of this.constraints) c.solveVelocity();
      for (const m of this.manifolds) this.resolve(m);
    }

    // 6. integrate velocity -> position
    for (const b of this.bodies) {
      if (b.isStatic || b.kinematic) continue;
      b.position.iaddMul(b.velocity, dt);
      b.angle += b.angularVelocity * dt;
    }

    // 7. position correction (contacts + joints)
    for (const c of this.constraints) c.solvePosition();
    for (const m of this.manifolds) this.positionalCorrection(m);

    // 8. final sync
    for (const b of this.bodies) b.sync();

    return pairs.length;
  }

  // -------------------------------------------------------------------
  // broad phase — brute-force AABB overlap (O(n²)). Good enough for a
  // sandbox with a few hundred bodies; trivially correct & dependency-free.
  // -------------------------------------------------------------------
  private broadphase(): [RigidBody, RigidBody][] {
    const pairs: [RigidBody, RigidBody][] = [];
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      const a = this.bodies[i];
      for (let j = i + 1; j < n; j++) {
        const b = this.bodies[j];
        // two static bodies never collide
        if (a.isStatic && b.isStatic) continue;
        // two kinematic bodies don't interact usefully
        if (a.kinematic && b.kinematic) continue;
        if (aabbOverlap(a.aabb, b.aabb)) {
          pairs.push([a, b]);
        }
      }
    }
    return pairs;
  }

  // -------------------------------------------------------------------
  // resolution — impulse-based, per contact point
  // -------------------------------------------------------------------
  private resolve(m: Manifold): void {
    const a = m.bodyA;
    const b = m.bodyB;
    const imA = a.solverInvMass;
    const imB = b.solverInvMass;
    if (imA === 0 && imB === 0) return;

    const n = m.normal;
    const count = Math.max(1, m.contacts.length);

    for (const c of m.contacts) {
      const ra = c.point.sub(a.position);
      const rb = c.point.sub(b.position);

      // relative velocity at contact (incl. angular)
      const va = a.velocity.add(ra.crossScalar(a.angularVelocity));
      const vb = b.velocity.add(rb.crossScalar(b.angularVelocity));
      const rv = vb.sub(va);

      const velAlongNormal = rv.dot(n);
      // separating -> no impulse (skip, but still allow other contacts)
      if (velAlongNormal > 0) continue;

      const raCrossN = ra.cross(n);
      const rbCrossN = rb.cross(n);
      const invMassSum =
        imA + imB + raCrossN * raCrossN * a.solverInvInertia + rbCrossN * rbCrossN * b.solverInvInertia;
      if (invMassSum === 0) continue;

      // normal impulse (scalar), distributed across contact points
      let j = (-(1 + m.e) * velAlongNormal) / invMassSum / count;
      const impulse = n.mul(j);
      a.applyImpulse(impulse.neg(), ra);
      b.applyImpulse(impulse, rb);

      // ---- friction (tangential) ----
      // recompute relative velocity after the normal impulse
      const va2 = a.velocity.add(ra.crossScalar(a.angularVelocity));
      const vb2 = b.velocity.add(rb.crossScalar(b.angularVelocity));
      const rv2 = vb2.sub(va2);

      let tangent = rv2.sub(n.mul(rv2.dot(n)));
      const tLen = tangent.len();
      if (tLen < 1e-6) continue;
      tangent = tangent.mul(1 / tLen);

      const raCrossT = ra.cross(tangent);
      const rbCrossT = rb.cross(tangent);
      const invMassSumT =
        imA + imB + raCrossT * raCrossT * a.solverInvInertia + rbCrossT * rbCrossT * b.solverInvInertia;
      if (invMassSumT === 0) continue;

      let jt = -rv2.dot(tangent) / invMassSumT / count;

      // Coulomb friction cone
      const frictionLimit = j * m.df;
      if (Math.abs(jt) > frictionLimit) jt = (Math.sign(jt) * frictionLimit);

      const tImpulse = tangent.mul(jt);
      a.applyImpulse(tImpulse.neg(), ra);
      b.applyImpulse(tImpulse, rb);
    }
  }

  private positionalCorrection(m: Manifold): void {
    const a = m.bodyA;
    const b = m.bodyB;
    const imA = a.solverInvMass;
    const imB = b.solverInvMass;
    const invSum = imA + imB;
    if (invSum === 0) return;

    // use the deepest contact for the correction depth
    let deepest = 0;
    for (const c of m.contacts) if (c.penetration > deepest) deepest = c.penetration;

    const correctionMag = Math.max(deepest - SLOP, 0) / invSum * CORRECTION_PERCENT;
    const correction = m.normal.mul(correctionMag);
    a.position.isub(correction.mul(imA));
    b.position.iadd(correction.mul(imB));
  }
}

function aabbOverlap(a: { min: Vec2; max: Vec2 }, b: { min: Vec2; max: Vec2 }): boolean {
  return !(
    a.max.x < b.min.x ||
    a.min.x > b.max.x ||
    a.max.y < b.min.y ||
    a.min.y > b.max.y
  );
}
