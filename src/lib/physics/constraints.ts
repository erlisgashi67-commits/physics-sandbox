/**
 * Constraints & Joints — sequential-impulse constraint solver.
 *
 * A constraint is an equation C(state) = 0 that the solver drives toward zero
 * each step by applying impulses. This is the same mathematical framework
 * Box2D uses (Erin Catto / Randy Gaul), just hand-rolled for 2D.
 *
 * Each constraint implements:
 *   - `prepare()`      compute the Jacobian / effective mass for this step
 *   - `solveVelocity()` apply the corrective impulse (called N times/step)
 *   - `solvePosition()` project positions back toward C = 0 (Baumgarte-style)
 *
 * Joint types provided:
 *   - DistanceJoint   keep two anchors a fixed distance apart (a rod / rope)
 *   - PinJoint        keep two anchors coincident (a hinge / pivot)
 *   - WeldJoint       lock two bodies together (position + angle)
 *   - MotorJoint      drive the relative angle toward a target (a servo)
 *
 * Anchors are stored in each body's LOCAL space so the constraint stays
 * correct as the bodies rotate.
 */

import { Vec2 } from "./vector";
import { RigidBody } from "./body";

const POSITION_BIAS = 0.2; // Baumgarte position correction strength
const POSITION_SLOP = 0.01; // allowed drift before correction kicks in

export abstract class Constraint {
  /** two bodies involved (bodyB may be null for a world-space anchor) */
  abstract readonly bodyA: RigidBody;
  abstract readonly bodyB: RigidBody | null;
  /** solve order weight (lower = solved first); joints before contacts */
  weight = 0;
  /** warm-started accumulated impulse (subclasses store their own) */
  abstract prepare(dt: number): void;
  abstract solveVelocity(): void;
  abstract solvePosition(): void;
  /** whether this constraint still has two live bodies (for cleanup) */
  abstract get valid(): boolean;
}

// helper: world-space position of a local-space anchor on a body
function worldPoint(body: RigidBody, local: Vec2): Vec2 {
  const c = Math.cos(body.angle);
  const s = Math.sin(body.angle);
  return new Vec2(
    local.x * c - local.y * s + body.position.x,
    local.x * s + local.y * c + body.position.y,
  );
}

// ---------------------------------------------------------------------------
// Distance joint — |pB - pA| = L  (one scalar constraint)
// ---------------------------------------------------------------------------
export class DistanceJoint extends Constraint {
  readonly bodyA: RigidBody;
  readonly bodyB: RigidBody;
  localA: Vec2;
  localB: Vec2;
  length: number;
  /** spring softness (0 = rigid, higher = softer). uses Catto frequency/damping */
  frequencyHz = 0; // 0 means rigid (no softness)
  dampingRatio = 1;

  // accumulated impulse (warm start)
  private imp = 0;
  private effectiveMass = 0;
  private bias = 0;
  private n = new Vec2(1, 0);
  private rA = new Vec2();
  private rB = new Vec2();

  constructor(
    a: RigidBody,
    b: RigidBody,
    worldAnchorA: Vec2,
    worldAnchorB: Vec2,
    opts: { length?: number; frequencyHz?: number; dampingRatio?: number } = {},
  ) {
    super();
    this.bodyA = a;
    this.bodyB = b;
    this.localA = worldAnchorA.sub(a.position).rotate(-a.angle);
    this.localB = worldAnchorB.sub(b.position).rotate(-b.angle);
    this.length = opts.length ?? worldAnchorA.sub(worldAnchorB).len();
    if (opts.frequencyHz != null) this.frequencyHz = opts.frequencyHz;
    if (opts.dampingRatio != null) this.dampingRatio = opts.dampingRatio;
  }

  get valid(): boolean {
    return (
      this.bodyA != null && this.bodyB != null
    );
  }

  prepare(_dt: number): void {
    const a = this.bodyA;
    const b = this.bodyB;
    const pA = worldPoint(a, this.localA);
    const pB = worldPoint(b, this.localB);
    this.rA = pA.sub(a.position);
    this.rB = pB.sub(b.position);
    const d = pB.sub(pA);
    const dist = d.len();
    this.n = dist > 1e-9 ? d.mul(1 / dist) : new Vec2(1, 0);

    const imA = a.solverInvMass;
    const imB = b.solverInvMass;
    const iiA = a.solverInvInertia;
    const iiB = b.solverInvInertia;
    const rAcrossN = this.rA.cross(this.n);
    const rBcrossN = this.rB.cross(this.n);
    const k =
      imA + imB + rAcrossN * rAcrossN * iiA + rBcrossN * rBcrossN * iiB;

    // soft constraint (Catto 2011) — gives a springy rod when frequencyHz > 0
    if (this.frequencyHz > 0 && k > 0) {
      const w = 2 * Math.PI * this.frequencyHz;
      const ww = w * w;
      const c = 2 * this.dampingRatio * w;
      this.effectiveMass = 1 / (k + _dt * c + _dt * _dt * ww);
      const C = dist - this.length;
      this.bias = ww * _dt * C;
    } else {
      this.effectiveMass = k > 0 ? 1 / k : 0;
      this.bias = 0;
    }

    // warm start
    const P = this.n.mul(this.imp);
    a.applyImpulse(P.neg(), this.rA);
    b.applyImpulse(P, this.rB);
  }

  solveVelocity(): void {
    const a = this.bodyA;
    const b = this.bodyB;
    const vA = a.velocity.add(this.rA.crossScalar(a.angularVelocity));
    const vB = b.velocity.add(this.rB.crossScalar(b.angularVelocity));
    const Cdot = vB.sub(vA).dot(this.n);

    let lambda = this.effectiveMass * -(Cdot + this.bias + 0.1 * this.imp);
    this.imp += lambda;
    const P = this.n.mul(lambda);
    a.applyImpulse(P.neg(), this.rA);
    b.applyImpulse(P, this.rB);
  }

  solvePosition(): void {
    if (this.frequencyHz > 0) return; // soft joints self-correct via bias
    const a = this.bodyA;
    const b = this.bodyB;
    const pA = worldPoint(a, this.localA);
    const pB = worldPoint(b, this.localB);
    const d = pB.sub(pA);
    const dist = d.len();
    const C = dist - this.length;
    if (Math.abs(C) <= POSITION_SLOP) return;
    const n = dist > 1e-9 ? d.mul(1 / dist) : new Vec2(1, 0);
    const imA = a.solverInvMass;
    const imB = b.solverInvMass;
    const rA = pA.sub(a.position);
    const rB = pB.sub(b.position);
    const rAcrossN = rA.cross(n);
    const rBcrossN = rB.cross(n);
    const k =
      imA + imB + rAcrossN * rAcrossN * a.solverInvInertia + rBcrossN * rBcrossN * b.solverInvInertia;
    if (k === 0) return;
    let correction = (-POSITION_BIAS * C) / k;
    if (C > 0) correction = Math.min(correction, 0); // never push apart when too close... actually allow both
    const P = n.mul(correction);
    a.position.isub(P.mul(imA));
    b.position.iadd(P.mul(imB));
    // small angle correction from the torque the impulse would create
    a.angle -= rA.cross(P) * a.solverInvInertia * 0.1;
    b.angle += rB.cross(P) * b.solverInvInertia * 0.1;
  }
}

// ---------------------------------------------------------------------------
// Pin (hinge) joint — pB - pA = 0  (two scalar constraints: x and y)
// Allows the bodies to rotate freely around the shared anchor point.
// ---------------------------------------------------------------------------
export class PinJoint extends Constraint {
  readonly bodyA: RigidBody;
  readonly bodyB: RigidBody;
  localA: Vec2;
  localB: Vec2;

  private impx = 0;
  private impy = 0;
  private mass: number[] = [0, 0, 0]; // 2x2 effective mass (symmetric)
  private rA = new Vec2();
  private rB = new Vec2();
  private biasX = 0;
  private biasY = 0;

  constructor(
    a: RigidBody,
    b: RigidBody,
    worldAnchor: Vec2,
  ) {
    super();
    this.bodyA = a;
    this.bodyB = b;
    this.localA = worldAnchor.sub(a.position).rotate(-a.angle);
    this.localB = worldAnchor.sub(b.position).rotate(-b.angle);
  }

  get valid(): boolean {
    return this.bodyA != null && this.bodyB != null;
  }

  prepare(_dt: number): void {
    const a = this.bodyA;
    const b = this.bodyB;
    this.rA = worldPoint(a, this.localA).sub(a.position);
    this.rB = worldPoint(b, this.localB).sub(b.position);

    const imA = a.solverInvMass;
    const imB = b.solverInvMass;
    const iiA = a.solverInvInertia;
    const iiB = b.solverInvInertia;

    // 2x2 effective mass matrix K for the point constraint
    // K = [ imA+imB + iiA*rAy² + iiB*rBy²,    -(iiA*rAx*rAy + iiB*rBx*rBy) ]
    //     [ -(iiA*rAx*rAy + iiB*rBx*rBy),     imA+imB + iiA*rAx² + iiB*rBx² ]
    const k11 =
      imA + imB + iiA * this.rA.y * this.rA.y + iiB * this.rB.y * this.rB.y;
    const k22 =
      imA + imB + iiA * this.rA.x * this.rA.x + iiB * this.rB.x * this.rB.x;
    const k12 = -(iiA * this.rA.x * this.rA.y + iiB * this.rB.x * this.rB.y);

    // invert 2x2
    let det = k11 * k22 - k12 * k12;
    if (det !== 0) det = 1 / det;
    this.mass[0] = k22 * det;
    this.mass[1] = -k12 * det;
    this.mass[2] = k11 * det;

    // position bias (Baumgarte) — drives C = pB - pA toward zero
    const pA = a.position.add(this.rA);
    const pB = b.position.add(this.rB);
    const C = pB.sub(pA);
    this.biasX = -POSITION_BIAS * _dt * 60 * C.x;
    this.biasY = -POSITION_BIAS * _dt * 60 * C.y;

    // warm start
    const P = new Vec2(this.impx, this.impy);
    a.applyImpulse(P.neg(), this.rA);
    b.applyImpulse(P, this.rB);
  }

  solveVelocity(): void {
    const a = this.bodyA;
    const b = this.bodyB;
    const vA = a.velocity.add(this.rA.crossScalar(a.angularVelocity));
    const vB = b.velocity.add(this.rB.crossScalar(b.angularVelocity));
    const Cdot = vB.sub(vA);

    // lambda = -K⁻¹ · (Cdot + bias)
    let lambdaX = this.mass[0] * -(Cdot.x + this.biasX) + this.mass[1] * -(Cdot.y + this.biasY);
    let lambdaY = this.mass[1] * -(Cdot.x + this.biasX) + this.mass[2] * -(Cdot.y + this.biasY);

    this.impx += lambdaX;
    this.impy += lambdaY;

    const P = new Vec2(lambdaX, lambdaY);
    a.applyImpulse(P.neg(), this.rA);
    b.applyImpulse(P, this.rB);
  }

  solvePosition(): void {
    const a = this.bodyA;
    const b = this.bodyB;
    const rA = worldPoint(a, this.localA).sub(a.position);
    const rB = worldPoint(b, this.localB).sub(b.position);
    const C = b.position.add(rB).sub(a.position.add(rA));
    if (C.lenSq() <= POSITION_SLOP * POSITION_SLOP) return;

    const imA = a.solverInvMass;
    const imB = b.solverInvMass;
    const iiA = a.solverInvInertia;
    const iiB = b.solverInvInertia;
    const k11 = imA + imB + iiA * rA.y * rA.y + iiB * rB.y * rB.y;
    const k22 = imA + imB + iiA * rA.x * rA.x + iiB * rB.x * rB.x;
    const k12 = -(iiA * rA.x * rA.y + iiB * rB.x * rB.y);
    let det = k11 * k22 - k12 * k12;
    if (det === 0) return;
    det = 1 / det;
    const m11 = k22 * det;
    const m12 = -k12 * det;
    const m22 = k11 * det;

    let px = -POSITION_BIAS * (m11 * C.x + m12 * C.y);
    let py = -POSITION_BIAS * (m12 * C.x + m22 * C.y);

    a.position.isub(new Vec2(px * imA, py * imA));
    b.position.iadd(new Vec2(px * imB, py * imB));
    a.angle -= rA.cross(new Vec2(px, py)) * iiA;
    b.angle += rB.cross(new Vec2(px, py)) * iiB;
  }
}

// ---------------------------------------------------------------------------
// Weld joint — lock two bodies together (point + angle constraint)
// Combines a pin joint with an angular constraint.
// ---------------------------------------------------------------------------
export class WeldJoint extends Constraint {
  readonly bodyA: RigidBody;
  readonly bodyB: RigidBody;
  localA: Vec2;
  localB: Vec2;
  /** relative angle to maintain (b.angle - a.angle) */
  referenceAngle: number;

  private impx = 0;
  private impy = 0;
  private impAng = 0;
  private mass: number[] = [0, 0, 0, 0, 0, 0]; // 3x3 (symmetric) stored as [m11,m12,m13,m22,m23,m33]
  private rA = new Vec2();
  private rB = new Vec2();
  private biasX = 0;
  private biasY = 0;
  private biasAng = 0;
  private angMass = 0;

  constructor(a: RigidBody, b: RigidBody, worldAnchor: Vec2) {
    super();
    this.bodyA = a;
    this.bodyB = b;
    this.localA = worldAnchor.sub(a.position).rotate(-a.angle);
    this.localB = worldAnchor.sub(b.position).rotate(-b.angle);
    this.referenceAngle = b.angle - a.angle;
  }

  get valid(): boolean {
    return this.bodyA != null && this.bodyB != null;
  }

  prepare(_dt: number): void {
    const a = this.bodyA;
    const b = this.bodyB;
    this.rA = worldPoint(a, this.localA).sub(a.position);
    this.rB = worldPoint(b, this.localB).sub(b.position);

    const imA = a.solverInvMass;
    const imB = b.solverInvMass;
    const iiA = a.solverInvInertia;
    const iiB = b.solverInvInertia;

    // 3x3 effective mass: 2 linear (x,y) + 1 angular
    const k11 = imA + imB + iiA * this.rA.y * this.rA.y + iiB * this.rB.y * this.rB.y;
    const k22 = imA + imB + iiA * this.rA.x * this.rA.x + iiB * this.rB.x * this.rB.x;
    const k12 = -(iiA * this.rA.x * this.rA.y + iiB * this.rB.x * this.rB.y);
    const k13 = iiA * this.rA.y + iiB * this.rB.y;
    const k23 = -iiA * this.rA.x - iiB * this.rB.x;
    const k33 = iiA + iiB;
    this.angMass = k33 > 0 ? 1 / k33 : 0;

    // store inverted 2x2 linear part (keep angular separate for simplicity)
    let det = k11 * k22 - k12 * k12;
    if (det !== 0) det = 1 / det;
    this.mass[0] = k22 * det;
    this.mass[1] = -k12 * det;
    this.mass[2] = k11 * det;

    // position bias
    const pA = a.position.add(this.rA);
    const pB = b.position.add(this.rB);
    const C = pB.sub(pA);
    this.biasX = -POSITION_BIAS * _dt * 60 * C.x;
    this.biasY = -POSITION_BIAS * _dt * 60 * C.y;
    const angErr = b.angle - a.angle - this.referenceAngle;
    this.biasAng = -POSITION_BIAS * _dt * 60 * angErr;

    // warm start
    const P = new Vec2(this.impx, this.impy);
    a.applyImpulse(P.neg(), this.rA);
    b.applyImpulse(P, this.rB);
    a.angularVelocity -= this.impAng * iiA;
    b.angularVelocity += this.impAng * iiB;
  }

  solveVelocity(): void {
    const a = this.bodyA;
    const b = this.bodyB;
    const vA = a.velocity.add(this.rA.crossScalar(a.angularVelocity));
    const vB = b.velocity.add(this.rB.crossScalar(b.angularVelocity));
    const Cdot = vB.sub(vA);

    let lambdaX = this.mass[0] * -(Cdot.x + this.biasX) + this.mass[1] * -(Cdot.y + this.biasY);
    let lambdaY = this.mass[1] * -(Cdot.x + this.biasX) + this.mass[2] * -(Cdot.y + this.biasY);
    this.impx += lambdaX;
    this.impy += lambdaY;
    const P = new Vec2(lambdaX, lambdaY);
    a.applyImpulse(P.neg(), this.rA);
    b.applyImpulse(P, this.rB);

    // angular constraint
    const CdotA = b.angularVelocity - a.angularVelocity;
    let lambdaA = this.angMass * -(CdotA + this.biasAng);
    this.impAng += lambdaA;
    a.angularVelocity -= lambdaA * a.solverInvInertia;
    b.angularVelocity += lambdaA * b.solverInvInertia;
  }

  solvePosition(): void {
    const a = this.bodyA;
    const b = this.bodyB;
    // linear
    const rA = worldPoint(a, this.localA).sub(a.position);
    const rB = worldPoint(b, this.localB).sub(b.position);
    const C = b.position.add(rB).sub(a.position.add(rA));
    if (C.lenSq() > POSITION_SLOP * POSITION_SLOP) {
      const imA = a.solverInvMass;
      const imB = b.solverInvMass;
      const iiA = a.solverInvInertia;
      const iiB = b.solverInvInertia;
      const k11 = imA + imB + iiA * rA.y * rA.y + iiB * rB.y * rB.y;
      const k22 = imA + imB + iiA * rA.x * rA.x + iiB * rB.x * rB.x;
      const k12 = -(iiA * rA.x * rA.y + iiB * rB.x * rB.y);
      let det = k11 * k22 - k12 * k12;
      if (det !== 0) {
        det = 1 / det;
        const m11 = k22 * det;
        const m12 = -k12 * det;
        const m22 = k11 * det;
        const px = -POSITION_BIAS * (m11 * C.x + m12 * C.y);
        const py = -POSITION_BIAS * (m12 * C.x + m22 * C.y);
        a.position.isub(new Vec2(px * imA, py * imA));
        b.position.iadd(new Vec2(px * imB, py * imB));
        a.angle -= rA.cross(new Vec2(px, py)) * iiA;
        b.angle += rB.cross(new Vec2(px, py)) * iiB;
      }
    }
    // angular
    const angErr = b.angle - a.angle - this.referenceAngle;
    if (Math.abs(angErr) > 0.005 && this.angMass > 0) {
      const correction = -POSITION_BIAS * angErr / (1 / this.angMass);
      const iiA = a.solverInvInertia;
      const iiB = b.solverInvInertia;
      const sum = iiA + iiB;
      if (sum > 0) {
        a.angle -= (correction * iiA) / sum;
        b.angle += (correction * iiB) / sum;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Motor joint — drive the relative angle toward a target (a servo/hinge motor)
// Keeps the linear offset at its initial value + applies angular correction.
// ---------------------------------------------------------------------------
export class MotorJoint extends Constraint {
  readonly bodyA: RigidBody;
  readonly bodyB: RigidBody;
  /** target relative angle (b.angle - a.angle) */
  targetAngle: number;
  /** max correction impulse per step (motor strength) */
  maxForce: number;

  private localOffset: Vec2; // b.position - a.position at creation (local to A's frame)
  private impAng = 0;
  private angMass = 0;
  private biasAng = 0;

  constructor(
    a: RigidBody,
    b: RigidBody,
    opts: { targetAngle?: number; maxForce?: number } = {},
  ) {
    super();
    this.bodyA = a;
    this.bodyB = b;
    this.targetAngle = opts.targetAngle ?? b.angle - a.angle;
    this.maxForce = opts.maxForce ?? 1e6;
    // store B's offset from A in A's local frame
    this.localOffset = b.position.sub(a.position).rotate(-a.angle);
  }

  get valid(): boolean {
    return this.bodyA != null && this.bodyB != null;
  }

  prepare(_dt: number): void {
    const a = this.bodyA;
    const b = this.bodyB;
    const iiA = a.solverInvInertia;
    const iiB = b.solverInvInertia;
    const k = iiA + iiB;
    this.angMass = k > 0 ? 1 / k : 0;

    const angErr = b.angle - a.angle - this.targetAngle;
    this.biasAng = -POSITION_BIAS * _dt * 60 * angErr;

    // warm start
    a.angularVelocity -= this.impAng * iiA;
    b.angularVelocity += this.impAng * iiB;
  }

  solveVelocity(): void {
    const a = this.bodyA;
    const b = this.bodyB;
    const CdotA = b.angularVelocity - a.angularVelocity;
    let lambda = this.angMass * -(CdotA + this.biasAng);
    const old = this.impAng;
    this.impAng = Math.max(-this.maxForce, Math.min(this.maxForce, old + lambda));
    lambda = this.impAng - old;
    a.angularVelocity -= lambda * a.solverInvInertia;
    b.angularVelocity += lambda * b.solverInvInertia;
  }

  solvePosition(): void {
    const a = this.bodyA;
    const b = this.bodyB;
    // keep B at the initial local offset relative to A (position constraint)
    const target = a.position.add(this.localOffset.rotate(a.angle));
    const C = b.position.sub(target);
    if (C.lenSq() > POSITION_SLOP * POSITION_SLOP) {
      const imA = a.solverInvMass;
      const imB = b.solverInvMass;
      const sum = imA + imB;
      if (sum > 0) {
        const corr = C.mul(-POSITION_BIAS / sum);
        a.position.iadd(corr.mul(imA));
        b.position.isub(corr.mul(imB));
      }
    }
    // angular correction toward target
    const angErr = b.angle - a.angle - this.targetAngle;
    if (Math.abs(angErr) > 0.01 && this.angMass > 0) {
      const iiA = a.solverInvInertia;
      const iiB = b.solverInvInertia;
      const sum = iiA + iiB;
      if (sum > 0) {
        const corr = (-POSITION_BIAS * angErr) / sum;
        a.angle -= corr * iiA;
        b.angle += corr * iiB;
      }
    }
  }
}
