# Contributing to Rigid Body Sandbox

Thanks for your interest in contributing! This project is a hand-rolled 2D
physics engine — the kind of thing where the math is public knowledge but
_gluing it into a stable loop_ is the actual craft. PRs that improve stability,
add shapes, or fix subtle glitches are very welcome.

## Quick links

- **Physics core**: [`src/lib/physics/`](./src/lib/physics)
- **Renderer**: [`src/components/physics/canvas-renderer.ts`](./src/components/physics/canvas-renderer.ts)
- **Sandbox UI + game loop**: [`src/components/physics-sandbox.tsx`](./src/components/physics-sandbox.tsx)
- **Presets / body factory**: [`src/components/physics/sandbox-helpers.ts`](./src/components/physics/sandbox-helpers.ts)

## Development setup

```bash
bun install
bun run dev      # http://localhost:3000
bun run lint     # ESLint (must pass)
bunx tsc --noEmit  # type-check (must pass)
```

CI runs `bun run lint` + `tsc --noEmit` on every push and PR — both must be green.

## Architecture

The engine is deliberately split into pure- TypeScript modules with **no React
and no DOM access** in the core. This keeps the physics testable in isolation.

```
src/lib/physics/
├── vector.ts     Vec2 — all 2D linear algebra (dot, cross, rotate, perp)
├── shapes.ts     Circle + convex Polygon, builders, mass/inertia helpers
├── body.ts       RigidBody — state, cached world transforms, material
├── manifold.ts   Collision detection (SAT + Sutherland-Hodgman clipping)
├── world.ts      PhysicsWorld — fixed-timestep pipeline + impulse solver
└── index.ts      barrel export
```

### The simulation pipeline (one fixed step)

1. **Integrate forces** — gravity + accumulated forces → velocity
2. **Sync transforms** — recompute world vertices / normals / AABBs
3. **Broad phase** — O(n²) AABB overlap pairs
4. **Narrow phase** — build manifolds (SAT / circle tests)
5. **Solve** — `iterations` passes of sequential impulse (normal + friction)
6. **Integrate velocity** → position
7. **Position correction** — Baumgarte stabilization to kill sinking
8. **Final sync** — consistent state for the renderer

The fixed timestep (`1/60s`) is decoupled from the render loop via an
accumulator, so the simulation is deterministic regardless of display refresh
rate.

## How to extend

### Add a new preset scene

Presets live in [`sandbox-helpers.ts`](./src/components/physics/sandbox-helpers.ts).
Add a function `presetX(world, w, h, material)` that spawns bodies, then register
it in the `PRESETS` array and `runPreset` switch in `physics-sandbox.tsx`.

```ts
export function presetX(world: PhysicsWorld, w: number, h: number, mat: MaterialSettings) {
  const ball = createBody("circle", 24, w / 2, 80, mat);
  world.add(ball);
}
```

### Add a new shape kind

1. Add the kind to `Shape` in [`shapes.ts`](./src/lib/physics/shapes.ts) and
   implement geometry + `halfExtents` + `clone`.
2. Update mass helpers (`shapeArea`, `shapeInertia`) in [`body.ts`](./src/lib/physics/body.ts).
3. Add a collision routine in [`manifold.ts`](./src/lib/physics/manifold.ts) and
   dispatch it from `detect()`.
4. Render it in [`canvas-renderer.ts`](./src/components/physics/canvas-renderer.ts).

### Tune the solver

Stability knobs live in [`world.ts`](./src/lib/physics/world.ts):

- `iterations` — more = stiffer stacks, more CPU. 8–16 is typical.
- `SLOP` — penetration allowance before position correction (default `0.05`).
- `CORRECTION_PERCENT` — fraction of penetration corrected per step (default `0.4`).
  Too high → jitter; too low → slow sinking.
- `linearDamping` / `angularDamping` — mild velocity decay.

## Debugging physics glitches

The sandbox ships with overlays exactly for this — turn them on in the
**Debug Overlays** panel:

- **Contact points** (red dots) — if these vanish mid-stack, your SAT clipping
  stopped producing contacts (the classic "fall through the floor" bug).
- **Contact normals** (cyan lines) — should point from A→B and look consistent
  across a resting stack.
- **AABB** (yellow boxes) — sanity-check the broad phase.
- **Velocity vectors** (green) — should be near-zero for resting bodies.

When something falls through, the body counter in the HUD will often still
report the body as present — always cross-check with a visual, not just the
counter.

## Style & conventions

- **TypeScript throughout**, strict typing, no `any` in the physics core.
- shadcn/ui for UI components; don't hand-roll new ones if one exists.
- No new runtime dependencies for the physics core — the whole point is
  "no libraries". Renderer/UI deps are fine.
- Keep the core React-free and DOM-free so it stays portable.

## Pull request checklist

- [ ] `bun run lint` passes
- [ ] `bunx tsc --noEmit` passes
- [ ] No new runtime deps in the physics core
- [ ] If you changed collision/resolution: tested with the Pyramid preset
      (21 boxes) — must stay stable for 10+ seconds with no sinking/jitter
- [ ] If you added a feature: update the README if user-facing

## License

By contributing you agree your contributions are licensed under the project's
[MIT license](./LICENSE).
