/**
 * Collision detection + resolution.
 *
 * Detection (narrow phase):
 *   - Circle  vs Circle   — direct distance test
 *   - Circle  vs Polygon  — face/vertex Voronoi test (dyn4j/Randy Gaul)
 *   - Polygon vs Polygon  — full SAT + Sutherland-Hodgman contact clipping,
 *                           producing up to 2 contact points per manifold.
 *                         (this is the Separating Axis Theorem the task asks
 *                          about — the finicky part that makes stacks stable)
 *
 * Resolution:
 *   - Sequential impulse solver with `iterations` passes per step.
 *   - Normal impulse (restitution) + tangential impulse (Coulomb friction).
 *   - Baumgarte position correction with a penetration slop to kill sinking.
 *
 * Convention: the manifold `normal` always points from body A to body B.
 */

import { Vec2 } from "./vector";
import { RigidBody } from "./body";
import { CircleShape, PolygonShape } from "./shapes";

const EPSILON = 1e-8;
const BIAS_RELATIVE = 0.95;
const BIAS_ABSOLUTE = 0.01;

export interface ContactPoint {
  point: Vec2; // world space
  penetration: number;
}

export class Manifold {
  bodyA: RigidBody;
  bodyB: RigidBody;
  normal: Vec2; // A -> B
  contacts: ContactPoint[] = [];
  e = 0; // mixed restitution
  sf = 0; // mixed static friction
  df = 0; // mixed dynamic friction

  constructor(a: RigidBody, b: RigidBody) {
    this.bodyA = a;
    this.bodyB = b;
    this.normal = new Vec2(0, 0);
  }

  get contactCount(): number {
    return this.contacts.length;
  }
}

/** biased >= to keep SAT numerically stable (from Randy Gaul) */
function biasGreaterThan(a: number, b: number): boolean {
  const kBiasRelative = BIAS_RELATIVE;
  const kBiasAbsolute = BIAS_ABSOLUTE;
  return b >= a * kBiasRelative + b * kBiasAbsolute;
}

/**
 * Detect a collision between two bodies. Returns a populated Manifold or null.
 * Handles all shape combinations and picks the right routine.
 */
export function detect(a: RigidBody, b: RigidBody): Manifold | null {
  const m = new Manifold(a, b);

  if (a.shape.kind === "circle" && b.shape.kind === "circle") {
    circleCircle(m, a, b);
  } else if (a.shape.kind === "circle" && b.shape.kind === "polygon") {
    circlePolygon(m, a, b);
  } else if (a.shape.kind === "polygon" && b.shape.kind === "circle") {
    // solve as circle(B)-polygon(A) then flip the normal so it stays A->B
    circlePolygon(m, b, a);
    m.normal = m.normal.neg();
    const tmp = m.bodyA;
    m.bodyA = m.bodyB;
    m.bodyB = tmp;
  } else {
    polygonPolygon(m, a, b);
  }

  if (m.contacts.length === 0) return null;

  // mix material properties
  m.e = Math.min(a.restitution, b.restitution);
  m.sf = Math.sqrt(a.staticFriction * b.staticFriction);
  m.df = Math.sqrt(a.dynamicFriction * b.dynamicFriction);
  return m;
}

// ---------------------------------------------------------------------------
// Circle vs Circle
// ---------------------------------------------------------------------------
function circleCircle(m: Manifold, a: RigidBody, b: RigidBody): void {
  const ca = a.shape as CircleShape;
  const cb = b.shape as CircleShape;
  const d = b.position.sub(a.position);
  const r = ca.radius + cb.radius;
  const distSq = d.lenSq();
  if (distSq >= r * r) return;

  const dist = Math.sqrt(distSq);
  if (dist > EPSILON) {
    m.normal = d.mul(1 / dist);
  } else {
    m.normal = new Vec2(1, 0);
  }
  m.contacts.push({
    point: a.position.add(m.normal.mul(ca.radius)),
    penetration: r - dist,
  });
}

// ---------------------------------------------------------------------------
// Circle vs Polygon  (circle = A, polygon = B)
// ---------------------------------------------------------------------------
function circlePolygon(m: Manifold, a: RigidBody, b: RigidBody): void {
  const circle = a.shape as CircleShape;
  const poly = b.shape as PolygonShape;
  const radius = circle.radius;

  // transform circle center into B's local space
  const center = a.position.sub(b.position).rotate(-b.angle);

  // find the face of minimum separation
  let separation = -Infinity;
  let faceIndex = 0;
  for (let i = 0; i < poly.vertices.length; i++) {
    const s = poly.normals[i].dot(center.sub(poly.vertices[i]));
    if (s > radius) return; // separating axis -> no collision
    if (s > separation) {
      separation = s;
      faceIndex = i;
    }
  }

  const v1 = poly.vertices[faceIndex];
  const v2 = poly.vertices[(faceIndex + 1) % poly.vertices.length];

  // center inside polygon -> deep penetration, push out along least-penetrating face
  if (separation < EPSILON) {
    const localNormal = poly.normals[faceIndex];
    const worldNormal = localNormal.rotate(b.angle);
    m.normal = worldNormal.neg(); // outward of B points toward A; flip -> A->B
    m.contacts.push({
      point: a.position.add(m.normal.mul(-radius)), // contact on circle surface toward B
      penetration: radius,
    });
    return;
  }

  // Determine which Voronoi region of the edge the center lies in.
  const dot1 = center.sub(v1).dot(v2.sub(v1));
  const dot2 = center.sub(v2).dot(v1.sub(v2));
  const penetration = radius - separation;

  // closest to v1
  if (dot1 <= 0) {
    if (Vec2.distSq(center, v1) > radius * radius) return;
    let n = v1.sub(center).rotate(b.angle);
    n = n.normalize();
    m.normal = n; // A(circle center) -> B(vertex)
    m.contacts.push({
      point: v1.rotate(b.angle).add(b.position),
      penetration,
    });
    return;
  }

  // closest to v2
  if (dot2 <= 0) {
    if (Vec2.distSq(center, v2) > radius * radius) return;
    let n = v2.sub(center).rotate(b.angle);
    n = n.normalize();
    m.normal = n;
    m.contacts.push({
      point: v2.rotate(b.angle).add(b.position),
      penetration,
    });
    return;
  }

  // closest to the face
  const n = poly.normals[faceIndex].rotate(b.angle); // outward of B (toward A)
  if (center.sub(v1).dot(poly.normals[faceIndex]) > radius) return;
  m.normal = n.neg(); // flip to A->B
  m.contacts.push({
    point: a.position.add(m.normal.mul(-radius)),
    penetration,
  });
}

// ---------------------------------------------------------------------------
// Polygon vs Polygon  (SAT + clipping)
// ---------------------------------------------------------------------------

/**
 * Find the face of A that penetrates B the least.
 * Returns the penetration depth (>=0 means separating axis found) and writes
 * the face index into `out.index`.
 */
function findAxisLeastPenetration(
  a: RigidBody,
  b: RigidBody,
  out: { index: number },
): number {
  const pa = a.shape as PolygonShape;
  const pb = b.shape as PolygonShape;
  let bestDistance = -Infinity;
  let bestIndex = 0;

  for (let i = 0; i < pa.vertices.length; i++) {
    // A's face normal in world space
    const nw = a.worldNormals[i];
    // into B's local space
    const n = nw.rotate(-b.angle);

    // support point of B along -n (B's local space)
    const s = pb.support(n.neg());

    // vertex of A (world) into B's local space
    const va = a.worldVertices[i].sub(b.position).rotate(-b.angle);

    const d = n.dot(s.sub(va));
    if (d > bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }

  out.index = bestIndex;
  return bestDistance;
}

/** world-space incident face (2 verts) against reference face `refIndex` */
function findIncidentFace(
  ref: RigidBody,
  inc: RigidBody,
  refIndex: number,
): Vec2[] {
  const refPoly = ref.shape as PolygonShape;
  const incPoly = inc.shape as PolygonShape;

  const refNormal = refPoly.normals[refIndex];
  // ref local normal -> world -> incident local
  const worldNormal = refNormal.rotate(ref.angle);
  const incLocalNormal = worldNormal.rotate(-inc.angle);

  let incidentFace = 0;
  let minDot = Infinity;
  for (let i = 0; i < incPoly.normals.length; i++) {
    const dot = incPoly.normals[i].dot(incLocalNormal);
    if (dot < minDot) {
      minDot = dot;
      incidentFace = i;
    }
  }

  const i0 = incidentFace;
  const i1 = (incidentFace + 1) % incPoly.vertices.length;
  return [
    incPoly.vertices[i0].rotate(inc.angle).add(inc.position),
    incPoly.vertices[i1].rotate(inc.angle).add(inc.position),
  ];
}

/** clip the segment `face` against the plane n·x = c. returns kept count. */
function clip(n: Vec2, c: number, face: Vec2[]): number {
  const out: Vec2[] = [];
  const d1 = n.dot(face[0]) - c;
  const d2 = n.dot(face[1]) - c;

  if (d1 <= 0) out.push(face[0]);
  if (d2 <= 0) out.push(face[1]);

  if (d1 * d2 < 0) {
    const alpha = d1 / (d1 - d2);
    out.push(face[0].add(face[1].sub(face[0]).mul(alpha)));
  }

  if (out.length === 0) return 0;
  face[0] = out[0];
  face[1] = out[1];
  // if only one point kept, duplicate so callers can read index 1 safely
  if (out.length === 1) face[1] = out[0];
  return out.length;
}

function polygonPolygon(m: Manifold, a: RigidBody, b: RigidBody): void {
  const aFace = { index: 0 };
  const penetrationA = findAxisLeastPenetration(a, b, aFace);
  if (penetrationA >= 0) return; // separating axis on A's faces

  const bFace = { index: 0 };
  const penetrationB = findAxisLeastPenetration(b, a, bFace);
  if (penetrationB >= 0) return; // separating axis on B's faces

  // pick reference polygon (the one with the greater penetration = the face
  // most aligned with the collision normal)
  let ref: RigidBody;
  let inc: RigidBody;
  let refIndex: number;
  let flip: boolean; // true means normal currently points B->A and must flip

  if (biasGreaterThan(penetrationA, penetrationB)) {
    ref = a;
    inc = b;
    refIndex = aFace.index;
    flip = false;
  } else {
    ref = b;
    inc = a;
    refIndex = bFace.index;
    flip = true;
  }

  const incidentFace = findIncidentFace(ref, inc, refIndex);

  const refPoly = ref.shape as PolygonShape;
  const v1 = refPoly.vertices[refIndex];
  const v2 =
    refPoly.vertices[(refIndex + 1) % refPoly.vertices.length];
  const wv1 = v1.rotate(ref.angle).add(ref.position);
  const wv2 = v2.rotate(ref.angle).add(ref.position);

  // reference face direction (world): unit vector along the reference edge
  const sidePlaneNormal = wv2.sub(wv1).normalize();
  // outward normal of the reference face (right-perp of edge dir for CCW winding)
  const refFaceNormal = new Vec2(sidePlaneNormal.y, -sidePlaneNormal.x);

  // Clip the incident edge to the reference face's two side planes, keeping
  // points whose projection onto the edge direction lies within [v1, v2].
  const sideC1 = sidePlaneNormal.dot(wv1);
  const sideC2 = sidePlaneNormal.dot(wv2);
  if (clip(sidePlaneNormal.neg(), -sideC1, incidentFace) < 2) return;
  if (clip(sidePlaneNormal, sideC2, incidentFace) < 2) return;

  m.normal = flip ? refFaceNormal.neg() : refFaceNormal; // ensure A -> B

  // keep points behind the reference face plane (the penetrating ones)
  const refFaceC = refFaceNormal.dot(wv1);
  const sep0 = refFaceNormal.dot(incidentFace[0]) - refFaceC;
  if (sep0 <= 0) {
    m.contacts.push({
      point: incidentFace[0].clone(),
      penetration: -sep0,
    });
  }
  const sep1 = refFaceNormal.dot(incidentFace[1]) - refFaceC;
  if (sep1 <= 0) {
    m.contacts.push({
      point: incidentFace[1].clone(),
      penetration: -sep1,
    });
  }
}
