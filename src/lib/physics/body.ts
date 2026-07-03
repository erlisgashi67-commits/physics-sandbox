/**
 * RigidBody — a single dynamic or static rigid body.
 *
 * Holds all the state a 2D rigid-body solver needs:
 *   - linear: position, velocity, accumulated force
 *   - angular: angle (radians), angular velocity, accumulated torque
 *   - mass properties: mass / inverseMass, inertia / inverseInertia
 *   - material: restitution, static & dynamic friction
 *   - per-frame cache: world-space vertices/normals, AABB, cos/sin
 *
 * `static` bodies have invMass = invInertia = 0 and never integrate. They act
 * as the world geometry (floor, walls, ramps).
 *
 * `kinematic` bodies are driven externally (the mouse grab). The solver treats
 * them as infinitely massive, but their transform is updated each frame by the
 * grabber so they push dynamic bodies around.
 */

import { Vec2 } from "./vector";
import {
  Shape,
  CircleShape,
  PolygonShape,
  polygonInertia,
} from "./shapes";

export interface AABB {
  min: Vec2;
  max: Vec2;
}

let NEXT_ID = 1;

export class RigidBody {
  readonly id: number;

  // --- linear state ---
  position: Vec2;
  velocity: Vec2;
  force: Vec2; // accumulated this frame (cleared each step)

  // --- angular state ---
  angle = 0;
  angularVelocity = 0;
  torque = 0; // accumulated this frame

  // --- mass properties ---
  mass: number;
  invMass: number;
  inertia: number;
  invInertia: number;

  // --- material ---
  restitution = 0.2;
  staticFriction = 0.5;
  dynamicFriction = 0.3;

  // --- flags ---
  isStatic: boolean;
  /** externally driven (mouse grab) — treated as infinite mass by solver */
  kinematic = false;

  // --- appearance ---
  color = "#64748b";
  label?: string;

  // --- cached transform (refreshed by `sync()`) ---
  cos = 1;
  sin = 0;
  worldVertices: Vec2[] = [];
  worldNormals: Vec2[] = [];
  aabb: AABB = { min: new Vec2(), max: new Vec2() };

  constructor(
    public shape: Shape,
    position: Vec2,
    opts: {
      isStatic?: boolean;
      density?: number;
      restitution?: number;
      staticFriction?: number;
      dynamicFriction?: number;
      color?: string;
      label?: string;
      angle?: number;
    } = {},
  ) {
    this.id = NEXT_ID++;
    this.position = position.clone();
    this.velocity = new Vec2();
    this.force = new Vec2();
    this.isStatic = opts.isStatic ?? false;
    if (opts.restitution != null) this.restitution = opts.restitution;
    if (opts.staticFriction != null) this.staticFriction = opts.staticFriction;
    if (opts.dynamicFriction != null)
      this.dynamicFriction = opts.dynamicFriction;
    if (opts.color) this.color = opts.color;
    if (opts.label) this.label = opts.label;
    if (opts.angle != null) this.angle = opts.angle;

    const density = opts.density ?? 1;

    if (this.isStatic) {
      this.mass = 0;
      this.invMass = 0;
      this.inertia = 0;
      this.invInertia = 0;
    } else {
      const area = shapeArea(shape);
      this.mass = area * density;
      this.inertia = shapeInertia(shape, this.mass);
      // guard against zero-mass degenerate bodies
      this.invMass = this.mass > 1e-8 ? 1 / this.mass : 0;
      this.invInertia = this.inertia > 1e-8 ? 1 / this.inertia : 0;
    }

    this.sync();
  }

  /** recompute cached world geometry from position + angle */
  sync(): void {
    this.cos = Math.cos(this.angle);
    this.sin = Math.sin(this.angle);

    if (this.shape.kind === "polygon") {
      const poly = this.shape as PolygonShape;
      if (this.worldVertices.length !== poly.vertices.length) {
        this.worldVertices = poly.vertices.map(() => new Vec2());
        this.worldNormals = poly.normals.map(() => new Vec2());
      }
      for (let i = 0; i < poly.vertices.length; i++) {
        const v = poly.vertices[i];
        const w = this.worldVertices[i];
        w.x = v.x * this.cos - v.y * this.sin + this.position.x;
        w.y = v.x * this.sin + v.y * this.cos + this.position.y;
      }
      for (let i = 0; i < poly.normals.length; i++) {
        const n = poly.normals[i];
        const w = this.worldNormals[i];
        w.x = n.x * this.cos - n.y * this.sin;
        w.y = n.x * this.sin + n.y * this.cos;
      }
    }

    // AABB (from cached half-extents rotated to axis-aligned bounds)
    const he = this.shape.halfExtents;
    if (this.shape.kind === "circle") {
      const r = (this.shape as CircleShape).radius;
      this.aabb.min.set(this.position.x - r, this.position.y - r);
      this.aabb.max.set(this.position.x + r, this.position.y + r);
    } else {
      // rotated box bounds of the polygon
      const ex = Math.abs(he.x * this.cos) + Math.abs(he.y * this.sin);
      const ey = Math.abs(he.x * this.sin) + Math.abs(he.y * this.cos);
      this.aabb.min.set(this.position.x - ex, this.position.y - ey);
      this.aabb.max.set(this.position.x + ex, this.position.y + ey);
    }
  }

  /** apply a force at (or offset from) the center of mass */
  applyForce(force: Vec2): void {
    this.force.iadd(force);
  }

  /** apply an impulse at a world-space point `r` (offset from COM) */
  applyImpulse(impulse: Vec2, r: Vec2): void {
    if (this.isStatic || this.kinematic) return;
    this.velocity.iaddMul(impulse, this.invMass);
    this.angularVelocity += r.cross(impulse) * this.invInertia;
  }

  // --- mouse-grab helpers (the sandbox drives a body kinematicly) ---
  setKinematic(v: boolean): void {
    this.kinematic = v;
  }

  /** teleport the body to `pos`, set its linear velocity and scale angular velocity */
  setGrabTransform(pos: Vec2, vel: Vec2, angularScale: number): void {
    this.position.copy(pos);
    this.velocity = vel;
    this.angularVelocity *= angularScale;
  }

  /** effective inverse mass the solver should see (kinematic = infinite) */
  get solverInvMass(): number {
    return this.kinematic ? 0 : this.invMass;
  }

  get solverInvInertia(): number {
    return this.kinematic ? 0 : this.invInertia;
  }

  /** world-space position of a local-space point on this body */
  worldPoint(local: Vec2): Vec2 {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return new Vec2(
      local.x * c - local.y * s + this.position.x,
      local.x * s + local.y * c + this.position.y,
    );
  }

  containsPoint(p: Vec2): boolean {
    if (this.shape.kind === "circle") {
      const r = (this.shape as CircleShape).radius;
      return Vec2.distSq(p, this.position) <= r * r;
    }
    const verts = this.worldVertices;
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % n];
      const edge = b.sub(a);
      const toP = p.sub(a);
      if (edge.cross(toP) < 0) return false; // outside this CCW edge
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// mass helpers
// ---------------------------------------------------------------------------

function shapeArea(shape: Shape): number {
  if (shape.kind === "circle") {
    const r = (shape as CircleShape).radius;
    return Math.PI * r * r;
  }
  const poly = shape as PolygonShape;
  // shoelace on local vertices (already centered)
  let area = 0;
  for (let i = 0; i < poly.vertices.length; i++) {
    const a = poly.vertices[i];
    const b = poly.vertices[(i + 1) % poly.vertices.length];
    area += a.cross(b);
  }
  return Math.abs(area) / 2;
}

function shapeInertia(shape: Shape, mass: number): number {
  if (shape.kind === "circle") {
    const r = (shape as CircleShape).radius;
    return (mass * r * r) / 2;
  }
  return polygonInertia((shape as PolygonShape).vertices, mass);
}
