"use client";

import * as React from "react";
import {
  Play,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Target as TargetIcon,
  Crosshair,
  Trophy,
  Skull,
} from "lucide-react";

import { Vec2 } from "@/lib/physics/vector";
import { PhysicsWorld } from "@/lib/physics/world";
import { RigidBody } from "@/lib/physics/body";
import {
  createSlingshot,
  aimSlingshot,
  fireSlingshot,
  reloadSlingshot,
  renderGame,
  LEVELS,
  type Slingshot,
  type Target,
  type GameState,
} from "@/components/physics/siege-game";

import { Button } from "@/components/ui/button";

const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 5;

export default function SiegeGame({ onExit }: { onExit: () => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const worldRef = React.useRef<PhysicsWorld | null>(null);
  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const slingRef = React.useRef<Slingshot | null>(null);
  const targetsRef = React.useRef<Target[]>([]);
  const activeProjectilesRef = React.useRef<Set<RigidBody>>(new Set());

  const [levelIdx, setLevelIdx] = React.useState(0);
  const levelIdxRef = React.useRef(0);
  React.useEffect(() => {
    levelIdxRef.current = levelIdx;
  }, [levelIdx]);

  const [game, setGame] = React.useState<GameState>({
    level: 1,
    shotsLeft: LEVELS[0].shots,
    targetsLeft: 0,
    status: "playing",
    score: 0,
  });
  const gameRef = React.useRef(game);
  React.useEffect(() => {
    gameRef.current = game;
  }, [game]);

  const [fps, setFps] = React.useState(60);

  // pointer state
  const pointerRef = React.useRef({
    x: 0,
    y: 0,
    down: false,
    aiming: false,
  });

  const sizeRef = React.useRef({ w: 800, h: 600, dpr: 1 });
  const rafRef = React.useRef<number>(0);
  const lastFrameRef = React.useRef<number>(0);
  const accRef = React.useRef<number>(0);
  const fpsAvgRef = React.useRef<number>(60);
  const fpsTickRef = React.useRef<number>(0);

  // ----- level setup -----
  const loadLevel = React.useCallback((idx: number) => {
    const world = new PhysicsWorld({
      gravity: new Vec2(0, 980),
      iterations: 10,
      ccdEnabled: true,
      ccdThreshold: 0.6,
    });
    worldRef.current = world;
    const { w, h } = sizeRef.current;
    const level = LEVELS[idx];
    const targets = level.build(world, w, h);
    targetsRef.current = targets;
    // slingshot on the left, ~1/6 in
    const sx = w * 0.14;
    const sy = h - 140;
    slingRef.current = createSlingshot(world, sx, sy);
    activeProjectilesRef.current = new Set();
    setGame({
      level: idx + 1,
      shotsLeft: level.shots,
      targetsLeft: targets.length,
      status: "playing",
      score: 0,
    });
  }, []);

  // ----- canvas sizing -----
  const resize = React.useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(240, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctxRef.current = ctx;
    }
    const prev = sizeRef.current;
    sizeRef.current = { w, h, dpr };
    if (prev.w !== w || prev.h !== h) {
      // rebuild current level at new size
      loadLevel(levelIdxRef.current);
    }
  }, [loadLevel]);

  // ----- pointer -----
  const toLocal = React.useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return new Vec2(clientX - rect.left, clientY - rect.top);
  }, []);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (gameRef.current.status !== "playing") return;
      const sling = slingRef.current;
      if (!sling || !sling.loaded) return;
      e.preventDefault();
      canvasRef.current!.setPointerCapture(e.pointerId);
      const p = toLocal(e.clientX, e.clientY);
      // start aiming if the press is near the loaded projectile or anywhere left-of-center
      pointerRef.current.down = true;
      pointerRef.current.aiming = true;
      aimSlingshot(sling, p);
    },
    [toLocal],
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!pointerRef.current.aiming) return;
      const sling = slingRef.current;
      if (!sling) return;
      const p = toLocal(e.clientX, e.clientY);
      aimSlingshot(sling, p);
    },
    [toLocal],
  );

  const onPointerUp = React.useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      try {
        canvasRef.current!.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      const ptr = pointerRef.current;
      ptr.down = false;
      ptr.aiming = false;
      const sling = slingRef.current;
      if (!sling || !sling.loaded || !sling.drag) return;
      // if barely dragged, don't fire (treat as a cancel)
      if (sling.anchor.sub(sling.drag).len() < 12) {
        sling.drag = null;
        return;
      }
      const fired = fireSlingshot(sling);
      if (fired) {
        (fired as RigidBody & { _firedAt?: number })._firedAt = performance.now();
        activeProjectilesRef.current.add(fired);
        setGame((g) => ({ ...g, shotsLeft: g.shotsLeft - 1 }));
      }
    },
    [],
  );

  // ----- main loop -----
  React.useEffect(() => {
    resize();
    const ro = new ResizeObserver(() => resize());
    if (containerRef.current) ro.observe(containerRef.current);

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const world = worldRef.current;
      const ctx = ctxRef.current;
      if (!world || !ctx) return;

      let dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;
      if (dt > 0.25) dt = 0.25;
      if (dt <= 0) dt = 1 / 120;

      // step physics
      accRef.current += dt;
      let steps = 0;
      while (accRef.current >= FIXED_DT && steps < MAX_SUBSTEPS) {
        world.step(FIXED_DT);
        accRef.current -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_SUBSTEPS) accRef.current = 0;

      // update targets: check if any fell below their down line
      const targets = targetsRef.current;
      let changed = false;
      for (const t of targets) {
        if (!t.done && t.body.position.y > t.downLine) {
          t.done = true;
          changed = true;
        }
      }

      // clean up projectiles that have settled or gone off-screen
      const { w, h } = sizeRef.current;
      const active = activeProjectilesRef.current;
      const nowMs = performance.now();
      for (const p of Array.from(active)) {
        const fired = (p as RigidBody & { _firedAt?: number })._firedAt ?? nowMs;
        const age = (nowMs - fired) / 1000;
        const settled = p.velocity.lenSq() < 100; // speed < 10 px/s
        const offscreen =
          p.position.y > h + 100 ||
          p.position.x < -100 ||
          p.position.x > w + 100;
        if (offscreen || (settled && age > 1.5) || age > 8) {
          if (offscreen || age > 8) world.remove(p);
          active.delete(p);
        }
      }

      // win/lose check (only after the level has actually loaded targets)
      if (gameRef.current.status === "playing" && targets.length > 0) {
        const remaining = targets.filter((t) => !t.done).length;
        if (remaining === 0) {
          setGame((g) => ({
            ...g,
            status: "won",
            targetsLeft: 0,
            score: g.score + 1000 + g.shotsLeft * 500,
          }));
        } else if (gameRef.current.shotsLeft <= 0 && active.size === 0) {
          // out of shots and nothing moving -> reload if targets remain?
          // reload one more shot so the player isn't stuck, but count as "last chance"
          const sling = slingRef.current;
          if (sling && !sling.loaded) {
            reloadSlingshot(sling, world);
          }
          // if still no shots and no projectiles moving -> lose
          if (gameRef.current.shotsLeft <= 0) {
            setGame((g) => ({ ...g, status: "lost", targetsLeft: remaining }));
          }
        }
        if (changed) {
          setGame((g) => ({
            ...g,
            targetsLeft: targets.filter((t) => !t.done).length,
            score: g.score + 500,
          }));
        }
      }

      // reload after a short delay if a shot was fired and none loaded
      const sling = slingRef.current;
      if (sling && !sling.loaded && gameRef.current.shotsLeft > 0 && active.size === 0) {
        reloadSlingshot(sling, world);
      }

      // render
      renderGame(ctx, world, w, h, sling ?? { anchor: new Vec2(), maxDrag: 1, drag: null, loaded: null }, targets, {
        showDebug: false,
      });

      // fps
      const instantFps = 1 / dt;
      fpsAvgRef.current = fpsAvgRef.current * 0.9 + instantFps * 0.1;
      fpsTickRef.current += dt;
      if (fpsTickRef.current >= 0.3) {
        fpsTickRef.current = 0;
        setFps(Math.round(fpsAvgRef.current));
      }
    };

    lastFrameRef.current = performance.now();
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [resize]);

  // load level on mount + when levelIdx changes
  React.useEffect(() => {
    loadLevel(levelIdx);
  }, [levelIdx, loadLevel]);

  // ----- controls -----
  const restart = () => loadLevel(levelIdx);
  const nextLevel = () => {
    if (levelIdx < LEVELS.length - 1) setLevelIdx(levelIdx + 1);
  };
  const prevLevel = () => {
    if (levelIdx > 0) setLevelIdx(levelIdx - 1);
  };

  const level = LEVELS[levelIdx];

  return (
    <div className="h-full flex flex-col lg:flex-row gap-3">
      {/* game stage */}
      <div
        ref={containerRef}
        className="relative h-[52vh] lg:h-auto lg:flex-1 min-h-0 rounded-xl overflow-hidden border border-neutral-800 bg-[#0b0e14] shadow-inner"
      >
        <canvas
          ref={canvasRef}
          className="block w-full h-full touch-none cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {/* top HUD */}
        <div className="pointer-events-none absolute top-3 left-3 right-3 flex justify-between items-start gap-2">
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <Badge tone="amber">Level {levelIdx + 1}: {level.name}</Badge>
              <Badge tone="emerald"><TargetIcon className="size-3" /> {game.targetsLeft}</Badge>
              <Badge tone="rose"><Crosshair className="size-3" /> {game.shotsLeft}</Badge>
              <Badge tone="muted">{fps} FPS</Badge>
            </div>
            <p className="text-[11px] text-neutral-400 max-w-md font-mono bg-neutral-900/70 rounded px-2 py-1 border border-neutral-800">
              {level.hint}
            </p>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={onExit} className="bg-neutral-900/70 border border-neutral-800">
              <ChevronLeft className="size-4" /> Sandbox
            </Button>
          </div>
        </div>

        {/* win/lose overlay */}
        {game.status !== "playing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="text-center p-6 rounded-xl border border-neutral-700 bg-neutral-900 max-w-sm">
              {game.status === "won" ? (
                <>
                  <Trophy className="size-12 text-amber-400 mx-auto mb-3" />
                  <h2 className="text-2xl font-bold text-amber-400 mb-1">Level Complete!</h2>
                  <p className="text-neutral-400 text-sm mb-4">
                    Score: <span className="text-emerald-400 font-mono">{game.score}</span>
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button size="sm" variant="outline" onClick={restart}>
                      <RotateCcw className="size-4" /> Replay
                    </Button>
                    {levelIdx < LEVELS.length - 1 && (
                      <Button size="sm" onClick={nextLevel}>
                        Next <ChevronRight className="size-4" />
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <Skull className="size-12 text-rose-400 mx-auto mb-3" />
                  <h2 className="text-2xl font-bold text-rose-400 mb-1">Out of Shots</h2>
                  <p className="text-neutral-400 text-sm mb-4">
                    {game.targetsLeft} target{game.targetsLeft === 1 ? "" : "s"} remaining.
                  </p>
                  <Button size="sm" onClick={restart}>
                    <RotateCcw className="size-4" /> Try Again
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* bottom hint */}
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex justify-center">
          <p className="text-[11px] text-neutral-500 font-mono bg-neutral-900/60 rounded px-3 py-1 border border-neutral-800">
            Drag the projectile back to aim · Release to fire
          </p>
        </div>
      </div>

      {/* side panel */}
      <aside className="flex-1 lg:flex-none lg:w-[280px] shrink-0 min-h-0 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900/70 backdrop-blur p-4 space-y-4 scroll-thin">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
            Siege
          </h3>
          <p className="text-xs text-neutral-300 leading-relaxed">
            A demolition game on top of the physics engine. Launch projectiles to knock the green targets
            below their dotted lines. Fast shots use <span className="text-cyan-400 font-mono">CCD</span> so
            they don't tunnel through walls. Structures use{" "}
            <span className="text-purple-400 font-mono">weld</span>,{" "}
            <span className="text-purple-400 font-mono">pin</span>, and{" "}
            <span className="text-purple-400 font-mono">distance</span> joints.
          </p>
        </div>

        <div className="border-t border-neutral-800 pt-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
            Stats
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="Level" value={`${levelIdx + 1} / ${LEVELS.length}`} />
            <Stat label="Score" value={game.score.toString()} />
            <Stat label="Shots left" value={game.shotsLeft.toString()} />
            <Stat label="Targets left" value={game.targetsLeft.toString()} />
          </div>
        </div>

        <div className="border-t border-neutral-800 pt-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
            Levels
          </h3>
          <div className="space-y-1.5">
            {LEVELS.map((l, i) => (
              <button
                key={i}
                onClick={() => setLevelIdx(i)}
                className={`w-full text-left text-xs px-3 py-2 rounded-md border transition-colors ${
                  i === levelIdx
                    ? "bg-amber-500/15 border-amber-500/50 text-amber-300"
                    : "bg-neutral-900/50 border-neutral-800 text-neutral-400 hover:border-neutral-700"
                }`}
              >
                <span className="font-mono mr-2">{i + 1}.</span>
                {l.name}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-neutral-800 pt-3 flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={restart}>
            <RotateCcw className="size-4" /> Restart
          </Button>
          {levelIdx > 0 && (
            <Button size="sm" variant="ghost" onClick={prevLevel}>
              <ChevronLeft className="size-4" />
            </Button>
          )}
          {levelIdx < LEVELS.length - 1 && (
            <Button size="sm" variant="ghost" onClick={nextLevel}>
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "amber" | "emerald" | "rose" | "muted";
}) {
  const tones: Record<string, string> = {
    amber: "bg-amber-500/15 border-amber-500/40 text-amber-300",
    emerald: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
    rose: "bg-rose-500/15 border-rose-500/40 text-rose-300",
    muted: "bg-neutral-800/70 border-neutral-700 text-neutral-400",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-mono ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-900/60 border border-neutral-800 rounded-md px-2 py-1.5">
      <div className="text-[10px] text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className="font-mono text-neutral-100">{value}</div>
    </div>
  );
}
