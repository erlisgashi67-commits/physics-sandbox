/**
 * Factory helpers for the sandbox: building bodies, walls and preset scenes.
 * Kept separate from the React component so the physics stays pure & testable.
 */

import { Vec2 } from "@/lib/physics/vector";
import { RigidBody } from "@/lib/physics/body";
import {
  CircleShape,
  makeBox,
  makeRegularPolygon,
} from "@/lib/physics/shapes";
import { PhysicsWorld } from "@/lib/physics/world";
import {
  DistanceJoint,
  PinJoint,
  WeldJoint,
  MotorJoint,
} from "@/lib/physics/constraints";
import type { SandboxShapeKind } from "@/components/physics/canvas-renderer";

const PALETTE = [
  "#fbbf24", // amber
  "#34d399", // emerald
  "#fb7185", // rose
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#e879f9", // fuchsia
  "#a3e635", // lime
  "#22d3ee", // cyan
  "#f87171", // red
  "#facc15", // yellow
];

let colorCursor = 0;
export function nextColor(): string {
  const c = PALETTE[colorCursor % PALETTE.length];
  colorCursor++;
  return c;
}

export interface MaterialSettings {
  restitution: number;
  friction: number;
  density?: number;
}

export function sidesOf(kind: SandboxShapeKind): number {
  switch (kind) {
    case "triangle":
      return 3;
    case "pentagon":
      return 5;
    case "hexagon":
      return 6;
    default:
      return 4;
  }
}

export function createBody(
  kind: SandboxShapeKind,
  size: number,
  x: number,
  y: number,
  material: MaterialSettings,
  color?: string,
): RigidBody {
  let shape;
  if (kind === "circle") {
    shape = new CircleShape(size);
  } else if (kind === "box") {
    shape = makeBox(size * 2, size * 2);
  } else {
    shape = makeRegularPolygon(sidesOf(kind), size);
  }

  const body = new RigidBody(shape, new Vec2(x, y), {
    density: material.density ?? 0.02,
    restitution: material.restitution,
    staticFriction: Math.min(material.friction * 1.3, 1),
    dynamicFriction: material.friction,
    color: color ?? nextColor(),
  });
  return body;
}

export interface WallOptions {
  thickness?: number;
  color?: string;
}

/** floor + left + right walls sized to a logical viewport (open top) */
export function buildWalls(
  w: number,
  h: number,
  opts: WallOptions = {},
): RigidBody[] {
  const t = opts.thickness ?? 60;
  const color = opts.color ?? "#1e293b";
  const wallMat = { restitution: 0.1, friction: 0.7, density: 1 };
  const floor = new RigidBody(makeBox(w + t * 2, t), new Vec2(w / 2, h + t / 2 - 1), {
    isStatic: true,
    color,
    ...wallMat,
  });
  const left = new RigidBody(makeBox(t, h + t * 2), new Vec2(-t / 2 + 1, h / 2), {
    isStatic: true,
    color,
    ...wallMat,
  });
  const right = new RigidBody(makeBox(t, h + t * 2), new Vec2(w + t / 2 - 1, h / 2), {
    isStatic: true,
    color,
    ...wallMat,
  });
  return [floor, left, right];
}

// ---------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------

export function presetStack(
  world: PhysicsWorld,
  w: number,
  h: number,
  material: MaterialSettings,
  count = 6,
): void {
  const size = 28;
  const cx = w / 2;
  const bottom = h - size - 2;
  for (let i = 0; i < count; i++) {
    const b = createBody("box", size, cx, bottom - i * (size * 2 + 4), material);
    b.angle = 0;
    world.add(b);
  }
}

export function presetPyramid(
  world: PhysicsWorld,
  w: number,
  h: number,
  material: MaterialSettings,
): void {
  const size = 26;
  const rows = 6;
  const cx = w / 2;
  const bottom = h - size - 2;
  for (let row = 0; row < rows; row++) {
    const count = rows - row;
    const y = bottom - row * (size * 2 + 2);
    const startX = cx - ((count - 1) * (size * 2 + 2)) / 2;
    for (let i = 0; i < count; i++) {
      const b = createBody("box", size, startX + i * (size * 2 + 2), y, material);
      b.angle = 0;
      world.add(b);
    }
  }
}

export function presetDominoes(
  world: PhysicsWorld,
  w: number,
  h: number,
  material: MaterialSettings,
): void {
  const cx = w / 2;
  const count = 9;
  const spacing = 46;
  const dominoH = 70;
  const dominoW = 14;
  const startX = cx - ((count - 1) * spacing) / 2;
  const y = h - dominoH / 2 - 2;
  for (let i = 0; i < count; i++) {
    const shape = makeBox(dominoW, dominoH);
    const b = new RigidBody(shape, new Vec2(startX + i * spacing, y), {
      density: 0.02,
      restitution: material.restitution,
      staticFriction: Math.min(material.friction * 1.3, 1),
      dynamicFriction: material.friction,
      color: nextColor(),
    });
    world.add(b);
  }
  // a ball rolling in from the left to topple the first domino
  const ball = createBody("circle", 22, startX - 120, h - 60, material);
  ball.velocity.set(420, 0);
  world.add(ball);
}

export function presetSeesaw(
  world: PhysicsWorld,
  w: number,
  h: number,
  material: MaterialSettings,
): void {
  const cx = w / 2;
  const pivotY = h - 80;
  // static triangular pivot
  const pivot = new RigidBody(
    makeRegularPolygon(3, 46),
    new Vec2(cx, pivotY),
    { isStatic: true, color: "#334155", restitution: 0.1, friction: 0.8 },
  );
  // start the plank flat, resting on the pivot apex
  const plank = new RigidBody(
    makeBox(320, 18),
    new Vec2(cx, pivotY - 46 - 9),
    {
      density: 0.02,
      restitution: material.restitution,
      staticFriction: Math.min(material.friction * 1.3, 1),
      dynamicFriction: material.friction,
      color: nextColor(),
    },
  );
  // a heavy ball on the left end
  const ball = createBody("circle", 30, cx - 130, pivotY - 46 - 9 - 60, {
    ...material,
    density: 0.06,
  });
  world.add(pivot, plank, ball);
}

export function presetRain(
  world: PhysicsWorld,
  w: number,
  _h: number,
  material: MaterialSettings,
  count = 40,
): void {
  const kinds: SandboxShapeKind[] = ["circle", "box", "triangle", "pentagon", "hexagon"];
  for (let i = 0; i < count; i++) {
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const size = 14 + Math.random() * 22;
    const x = 40 + Math.random() * (w - 80);
    const y = -40 - Math.random() * 300;
    const b = createBody(kind, size, x, y, material);
    b.velocity.set((Math.random() - 0.5) * 120, Math.random() * 60);
    b.angularVelocity = (Math.random() - 0.5) * 4;
    world.add(b);
  }
}

// ---------------------------------------------------------------------------
// joint presets — showcase the new constraint solver
// ---------------------------------------------------------------------------

/** a chain of boxes hanging from the ceiling by distance joints */
export function presetChain(
  world: PhysicsWorld,
  w: number,
  h: number,
  material: MaterialSettings,
): void {
  const cx = w / 2;
  const linkW = 16;
  const linkH = 26;
  const count = 8;
  // static ceiling anchor
  const anchor = new RigidBody(makeBox(40, 14), new Vec2(cx, 60), {
    isStatic: true,
    color: "#334155",
  });
  world.add(anchor);
  let prev: RigidBody = anchor;
  for (let i = 0; i < count; i++) {
    const link = new RigidBody(makeBox(linkW, linkH), new Vec2(cx, 80 + i * (linkH + 4)), {
      density: 0.04,
      restitution: material.restitution,
      staticFriction: Math.min(material.friction * 1.3, 1),
      dynamicFriction: material.friction,
      color: nextColor(),
    });
    world.add(link);
    // distance joint from prev bottom to this top — a flexible rope
    const pA = prev.worldPoint(new Vec2(0, prev.isStatic ? 7 : linkH / 2));
    const pB = link.worldPoint(new Vec2(0, -linkH / 2));
    world.addConstraint(new DistanceJoint(prev, link, pA, pB, { length: 6 }));
    prev = link;
  }
  // a heavy ball at the end to swing the chain
  const ball = createBody("circle", 24, cx, 80 + count * (linkH + 4) + 20, {
    ...material,
    density: 0.1,
  });
  world.add(ball);
  const pA = prev.worldPoint(new Vec2(0, linkH / 2));
  const pB = ball.worldPoint(new Vec2(0, 0));
  world.addConstraint(new DistanceJoint(prev, ball, pA, pB, { length: 8 }));
}

/** a pendulum + a welded "rigid bar" structure to contrast joint types */
export function presetPendulum(
  world: PhysicsWorld,
  w: number,
  h: number,
  material: MaterialSettings,
): void {
  const cx = w / 2;
  // static pivot
  const pivot = new RigidBody(makeBox(30, 14), new Vec2(cx, 70), {
    isStatic: true,
    color: "#334155",
  });
  world.add(pivot);
  // long rod hanging from the pivot via a pin (hinge) joint
  const rodLen = 220;
  const rod = new RigidBody(makeBox(16, rodLen), new Vec2(cx, 70 + rodLen / 2 + 4), {
    density: 0.03,
    restitution: material.restitution,
    staticFriction: Math.min(material.friction * 1.3, 1),
    dynamicFriction: material.friction,
    color: nextColor(),
  });
  world.add(rod);
  // pin joint at the top — allows rotation
  const hingePoint = rod.worldPoint(new Vec2(0, -rodLen / 2));
  world.addConstraint(new PinJoint(pivot, rod, hingePoint));
  // give it a nudge
  rod.angularVelocity = 1.2;

  // welded structure to the right: two boxes fused into one rigid body
  const wx = cx + 200;
  const wy = h - 80;
  const base = new RigidBody(makeBox(80, 40), new Vec2(wx, wy), {
    density: 0.04,
    restitution: material.restitution,
    staticFriction: Math.min(material.friction * 1.3, 1),
    dynamicFriction: material.friction,
    color: nextColor(),
  });
  const top = new RigidBody(makeBox(40, 50), new Vec2(wx, wy - 45), {
    density: 0.04,
    restitution: material.restitution,
    staticFriction: Math.min(material.friction * 1.3, 1),
    dynamicFriction: material.friction,
    color: nextColor(),
  });
  world.add(base, top);
  // weld at the contact — locks them rigid
  world.addConstraint(new WeldJoint(base, top, new Vec2(wx, wy - 20)));

  // a motorized "spinner" to the left: static body + driven rotating arm
  const mx = cx - 200;
  const my = h - 100;
  const motorBase = new RigidBody(makeBox(30, 30), new Vec2(mx, my), {
    isStatic: true,
    color: "#334155",
  });
  const arm = new RigidBody(makeBox(120, 16), new Vec2(mx, my), {
    density: 0.03,
    restitution: material.restitution,
    staticFriction: Math.min(material.friction * 1.3, 1),
    dynamicFriction: material.friction,
    color: nextColor(),
  });
  world.add(motorBase, arm);
  // motor drives the arm to spin
  world.addConstraint(
    new MotorJoint(motorBase, arm, { targetAngle: Math.PI * 2, maxForce: 200 }),
  );
}

export type PresetName =
  | "stack"
  | "pyramid"
  | "dominoes"
  | "seesaw"
  | "rain"
  | "chain"
  | "pendulum";
