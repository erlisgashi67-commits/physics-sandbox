---
Task ID: 1
Agent: main (Z.ai Code)
Task: Build a custom 2D physics engine from scratch (HTML5 Canvas + TypeScript, no physics libraries) as an interactive rigid-body sandbox.

Work Log:
- Explored the existing Next.js 16 + TS + shadcn/ui scaffold (read page.tsx, layout, globals.css, slider/button/select/switch/card/tabs components).
- Built a pure-TypeScript physics core in `src/lib/physics/` (no React, no libs):
  - `vector.ts` — Vec2 class (dot, 2D cross scalar & scalar×vector, rotate, perp, in-place ops).
  - `shapes.ts` — Circle + convex Polygon (CCW, centroid-centered, precomputed outward normals), builders (box, regular polygon), polygon area/centroid/inertia.
  - `body.ts` — RigidBody (linear+angular state, mass/inertia, material, kinematic/static flags, cached world verts/normals/AABB, grab helpers).
  - `manifold.ts` — collision detection: Circle-Circle, Circle-Polygon (Voronoi face/vertex test), Polygon-Polygon (full SAT + Sutherland-Hodgman contact clipping → up to 2 contacts).
  - `world.ts` — fixed-timestep pipeline: integrate forces → sync → broad phase (AABB pairs) → narrow phase → sequential impulse solver (normal+friction, Coulomb cone) → integrate position → Baumgarte position correction → NaN guard.
- Built the canvas renderer (`src/components/physics/canvas-renderer.ts`) with debug overlays: AABB, velocity vectors, contact points, contact normals, broadphase pairs, grid, spawn-ghost.
- Built sandbox helpers (`sandbox-helpers.ts`): body factory, walls, presets (stack, pyramid, dominoes, seesaw, rain).
- Built the interactive React component (`physics-sandbox.tsx`): DPR-aware canvas + ResizeObserver, fixed-timestep game loop with accumulator, pointer grab/throw (kinematic body driven by cursor), spawn-on-click, right-click delete, keyboard shortcuts, live sliders (gravity/restitution/friction/time-scale/size), debug toggles, throttled HUD stats.
- Wired `page.tsx`: dark "engineering lab" theme, header, sandbox, sticky footer; `globals.css` thin-scrollbar utility.
- Fixed React 19 lint issues (refs/immutability rules) by routing world mutations through PhysicsWorld/RigidBody methods instead of direct ref-property writes.
- **Fixed a critical SAT bug found via Agent-Browser verification**: the Sutherland-Hodgman side-plane clip used the wrong constant (`-Dot(spn,v2)` instead of `-Dot(spn,v1)`) and the final depth test used the side constant instead of the face-normal constant — boxes fell through the floor. Re-derived the clipping math from scratch and corrected both. After fix: stable stacking, correct contacts.
- Verified end-to-end with Agent Browser + VLM: box rests on floor, circle rests on floor, 21-box pyramid stacks cleanly (42 resting contacts), mouse grab follows cursor with yellow kinematic outline, release resumes gravity, elastic bounce at restitution=1, debug overlays (AABB + contacts) render, desktop + mobile responsive, sticky footer pinned, no runtime errors, lint clean.

Stage Summary:
- Delivered a complete from-scratch 2D rigid-body physics engine with SAT collision, impulse resolution, friction, restitution, and a polished interactive sandbox — zero physics libraries.
- All core interactions browser-verified: spawning, dragging/throwing, stacking stability, elastic bouncing, debug overlays, responsive layout, sticky footer.
- Key lesson confirmed: the contact-clipping math (the "finicky" part the task warned about) was exactly where the bug lived; only end-to-end browser verification caught it (boxes silently fell through the floor while the body counter still reported them present).
