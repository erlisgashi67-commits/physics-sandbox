# Building a 2D Physics Engine From Scratch (And the Bug That Almost Shipped)

*How I built a rigid-body physics sandbox with HTML5 Canvas and TypeScript —
zero libraries — and why "it compiles" nearly cost me everything.*

---

## The premise

Here's a confession: every time I've used a physics engine — Matter.js, Box2D,
p2 — I treated it as a black box. Gravity goes in, bodies fall down, collisions
*somehow* don't explode. It works. I ship. I never understood the *how*.

So I decided to build one. From scratch. No physics libraries, no game
framework. Just HTML5 Canvas, raw TypeScript, and the math I half-remembered
from university. The goal wasn't to beat Box2D — it was to finally understand
what happens between "I called `addBody()`" and "the box stopped moving."

What I learned: the formulas are public knowledge. The **glue** — stitching
them into a stable game loop where stacks don't jitter and boxes don't fall
through floors — is the actual craft. And it's where everything almost went
wrong.

---

## The shape of the problem

A 2D rigid-body engine needs to answer four questions, every frame, for every
pair of bodies:

1. **Are they touching?** (collision *detection*)
2. **Where exactly, and how deep?** (the *manifold*)
3. **What impulse stops them overlapping?** (collision *resolution*)
4. **How do I keep them from sinking over time?** (position *correction*)

Everything else — gravity, friction, restitution — is just flavor applied
around those four answers.

I split the engine into five files, each with one job:

```
src/lib/physics/
├── vector.ts     the math primitives
├── shapes.ts     circles + convex polygons
├── body.ts       a single rigid body's state
├── manifold.ts   "are they touching, and where?"
└── world.ts      the game loop + "what impulse fixes it?"
```

The rule: **no React, no DOM, no dependencies in the core.** Pure TypeScript
that could run in any runtime. The renderer and UI wrap it; they don't define
it.

---

## The math you actually need

Most of "physics" in a 2D engine is surprisingly mundane. You need:

- **Vectors** — add, subtract, dot product, cross product, rotate.
- **A 2D cross product trick.** In 3D, cross product gives a vector. In 2D, it
  gives a *scalar* (`ax·by − ay·bx`), which is the z-component of the would-be
  3D cross. This scalar is the engine's secret weapon: it tells you both the
  signed area of a parallelogram *and* the torque from a force at an offset.

That's it. That's the foundation. Everything else builds on these.

The one formula people actually remember — `F = ma` — shows up as integration:
each frame, `velocity += gravity × dt`, then `position += velocity × dt`.
(Euler integration. Not the most accurate, but fine for a sandbox where
nothing's going to space.)

---

## Collision detection: the Separating Axis Theorem

Here's where it gets interesting. Two convex polygons are **disjoint** if and
only if there exists an axis (one of their edge normals) on which their
projections don't overlap. That's SAT. Test all candidate axes; if any
separates, they don't touch. If none does, the least-overlapping axis is your
**collision normal**.

SAT tells you *that* they overlap and *by how much*. But it doesn't tell you
*where* the contact points are. And for stable stacking — a pyramid of boxes —
you need **two** contact points per collision, not one. One point makes stacks
wobble and collapse like a house of cards.

So after SAT finds the reference face, you do **Sutherland-Hodgman clipping**:
take the incident polygon's edge, clip it against the reference face's two
side planes, and keep the points that end up penetrating. You get up to two
contacts. *This* is what makes a pyramid stay standing.

The whole routine lives in [`manifold.ts`](../src/lib/physics/manifold.ts),
and it's about 80 lines of the most carefully-written code in the project.

---

## Resolution: impulses, not forces

When two bodies overlap, you don't move them apart directly. You apply an
**impulse** — an instantaneous change in velocity — along the collision normal,
sized to cancel their approaching relative velocity (scaled by restitution for
bounciness).

```
j = -(1 + e) · (v_rel · n) / (1/mA + 1/mB + ...)
```

The `...` is the angular contribution: a contact point offset from a body's
center of mass creates torque, which creates angular velocity. The full
denominator includes `rA × n` and `rB × n` terms, squared, scaled by inverse
inertia. This is why a box hit on its corner spins, but hit on its face it
just moves.

Friction is the same idea along the **tangent** (perpendicular to the normal),
clamped to a cone: `|jt| ≤ μ · j`. That's Coulomb's friction model, and it's
why a box on a slope either stays put or slides — depending on the angle.

I run the whole solver **10 iterations** per frame. More iterations = stiffer
stacks, more CPU. Ten is the sweet spot for a sandbox.

---

## The bug that almost shipped

Here's where the story turns. I had the engine. I had the renderer. Lint
passed. The dev server ran clean. The body counter ticked up when I spawned
things. I was about to call it done.

Then I opened the browser.

The canvas showed a grid. **No boxes.** I'd spawned a pyramid — the counter
said 21 bodies — but the canvas was empty. Just the spawn-ghost dashed
outline following my cursor.

The boxes had **fallen through the floor**. Silently. The body counter still
reported them because they still existed in the world — they were just
hundreds of pixels below the viewport, accelerating toward infinity.

### What went wrong

In the Sutherland-Hodgman clipping, I'd written:

```ts
const negSide = -sidePlaneNormal.dot(wv2);  // ← WRONG
```

It should have been `wv1`, not `wv2`. One character. The side-plane clip
constant was computed from the wrong vertex, so the clipping plane sat at the
wrong offset, so the contact points were discarded, so the manifold came back
empty, so the solver never applied an impulse, so gravity won unopposed.

And the final depth test had a similar error — it tested against the side
constant instead of the face-normal constant. Two transcription mistakes,
both in the most mathematically dense 20 lines of the codebase.

### Why it was invisible

- **Lint passed.** It's not a lint error to subtract the wrong variable.
- **TypeScript passed.** Both are `Vec2.dot(Vec2): number`. Types don't catch
  logic bugs.
- **The server ran.** No exception, no NaN, no crash. Just wrong numbers.
- **The body counter was misleading.** It counted *existing* bodies, not
  *visible* ones. The bodies existed — they were just off-screen.

The only thing that caught it was **looking at the actual rendered output**.
A screenshot revealed an empty canvas that the counter insisted was full.

### The lesson

> "It compiles" is not "it works." "The server runs" is not "the feature
> works." The only honest definition of *done* is: **a real user (or a
> browser acting as one) exercised the thing and saw the expected result.**

I now treat end-to-end browser verification as mandatory, not optional. A
clean build tells you the code is *syntactically* valid. It tells you nothing
about whether it *does what you meant*.

---

## The debug overlays: built for the bug

The most useful feature in the sandbox isn't a feature at all — it's the
debug overlays, born directly from the debugging session above:

- **Contact points** (red dots) — if these vanish mid-stack, your clipping
  stopped producing contacts. (This is the "boxes falling through floor"
  signature.)
- **Contact normals** (cyan lines) — should point consistently A→B across a
  resting stack. If they flicker or point inward, your normal-flip logic is
  wrong.
- **AABB** (yellow boxes) — sanity check the broad phase.
- **Velocity vectors** (green) — should be near-zero for resting bodies. If
  they're not, your solver isn't converging.

These aren't polish. They're the instruments you stare at when the math goes
wrong. Every physics engine needs them, and I built them *because* I needed
them.

---

## What I'd do differently

A few things I'd change if I kept going:

- **Broad-phase acceleration.** I used brute-force O(n²) AABB pairs, fine for
  a few hundred bodies. A sweep-and-prune or a uniform grid would scale to
  thousands.
- **Continuous collision detection.** My solver is discrete — fast-moving
  bodies can tunnel through thin obstacles. CCD (substepping or swept AABBs)
  would fix that.
- **A proper constraint solver.** Joints, hinges, ropes — these need a
  different resolution scheme (sequential impulses with equality constraints,
  not just contacts). Box2D's solver handles both; mine only does contacts.
- **Warm starting.** Remembering the previous frame's impulses to seed the
  current frame's solver. Dramatically improves stack stability at fewer
  iterations.

But that's the point — each of those is a *next* lesson. The engine as it
stands taught me the shape of the problem. And the shape of the bug.

---

## The takeaway

Building a physics engine from scratch is the kind of project where the
*knowledge* is free (Wikipedia has every formula) and the *understanding*
costs you a weekend of staring at a screenshot wondering where your boxes
went.

It's the best kind of hard: the kind where the bug isn't in the part you
don't understand, it's in the part you *thought* you understood. A one-
character transcription error in code I'd written myself, in math I could
derive on paper.

If you've ever used a physics engine as a black box and wondered what's
inside — build one. The formulas are waiting. The glue is the craft. And the
bug you'll ship will teach you more than the feature you meant to build.

---

*The full source is on [GitHub](https://github.com/erlisgashi67-commits/physics-sandbox),
and there's a live demo at [realphysics.com](https://realphysics.com/).
Every vector, every impulse, by hand.*
