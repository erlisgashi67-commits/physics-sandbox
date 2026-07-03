/**
 * Siege — a projectile-launching demolition game built on the physics engine.
 *
 * Design:
 *   - A slingshot on the left. Drag back to aim + set power, release to fire.
 *   - Structures on the right built from boxes, some WELDED into rigid
 *     compounds, some hanging from distance-joint chains, plus a hinged
 *     pendulum obstacle.
 *   - Targets (glowing orbs) sit on/around the structures. Knock them all
 *     to the ground (below the target line) to win.
 *   - Limited shots. Score = targets down + leftover shots bonus.
 *   - Fast projectiles rely on CCD so they don't tunnel through walls.
 *
 * The whole thing runs on the same PhysicsWorld as the sandbox — joints,
 * CCD, and the impulse solver all just work.
 */

import { Vec2 } from "@/lib/physics/vector";
import { RigidBody } from "@/lib/physics/body";
import { CircleShape, makeBox, makeRegularPolygon } from "@/lib/physics/shapes";
import { PhysicsWorld } from "@/lib/physics/world";
import { DistanceJoint, PinJoint, WeldJoint } from "@/lib/physics/constraints";
import { renderWorld, type RenderColors } from "@/components/physics/canvas-renderer";

export interface Level {
  name: string;
  hint: string;
  shots: number;
  build: (world: PhysicsWorld, w: number, h: number) => Target[];
}

export interface Target {
  body: RigidBody;
  /** y-position below which the target counts as "down" */
  downLine: number;
  done: boolean;
}

export interface GameState {
  level: number;
  shotsLeft: number;
  targetsLeft: number;
  status: "playing" | "won" | "lost";
  score: number;
}

const COLORS: RenderColors = {
  background: "#0b0e14",
  grid: "rgba(148,163,184,0.06)",
  staticFill: "#1e293b",
  staticStroke: "#475569",
  dynamicFill: "#64748b",
  dynamicStroke: "rgba(255,255,255,0.85)",
  kinematicStroke: "#fde047",
  contact: "#f43f5e",
  normal: "#22d3ee",
  velocity: "#a3e635",
  aabb: "rgba(251,191,36,0.5)",
  broadphase: "rgba(168,85,247,0.25)",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  joint: "#c084fc",
  jointAnchor: "#fef08a",
};

const STRUCTURE_COLOR = "#fbbf24";
const PROJECTILE_COLOR = "#fb7185";
const TARGET_COLOR = "#34d399";

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** builds the floor + side walls; returns the "ground line" y */
function buildArena(world: PhysicsWorld, w: number, h: number): number {
  const t = 60;
  const groundY = h - t / 2;
  world.add(
    new RigidBody(makeBox(w + t * 2, t), new Vec2(w / 2, groundY + 1), {
      isStatic: true,
      color: "#1e293b",
    }),
  );
  world.add(
    new RigidBody(makeBox(t, h * 2), new Vec2(-t / 2, h / 2), {
      isStatic: true,
      color: "#1e293b",
    }),
  );
  world.add(
    new RigidBody(makeBox(t, h * 2), new Vec2(w + t / 2, h / 2), {
      isStatic: true,
      color: "#1e293b",
    }),
  );
  return groundY - t / 2;
}

function box(x: number, y: number, w: number, h: number, color = STRUCTURE_COLOR): RigidBody {
  return new RigidBody(makeBox(w, h), new Vec2(x, y), {
    density: 0.03,
    restitution: 0.1,
    staticFriction: 0.7,
    dynamicFriction: 0.5,
    color,
  });
}

function target(x: number, y: number): RigidBody {
  return new RigidBody(new CircleShape(16), new Vec2(x, y), {
    density: 0.04,
    restitution: 0.2,
    staticFriction: 0.8,
    dynamicFriction: 0.6,
    color: TARGET_COLOR,
  });
}

// Level 1: simple stack with a target on top
function level1(world: PhysicsWorld, w: number, h: number): Target[] {
  const ground = buildArena(world, w, h);
  const baseX = w * 0.72;
  const t: Target[] = [];
  // two stacks with a target cradled on top
  for (let s = 0; s < 2; s++) {
    const sx = baseX + s * 90;
    for (let i = 0; i < 3; i++) {
      world.add(box(sx, ground - 30 - i * 56, 56, 52));
    }
    // small lip boxes to cradle the target so it doesn't roll off
    world.add(box(sx - 32, ground - 30 - 3 * 56, 12, 24, "#475569"));
    world.add(box(sx + 32, ground - 30 - 3 * 56, 12, 24, "#475569"));
    const tg = target(sx, ground - 30 - 3 * 56 - 24);
    world.add(tg);
    t.push({ body: tg, downLine: ground - 10, done: false });
  }
  return t;
}

// Level 2: welded fortress + a hanging target on a chain
function level2(world: PhysicsWorld, w: number, h: number): Target[] {
  const ground = buildArena(world, w, h);
  const t: Target[] = [];
  const cx = w * 0.7;

  // welded tower (two boxes fused)
  const base = box(cx, ground - 25, 70, 50);
  const mid = box(cx, ground - 75, 50, 50);
  world.add(base, mid);
  world.addConstraint(new WeldJoint(base, mid, new Vec2(cx, ground - 50)));

  // target resting on top
  const tg1 = target(cx, ground - 110);
  world.add(tg1);
  t.push({ body: tg1, downLine: ground - 10, done: false });

  // hanging target on a chain from the ceiling
  const anchor = new RigidBody(makeBox(30, 14), new Vec2(cx + 160, 60), {
    isStatic: true,
    color: "#334155",
  });
  world.add(anchor);
  const tg2 = target(cx + 160, 180);
  world.add(tg2);
  world.addConstraint(
    new DistanceJoint(anchor, tg2, new Vec2(cx + 160, 67), tg2.position, {
      length: 100,
      frequencyHz: 2,
      dampingRatio: 0.5,
    }),
  );
  t.push({ body: tg2, downLine: ground - 10, done: false });

  return t;
}

// Level 3: pendulum guard + welded seesaw + target behind a wall
function level3(world: PhysicsWorld, w: number, h: number): Target[] {
  const ground = buildArena(world, w, h);
  const t: Target[] = [];
  const cx = w * 0.68;

  // swinging pendulum obstacle
  const pivot = new RigidBody(makeBox(24, 14), new Vec2(cx - 40, 70), {
    isStatic: true,
    color: "#334155",
  });
  const arm = box(cx - 40, 200, 16, 260);
  arm.color = "#a855f7";
  world.add(pivot, arm);
  world.addConstraint(new PinJoint(pivot, arm, new Vec2(cx - 40, 77)));
  arm.angularVelocity = 1.5;

  // welded seesaw
  const fulcrum = new RigidBody(makeRegularPolygon(3, 40), new Vec2(cx + 80, ground - 40), {
    isStatic: true,
    color: "#334155",
  });
  const plank = box(cx + 80, ground - 80, 200, 16);
  world.add(fulcrum, plank);
  world.addConstraint(new PinJoint(fulcrum, plank, new Vec2(cx + 80, ground - 80)));

  // target on the seesaw
  const tg1 = target(cx + 130, ground - 100);
  world.add(tg1);
  t.push({ body: tg1, downLine: ground - 10, done: false });

  // target behind a wall
  const wallX = cx + 220;
  world.add(box(wallX, ground - 60, 16, 120));
  const tg2 = target(wallX + 50, ground - 30);
  world.add(tg2);
  t.push({ body: tg2, downLine: ground - 10, done: false });

  return t;
}

export const LEVELS: Level[] = [
  {
    name: "Stack Attack",
    hint: "Knock both green targets off their towers. Aim high and use the arc.",
    shots: 3,
    build: level1,
  },
  {
    name: "Welded Keep",
    hint: "One target sits on a welded tower. The other hangs from a chain — snap the chain or topple the anchor.",
    shots: 4,
    build: level2,
  },
  {
    name: "Pendulum Gauntlet",
    hint: "Time your shot past the swinging pendulum. The seesaw target flies far — hit the plank's left end.",
    shots: 5,
    build: level3,
  },
];

// ---------------------------------------------------------------------------
// Slingshot
// ---------------------------------------------------------------------------

export interface Slingshot {
  /** anchor point where the band attaches (the fork of the slingshot) */
  anchor: Vec2;
  /** max drag distance from anchor (controls power) */
  maxDrag: number;
  /** current drag position (null = not aiming) */
  drag: Vec2 | null;
  /** the projectile currently sitting in the sling (null after firing) */
  loaded: RigidBody | null;
}

export function createSlingshot(world: PhysicsWorld, x: number, y: number): Slingshot {
  const anchor = new Vec2(x, y);
  // a static fork post for visuals
  world.add(
    new RigidBody(makeBox(14, 80), new Vec2(x, y + 50), {
      isStatic: true,
      color: "#334155",
    }),
  );
  // loaded projectile (kinematic so it stays put while aiming)
  const proj = new RigidBody(makeRegularPolygon(6, 16), new Vec2(x, y), {
    density: 0.08,
    restitution: 0.35,
    staticFriction: 0.4,
    dynamicFriction: 0.3,
    color: PROJECTILE_COLOR,
  });
  proj.setKinematic(true);
  world.add(proj);
  return { anchor, maxDrag: 140, drag: null, loaded: proj };
}

/** place the loaded projectile at the drag position (clamped to max range) */
export function aimSlingshot(sling: Slingshot, worldPos: Vec2): void {
  if (!sling.loaded) return;
  const d = worldPos.sub(sling.anchor);
  const len = d.len();
  if (len > sling.maxDrag) {
    d.imul(sling.maxDrag / len);
  }
  sling.drag = sling.anchor.add(d);
  sling.loaded.position.copy(sling.drag);
  sling.loaded.velocity.set(0, 0);
  sling.loaded.angularVelocity = 0;
  sling.loaded.sync();
}

/** fire: release the projectile with velocity proportional to drag distance */
export function fireSlingshot(sling: Slingshot): RigidBody | null {
  if (!sling.loaded || !sling.drag) return null;
  const proj = sling.loaded;
  const pull = sling.anchor.sub(sling.drag); // direction from drag -> anchor = launch direction
  const power = pull.len() / sling.maxDrag; // 0..1
  const speed = 200 + power * 1400; // px/s
  const dir = pull.normalize();
  proj.setKinematic(false);
  proj.velocity = dir.mul(speed);
  proj.angularVelocity = (Math.random() - 0.5) * 6;
  proj.sync();
  const fired = proj;
  sling.loaded = null;
  sling.drag = null;
  return fired;
}

/** reload a fresh projectile into the sling */
export function reloadSlingshot(sling: Slingshot, world: PhysicsWorld): void {
  if (sling.loaded) return;
  const proj = new RigidBody(makeRegularPolygon(6, 16), new Vec2(sling.anchor.x, sling.anchor.y), {
    density: 0.08,
    restitution: 0.35,
    staticFriction: 0.4,
    dynamicFriction: 0.3,
    color: PROJECTILE_COLOR,
  });
  proj.setKinematic(true);
  world.add(proj);
  sling.loaded = proj;
  sling.drag = null;
}

// ---------------------------------------------------------------------------
// Game renderer (extends the base renderer with slingshot + HUD overlays)
// ---------------------------------------------------------------------------

export function renderGame(
  ctx: CanvasRenderingContext2D,
  world: PhysicsWorld,
  width: number,
  height: number,
  sling: Slingshot,
  targets: Target[],
  opts: { showDebug: boolean; broadphasePairs?: [RigidBody, RigidBody][] },
): void {
  const debug = {
    showAABB: opts.showDebug,
    showVelocity: opts.showDebug,
    showContacts: opts.showDebug,
    showNormals: opts.showDebug,
    showBroadphase: opts.showDebug,
    showGrid: false,
  };

  renderWorld(ctx, world, width, height, {
    colors: COLORS,
    debug,
    manifolds: world.manifolds,
    broadphasePairs: opts.broadphasePairs,
  });

  // draw target down-lines + glow
  for (const t of targets) {
    ctx.save();
    ctx.strokeStyle = t.done ? "rgba(52,211,153,0.15)" : "rgba(52,211,153,0.3)";
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, t.downLine);
    ctx.lineTo(width, t.downLine);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!t.done) {
      // glow around live target
      const p = t.body.position;
      const g = ctx.createRadialGradient(p.x, p.y, 8, p.x, p.y, 28);
      g.addColorStop(0, "rgba(52,211,153,0.4)");
      g.addColorStop(1, "rgba(52,211,153,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // draw slingshot band + fork
  ctx.save();
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(sling.anchor.x - 14, sling.anchor.y);
  ctx.lineTo(sling.anchor.x, sling.anchor.y);
  ctx.lineTo(sling.anchor.x + 14, sling.anchor.y);
  ctx.stroke();

  if (sling.drag && sling.loaded) {
    // bands from fork tips to the projectile
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sling.anchor.x - 14, sling.anchor.y);
    ctx.lineTo(sling.drag.x, sling.drag.y);
    ctx.moveTo(sling.anchor.x + 14, sling.anchor.y);
    ctx.lineTo(sling.drag.x, sling.drag.y);
    ctx.stroke();

    // aim trajectory preview (dotted, projected ignoring gravity for a rough guide)
    const pull = sling.anchor.sub(sling.drag);
    const power = pull.len() / sling.maxDrag;
    const speed = 200 + power * 1400;
    const dir = pull.normalize();
    ctx.strokeStyle = "rgba(251,113,133,0.5)";
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sling.drag.x, sling.drag.y);
    let px = sling.drag.x;
    let py = sling.drag.y;
    let vx = dir.x * speed;
    let vy = dir.y * speed;
    const g = 980;
    const dt2 = 1 / 60;
    for (let i = 0; i < 40; i++) {
      vy += g * dt2;
      px += vx * dt2;
      py += vy * dt2;
      if (py > height || px > width || px < 0) break;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
