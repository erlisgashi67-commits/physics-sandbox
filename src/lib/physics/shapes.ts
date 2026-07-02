/**
 * Shapes — geometry only (no dynamics).
 *
 * Two shape kinds are supported, both treated as convex:
 *   - Circle:          radius only
 *   - Polygon:         a convex, counter-clockwise vertex loop, centered on
 *                      its centroid. Local edge normals are precomputed.
 *
 * Polygons are built through helpers (box, regular polygon, arbitrary convex
 * hull) so we can guarantee the winding + centroid invariant the SAT solver
 * relies on.
 */

import { Vec2 } from "./vector";

export type ShapeKind = "circle" | "polygon";

export abstract class Shape {
  abstract readonly kind: ShapeKind;
  /** axis-aligned bounding box (half-extents) in local space, centered on body */
  abstract readonly halfExtents: Vec2;
  abstract clone(): Shape;
}

export class CircleShape extends Shape {
  readonly kind = "circle" as const;
  readonly halfExtents: Vec2;

  constructor(public radius: number) {
    super();
    this.halfExtents = new Vec2(radius, radius);
  }

  clone(): Shape {
    return new CircleShape(this.radius);
  }
}

export class PolygonShape extends Shape {
  readonly kind = "polygon" as const;
  readonly vertices: Vec2[]; // local, CCW, centered on centroid
  readonly normals: Vec2[]; // local outward edge normals (CCW => left perp of edge)
  readonly halfExtents: Vec2;

  constructor(vertices: Vec2[]) {
    super();
    // Recenter on centroid so body.position == center of mass.
    const centroid = polygonCentroid(vertices);
    this.vertices = vertices.map((v) => v.sub(centroid));
    this.normals = [];
    const n = this.vertices.length;
    for (let i = 0; i < n; i++) {
      const a = this.vertices[i];
      const b = this.vertices[(i + 1) % n];
      const edge = b.sub(a);
      // CCW winding => outward normal is the right-perpendicular: (edge.y, -edge.x)
      const normal = new Vec2(edge.y, -edge.x).normalize();
      this.normals.push(normal);
    }
    this.halfExtents = computeHalfExtents(this.vertices);
  }

  clone(): Shape {
    return new PolygonShape(this.vertices.map((v) => v.clone()));
  }

  /** support point: furthest local vertex along `dir` (used by SAT) */
  support(dir: Vec2): Vec2 {
    let best = this.vertices[0];
    let bestProj = best.dot(dir);
    for (let i = 1; i < this.vertices.length; i++) {
      const v = this.vertices[i];
      const proj = v.dot(dir);
      if (proj > bestProj) {
        bestProj = proj;
        best = v;
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

/** axis-aligned box as a centered polygon */
export function makeBox(w: number, h: number): PolygonShape {
  const hw = w / 2;
  const hh = h / 2;
  // CCW: bottom-left, bottom-right, top-right, top-left
  return new PolygonShape([
    new Vec2(-hw, -hh),
    new Vec2(hw, -hh),
    new Vec2(hw, hh),
    new Vec2(-hw, hh),
  ]);
}

/** regular n-gon of given radius, rotated so a flat edge is on the bottom */
export function makeRegularPolygon(sides: number, radius: number): PolygonShape {
  const verts: Vec2[] = [];
  const offset = Math.PI / sides; // flat bottom
  for (let i = 0; i < sides; i++) {
    const a = offset + (i / sides) * Math.PI * 2;
    verts.push(new Vec2(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  return new PolygonShape(verts);
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

/** signed area (positive for CCW) via the shoelace formula */
export function polygonArea(verts: Vec2[]): number {
  let area = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    area += a.cross(b);
  }
  return area / 2;
}

/** centroid of a simple polygon */
export function polygonCentroid(verts: Vec2[]): Vec2 {
  const n = verts.length;
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const cross = a.cross(b);
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
    area += cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-9) {
    // degenerate — average vertices
    const avg = verts.reduce((p, v) => p.add(v), new Vec2());
    return avg.mul(1 / n);
  }
  return new Vec2(cx / (6 * area), cy / (6 * area));
}

/**
 * Mass moment of inertia of a convex polygon about its centroid.
 * Assumes `verts` are already centered on the centroid (body-local space).
 * density = mass / area, then I = density * (1/12) * Σ |cross| * (P·P + P·Q + Q·Q).
 */
export function polygonInertia(verts: Vec2[], mass: number): number {
  const n = verts.length;
  let area = 0;
  let secondMoment = 0; // ∫ r² dA (about origin = centroid)
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const cross = Math.abs(a.cross(b));
    area += cross;
    secondMoment +=
      cross * (a.dot(a) + a.dot(b) + b.dot(b));
  }
  area *= 0.5;
  if (area < 1e-9) return mass; // fallback
  // density = mass / area; I = density * (1/12) * Σ...
  return (mass / area) * (secondMoment / 12);
}

function computeHalfExtents(verts: Vec2[]): Vec2 {
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const v of verts) {
    if (v.x > maxx) maxx = v.x;
    if (v.y > maxy) maxy = v.y;
  }
  return new Vec2(maxx, maxy);
}
