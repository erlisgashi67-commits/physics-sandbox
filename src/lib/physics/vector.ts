/**
 * Vec2 — minimal but complete 2D vector math used throughout the engine.
 *
 * No external libraries. Every operation the rigid-body solver needs is here:
 * dot, 2D cross (scalar and scalar×vector forms), projection, rotation, etc.
 *
 * Convention used by the rest of the engine:
 *   - `cross(v)` returns a SCALAR  (this.x * v.y - this.y * v.x)
 *   - `crossScalar(s)` returns a Vec2  (-s * y, s * x)   [ s × this ]
 *   - `normal` points from body A to body B inside a manifold.
 */

export class Vec2 {
  x: number;
  y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  // --- mutators (return `this` for chaining) ---
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  copy(v: Vec2): this {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  // --- pure algebra (return new vectors, leave operands intact) ---
  add(v: Vec2): Vec2 {
    return new Vec2(this.x + v.x, this.y + v.y);
  }

  sub(v: Vec2): Vec2 {
    return new Vec2(this.x - v.x, this.y - v.y);
  }

  mul(s: number): Vec2 {
    return new Vec2(this.x * s, this.y * s);
  }

  /** this + v * s  (handy for impulse application) */
  addMul(v: Vec2, s: number): Vec2 {
    return new Vec2(this.x + v.x * s, this.y + v.y * s);
  }

  neg(): Vec2 {
    return new Vec2(-this.x, -this.y);
  }

  dot(v: Vec2): number {
    return this.x * v.x + this.y * v.y;
  }

  /** 2D cross product: this × v -> scalar (z component). */
  cross(v: Vec2): number {
    return this.x * v.y - this.y * v.x;
  }

  /** scalar × this -> Vec2  (equiv. to (0,0,s) × (x,y,0)). */
  crossScalar(s: number): Vec2 {
    return new Vec2(-s * this.y, s * this.x);
  }

  len(): number {
    return Math.hypot(this.x, this.y);
  }

  lenSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  normalize(): Vec2 {
    const l = Math.hypot(this.x, this.y);
    if (l > 1e-12) return new Vec2(this.x / l, this.y / l);
    return new Vec2(0, 0);
  }

  /** left-hand perpendicular (CCW rotation by 90deg) */
  perp(): Vec2 {
    return new Vec2(-this.y, this.x);
  }

  /** rotate by `angle` radians (CCW) */
  rotate(angle: number): Vec2 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  // --- in-place mutators used in hot solver loops (avoid allocations) ---
  iadd(v: Vec2): this {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  isub(v: Vec2): this {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  imul(s: number): this {
    this.x *= s;
    this.y *= s;
    return this;
  }

  iaddMul(v: Vec2, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    return this;
  }

  static readonly ZERO = new Vec2(0, 0);

  static dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
  }

  static cross(a: Vec2, b: Vec2): number {
    return a.x * b.y - a.y * b.x;
  }

  static dist(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  static distSq(a: Vec2, b: Vec2): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
}
