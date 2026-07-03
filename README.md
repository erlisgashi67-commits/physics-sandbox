# Rigid Body Sandbox — A Custom 2D Physics Engine

A from-scratch 2D rigid-body physics engine and interactive sandbox, built with
**HTML5 Canvas + TypeScript** — **zero physics libraries**.

No Matter.js, no Box2D, no p2. Every vector operation, every collision test, every
impulse is implemented by hand. The hard part — gluing the Separating Axis Theorem
into a stable game loop so stacks don't jitter or fall through the floor — is the
whole point of this project.

![Demo](./public/demo.gif)

[![Live Demo](https://img.shields.io/badge/🌐_live-erlisgashi67.github.io-cyan)](https://erlisgashi67-commits.github.io/physics-sandbox/)
![Rigid Body Sandbox](https://img.shields.io/badge/physics-from%20scratch-amber)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

### Physics core (`src/lib/physics/`)
- **`vector.ts`** — full 2D vector algebra: dot, both cross-product forms
  (scalar and scalar×vector), rotate, perpendicular, in-place mutators for the
  hot solver loops.
- **`shapes.ts`** — circles + convex polygons. Polygons are built CCW,
  re-centered on their centroid, with precomputed outward edge normals. Includes
  builders for boxes and regular n-gons, plus shoelace area / centroid / mass
  moment of inertia.
- **`body.ts`** — rigid bodies with linear + angular state, mass/inertia
  properties, material settings, cached world-space vertices/normals/AABBs, and
  kinematic/static flags for the mouse grab.
- **`manifold.ts`** — collision detection for all shape pairs:
  - Circle ↔ Circle (direct distance test)
  - Circle ↔ Polygon (Voronoi face/vertex region test)
  - **Polygon ↔ Polygon — full SAT + Sutherland-Hodgman contact clipping**,
    producing up to 2 contact points per manifold.
- **`constraints.ts`** — sequential-impulse constraint solver with 4 joint types:
  - **DistanceJoint** — keeps two anchors a fixed distance apart (rods/ropes).
    Supports soft constraints via Catto's frequency/damping model.
  - **PinJoint** (hinge) — keeps two anchors coincident; allows free rotation
    around the pivot. Uses a 2×2 effective mass matrix.
  - **WeldJoint** — locks two bodies together (position + angle). Combines a
    pin joint with an angular constraint.
  - **MotorJoint** — drives the relative angle toward a target (a servo).
    Keeps the linear offset + applies clamped angular correction.
  - Warm starting + Baumgarte position correction per joint.
- **`world.ts`** — fixed-timestep simulation pipeline:
  1. integrate forces (gravity + accumulated forces → velocity)
  2. sync transforms (recompute world verts/normals/AABBs)
  3. broad phase (AABB overlap pairs, O(n²))
  4. narrow phase (build manifolds)
  5. **solve constraints** — N iterations, joints before contacts each pass
  6. **solve contacts** — normal impulse (restitution) + tangential (Coulomb
     friction cone)
  7. integrate velocity → position
  8. **Baumgarte position correction** for contacts + joints
  9. NaN guard for solver blow-ups
- **CCD (continuous collision detection)** — if any body's per-frame
  displacement exceeds a fraction of its size, the whole step is sub-stepped
  (up to 8×). Prevents fast projectiles from tunnelling through thin walls.

### Interactive sandbox (`src/components/`)
- DPR-aware canvas renderer with a stable accumulator game loop
- **Mouse grab & throw** — bodies go kinematic while held (yellow outline),
  inherit the cursor's velocity on release
- Click empty space to **spawn**, right-click to **delete**
- Live sliders: gravity, restitution, friction, time-scale, spawn size
- 7 presets: **Stack, Pyramid, Dominoes, Seesaw, Chain, Joints, Rain**
  - *Chain* — a hanging chain of boxes linked by distance joints
  - *Joints* — a pendulum (pin) + welded structure (weld) + motorized spinner (motor)
- **Debug overlays** (the things you stare at when it glitches):
  - AABB (broad-phase bounds)
  - Velocity vectors
  - Contact points (red dots)
  - Contact normals (cyan lines)
  - Broadphase pairs (purple lines)
  - Grid
- Keyboard shortcuts: `Space` pause, `1`–`5` pick shape, `R`/`C` clear
- Throttled HUD: FPS, body count, contact count, joint count, CCD substeps

### Siege — a demolition game on top of the engine (`src/components/siege-game.*`)

![Siege](./public/siege.png)

A slingshot demolition game that exercises every engine feature — joints, CCD,
and the impulse solver together:

- **Slingshot mechanic** — drag back to aim, trajectory preview arc, release
  to fire with power proportional to pull distance
- **CCD projectiles** — fast shots don't tunnel through structures
- **Jointed structures** — welds, pins, distance joints, and a motor all
  appear across the levels
- **3 levels**: *Stack Attack* (knock targets off towers), *Welded Keep* (a
  welded fortress + a target hanging from a soft distance-joint chain),
  *Pendulum Gauntlet* (time your shot past a hinged swinging pendulum + a
  pin-jointed seesaw)
- **Win/lose + scoring** — knock all targets below the dotted line to win;
  500/target + 1000 win bonus + 500/remaining shot

---

## Getting started

```bash
# install
bun install

# run the dev server (http://localhost:3000)
bun run dev

# lint
bun run lint
```

Open the app, try the **Pyramid** preset, then grab a box out of the middle and
fling it — the stack stays stable. Or switch to the **Joints** preset to see a
pendulum, a welded structure, and a motorized spinner running off the constraint
solver. Or flip the mode switch to **Siege** and play the demolition game.

---

## How it works (the interesting bits)

### SAT + contact clipping

For two convex polygons, the Separating Axis Theorem says they're disjoint iff
some axis (one of the edge normals) separates them. When they overlap, the
least-penetrating axis becomes the **collision normal**, and the contact points
are found by **clipping the incident polygon's edge against the reference
polygon's face planes** (Sutherland-Hodgman). This is what gives you the two
contact points you need for stable stacking — a single point makes stacks wobble
and collapse.

### Impulse-based resolution

For each contact, the solver computes a normal impulse that cancels the
approaching relative velocity (scaled by restitution), plus a tangential impulse
clamped to the friction cone `|jt| ≤ μ · j`. Multiple solver iterations per step
converge to a consistent solution for stacks.

### Constraints (joints)

A constraint is an equation `C(state) = 0` that the solver drives toward zero
each step by applying impulses — the same framework Box2D uses (Erin Catto /
Randy Gaul), hand-rolled here. Each joint implements `prepare()` (compute the
Jacobian / effective mass), `solveVelocity()` (apply the corrective impulse,
called N times per step), and `solvePosition()` (project positions back toward
`C = 0`). Warm starting seeds each step with the previous frame's impulse for
faster convergence. Joints are solved *before* contacts each iteration so welded
structures stay rigid.

### CCD (continuous collision detection)

Discrete collision detection samples the world at fixed timesteps. A fast
projectile moving farther than its own size in one step can step cleanly through
a thin wall without ever overlapping it — "tunnelling." The CCD layer measures
each body's per-frame displacement against its size; if it exceeds a threshold
(`0.5×` the smallest dimension), the whole step is subdivided into substeps (up
to 8). This is what makes the Siege slingshot work — a high-power shot would
otherwise pass straight through the towers.

### Baumgarte position correction

Floating-point drift + discrete timesteps let bodies sink into each other by a
few pixels per frame. A small position correction (40% of penetration above a
0.05px slop) is applied along the contact normal each step to push them back out
without adding energy.

### The bug that almost shipped

The first pass had a transcription error in the clipping constants: the side-plane
clip used `-Dot(normal, v2)` instead of `-Dot(normal, v1)`, and the final depth
test used the side constant instead of the face-normal constant. The symptom was
sneaky — boxes **fell through the floor silently** while the body counter still
reported them present. Only end-to-end browser verification (a screenshot showed
an "empty" canvas that was actually just the spawn ghost) caught it.

---

## Tech stack

- **Next.js 16** (App Router) + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** for the control panel
- **HTML5 Canvas 2D** for rendering
- No physics libraries. No game framework. Just math.

---

## Contributing

PRs that improve solver stability, add shapes, or fix subtle glitches are very
welcome. See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the architecture
walkthrough, how to add presets/shapes, solver tuning knobs, and the debug
overlays to use when something falls through the floor.

## License

MIT — see [LICENSE](./LICENSE).
