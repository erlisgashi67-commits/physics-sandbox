/**
 * Canvas renderer — pure drawing logic, no React.
 *
 * Draws the world to a 2D canvas context. Supports a stack of optional debug
 * overlays (AABB, velocity vectors, contact points/normals, broadphase pairs)
 * that are exactly the things you stare at when a physics engine "glitches".
 */

import { Vec2 } from "@/lib/physics/vector";
import { PhysicsWorld } from "@/lib/physics/world";
import { RigidBody } from "@/lib/physics/body";
import { CircleShape, PolygonShape } from "@/lib/physics/shapes";
import { Manifold } from "@/lib/physics/manifold";

export interface RenderColors {
  background: string;
  grid: string;
  staticFill: string;
  staticStroke: string;
  dynamicFill: string;
  dynamicStroke: string;
  kinematicStroke: string;
  contact: string;
  normal: string;
  velocity: string;
  aabb: string;
  broadphase: string;
  text: string;
  textMuted: string;
}

export interface DebugOptions {
  showAABB: boolean;
  showVelocity: boolean;
  showContacts: boolean;
  showNormals: boolean;
  showBroadphase: boolean;
  showGrid: boolean;
}

export interface RenderOptions {
  colors: RenderColors;
  debug: DebugOptions;
  manifolds?: Manifold[];
  broadphasePairs?: [RigidBody, RigidBody][];
  grabbedId?: number;
  ghost?: GhostShape | null;
}

export type SandboxShapeKind =
  | "circle"
  | "box"
  | "triangle"
  | "pentagon"
  | "hexagon";

export interface GhostShape {
  kind: SandboxShapeKind;
  x: number;
  y: number;
  radius: number;
  color: string;
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  world: PhysicsWorld,
  width: number,
  height: number,
  opts: RenderOptions,
): void {
  const { colors, debug } = opts;

  // background
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);

  // grid
  if (debug.showGrid) {
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    const step = 40;
    ctx.beginPath();
    for (let x = step; x < width; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = step; y < height; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
  }

  // broadphase pairs (behind bodies)
  if (debug.showBroadphase && opts.broadphasePairs) {
    ctx.strokeStyle = colors.broadphase;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of opts.broadphasePairs) {
      ctx.moveTo(a.position.x, a.position.y);
      ctx.lineTo(b.position.x, b.position.y);
    }
    ctx.stroke();
  }

  // bodies
  for (const body of world.bodies) {
    drawBody(ctx, body, opts);
  }

  // ghost (spawn preview)
  if (opts.ghost) drawGhost(ctx, opts.ghost);

  // debug overlays on top
  if (debug.showAABB) {
    ctx.strokeStyle = colors.aabb;
    ctx.lineWidth = 1;
    for (const body of world.bodies) {
      const { min, max } = body.aabb;
      ctx.strokeRect(min.x, min.y, max.x - min.x, max.y - min.y);
    }
  }

  if (debug.showVelocity) {
    ctx.strokeStyle = colors.velocity;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const body of world.bodies) {
      if (body.isStatic) continue;
      ctx.moveTo(body.position.x, body.position.y);
      ctx.lineTo(
        body.position.x + body.velocity.x * 0.08,
        body.position.y + body.velocity.y * 0.08,
      );
    }
    ctx.stroke();
  }

  if (debug.showContacts && opts.manifolds) {
    ctx.fillStyle = colors.contact;
    for (const m of opts.manifolds) {
      for (const c of m.contacts) {
        ctx.beginPath();
        ctx.arc(c.point.x, c.point.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (debug.showNormals) {
      ctx.strokeStyle = colors.normal;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const m of opts.manifolds) {
        for (const c of m.contacts) {
          const s = m.normal.mul(22);
          ctx.moveTo(c.point.x, c.point.y);
          ctx.lineTo(c.point.x + s.x, c.point.y + s.y);
        }
      }
      ctx.stroke();
    }
  }
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  body: RigidBody,
  opts: RenderOptions,
): void {
  const { colors } = opts;
  const grabbed = body.id === opts.grabbedId;

  ctx.lineWidth = grabbed ? 3 : 2;

  if (body.shape.kind === "circle") {
    const r = (body.shape as CircleShape).radius;
    ctx.beginPath();
    ctx.arc(body.position.x, body.position.y, r, 0, Math.PI * 2);
  } else {
    const verts = body.worldVertices;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
  }

  if (body.isStatic) {
    ctx.fillStyle = colors.staticFill;
    ctx.fill();
    ctx.strokeStyle = colors.staticStroke;
  } else if (body.kinematic) {
    ctx.fillStyle = body.color;
    ctx.fill();
    ctx.strokeStyle = colors.kinematicStroke;
  } else {
    ctx.fillStyle = body.color;
    ctx.fill();
    ctx.strokeStyle = colors.dynamicStroke;
  }
  ctx.stroke();

  // orientation indicator for dynamic bodies
  if (!body.isStatic) {
    const r =
      body.shape.kind === "circle"
        ? (body.shape as CircleShape).radius
        : maxRadius(body);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(body.position.x, body.position.y);
    ctx.lineTo(
      body.position.x + Math.cos(body.angle) * r * 0.85,
      body.position.y + Math.sin(body.angle) * r * 0.85,
    );
    ctx.stroke();
  }
}

function drawGhost(ctx: CanvasRenderingContext2D, ghost: GhostShape): void {
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = ghost.color;
  ctx.strokeStyle = ghost.color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  if (ghost.kind === "circle") {
    ctx.arc(ghost.x, ghost.y, ghost.radius, 0, Math.PI * 2);
  } else if (ghost.kind === "box") {
    const r = ghost.radius;
    ctx.rect(ghost.x - r, ghost.y - r, r * 2, r * 2);
  } else {
    const sides = ghost.kind === "triangle" ? 3 : ghost.kind === "pentagon" ? 5 : 6;
    const offset = Math.PI / sides;
    for (let i = 0; i < sides; i++) {
      const a = offset + (i / sides) * Math.PI * 2;
      const px = ghost.x + Math.cos(a) * ghost.radius;
      const py = ghost.y + Math.sin(a) * ghost.radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}

function maxRadius(body: RigidBody): number {
  const he = body.shape.halfExtents;
  return Math.hypot(he.x, he.y);
}

// re-export so callers don't need a second import path
export type { Vec2 };
