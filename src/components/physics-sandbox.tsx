"use client";

import * as React from "react";
import {
  Play,
  Pause,
  Trash2,
  StepForward,
  Sparkles,
  Circle as CircleIcon,
  Square,
  Triangle,
  Hexagon,
  Pentagon,
  Crosshair,
  Activity,
} from "lucide-react";

import { Vec2 } from "@/lib/physics/vector";
import { PhysicsWorld } from "@/lib/physics/world";
import { RigidBody } from "@/lib/physics/body";
import {
  renderWorld,
  type RenderColors,
  type DebugOptions,
  type GhostShape,
  type SandboxShapeKind,
} from "@/components/physics/canvas-renderer";
import {
  buildWalls,
  createBody,
  presetDominoes,
  presetPyramid,
  presetRain,
  presetSeesaw,
  presetStack,
  type MaterialSettings,
  type PresetName,
} from "@/components/physics/sandbox-helpers";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 5;

const COLORS: RenderColors = {
  background: "#0b0e14",
  grid: "rgba(148,163,184,0.08)",
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
};

interface SandboxSettings {
  shape: SandboxShapeKind;
  size: number;
  gravity: number;
  restitution: number;
  friction: number;
  timeScale: number;
  paused: boolean;
  debug: DebugOptions;
}

const DEFAULT_SETTINGS: SandboxSettings = {
  shape: "box",
  size: 30,
  gravity: 980,
  restitution: 0.3,
  friction: 0.35,
  timeScale: 1,
  paused: false,
  debug: {
    showAABB: false,
    showVelocity: false,
    showContacts: true,
    showNormals: true,
    showBroadphase: false,
    showGrid: true,
  },
};

const SHAPE_OPTIONS: { value: SandboxShapeKind; label: string; icon: React.ReactNode }[] = [
  { value: "circle", label: "Circle", icon: <CircleIcon className="size-4" /> },
  { value: "box", label: "Box", icon: <Square className="size-4" /> },
  { value: "triangle", label: "Triangle", icon: <Triangle className="size-4" /> },
  { value: "pentagon", label: "Pentagon", icon: <Pentagon className="size-4" /> },
  { value: "hexagon", label: "Hexagon", icon: <Hexagon className="size-4" /> },
];

const PRESETS: { value: PresetName; label: string }[] = [
  { value: "stack", label: "Stack" },
  { value: "pyramid", label: "Pyramid" },
  { value: "dominoes", label: "Dominoes" },
  { value: "seesaw", label: "Seesaw" },
  { value: "rain", label: "Rain" },
];

interface LiveStats {
  fps: number;
  bodies: number;
  contacts: number;
  pairs: number;
}

export interface PhysicsSandboxHandle {
  reset: () => void;
}

export default function PhysicsSandbox() {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const worldRef = React.useRef<PhysicsWorld | null>(null);
  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);

  const [settings, setSettings] = React.useState<SandboxSettings>(DEFAULT_SETTINGS);
  const settingsRef = React.useRef(settings);
  React.useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const [stats, setStats] = React.useState<LiveStats>({
    fps: 60,
    bodies: 0,
    contacts: 0,
    pairs: 0,
  });

  // pointer / grab state (refs — no re-render needed)
  const pointerRef = React.useRef({
    x: 0,
    y: 0,
    inside: false,
    down: false,
    button: 0,
    grab: null as RigidBody | null,
    grabOffset: new Vec2(),
    lastGrabTime: 0,
  });

  const sizeRef = React.useRef({ w: 800, h: 600, dpr: 1 });
  const rafRef = React.useRef<number>(0);
  const lastFrameRef = React.useRef<number>(0);
  const accRef = React.useRef<number>(0);
  const fpsAvgRef = React.useRef<number>(60);
  const statsTickRef = React.useRef<number>(0);

  // -----------------------------------------------------------------
  // world setup (once)
  // -----------------------------------------------------------------
  const setupWorld = React.useCallback((w: number, h: number) => {
    const world = new PhysicsWorld();
    const walls = buildWalls(w, h);
    for (const wall of walls) world.add(wall);
    worldRef.current = world;
  }, []);

  const rebuildWalls = React.useCallback((w: number, h: number) => {
    const world = worldRef.current;
    if (!world) return;
    world.replaceStaticBodies(buildWalls(w, h));
  }, []);

  // -----------------------------------------------------------------
  // canvas sizing (DPR aware)
  // -----------------------------------------------------------------
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
    if (!worldRef.current) {
      setupWorld(w, h);
    } else if (prev.w !== w || prev.h !== h) {
      rebuildWalls(w, h);
    }
  }, [rebuildWalls, setupWorld]);

  // -----------------------------------------------------------------
  // pointer -> logical canvas coords
  // -----------------------------------------------------------------
  const toLocal = React.useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return new Vec2(clientX - rect.left, clientY - rect.top);
  }, []);

  const findBodyAt = React.useCallback((p: Vec2): RigidBody | null => {
    const world = worldRef.current;
    if (!world) return null;
    // topmost first (last drawn = last in array)
    for (let i = world.bodies.length - 1; i >= 0; i--) {
      const b = world.bodies[i];
      if (b.isStatic) continue;
      if (b.containsPoint(p)) return b;
    }
    return null;
  }, []);

  // -----------------------------------------------------------------
  // spawn / preset / clear actions
  // -----------------------------------------------------------------
  const spawnAt = React.useCallback(
    (x: number, y: number) => {
      const world = worldRef.current;
      if (!world) return;
      const s = settingsRef.current;
      const mat: MaterialSettings = {
        restitution: s.restitution,
        friction: s.friction,
      };
      const b = createBody(s.shape, s.size, x, y, mat);
      world.add(b);
    },
    [],
  );

  const clearDynamic = React.useCallback(() => {
    worldRef.current?.clearDynamic();
  }, []);

  const runPreset = React.useCallback((name: PresetName) => {
    const world = worldRef.current;
    if (!world) return;
    world.clearDynamic();
    const { w, h } = sizeRef.current;
    const s = settingsRef.current;
    const mat: MaterialSettings = { restitution: s.restitution, friction: s.friction };
    switch (name) {
      case "stack":
        presetStack(world, w, h, mat);
        break;
      case "pyramid":
        presetPyramid(world, w, h, mat);
        break;
      case "dominoes":
        presetDominoes(world, w, h, mat);
        break;
      case "seesaw":
        presetSeesaw(world, w, h, mat);
        break;
      case "rain":
        presetRain(world, w, h, mat);
        break;
    }
  }, []);

  const stepOnce = React.useCallback(() => {
    worldRef.current?.step(FIXED_DT);
  }, []);

  // -----------------------------------------------------------------
  // pointer handlers
  // -----------------------------------------------------------------
  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current!;
      canvas.setPointerCapture(e.pointerId);
      const p = toLocal(e.clientX, e.clientY);
      const ptr = pointerRef.current;
      ptr.down = true;
      ptr.button = e.button;
      ptr.x = p.x;
      ptr.y = p.y;
      ptr.inside = true;

      const world = worldRef.current!;

      if (e.button === 2) {
        // right-click: delete body under cursor
        for (let i = world.bodies.length - 1; i >= 0; i--) {
          const b = world.bodies[i];
          if (b.isStatic) continue;
          if (b.containsPoint(p)) {
            world.remove(b);
            return;
          }
        }
        return;
      }

      // left click: try grab a body, else spawn
      const target = findBodyAt(p);
      if (target) {
        target.setKinematic(true);
        ptr.grab = target;
        ptr.grabOffset = p.sub(target.position);
        ptr.lastGrabTime = performance.now();
      } else {
        spawnAt(p.x, p.y);
      }
    },
    [findBodyAt, spawnAt, toLocal],
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const p = toLocal(e.clientX, e.clientY);
      const ptr = pointerRef.current;
      ptr.x = p.x;
      ptr.y = p.y;
      ptr.inside = true;
    },
    [toLocal],
  );

  const endPointer = React.useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    const ptr = pointerRef.current;
    ptr.down = false;
    if (ptr.grab) {
      ptr.grab.setKinematic(false);
      ptr.grab = null;
    }
  }, []);

  const onPointerLeave = React.useCallback(() => {
    pointerRef.current.inside = false;
  }, []);

  // -----------------------------------------------------------------
  // apply live settings to the world (gravity / material)
  // -----------------------------------------------------------------
  React.useEffect(() => {
    worldRef.current?.setGravityY(settings.gravity);
  }, [settings.gravity]);

  React.useEffect(() => {
    worldRef.current?.applyMaterial(settings.restitution, settings.friction);
  }, [settings.restitution, settings.friction]);

  // -----------------------------------------------------------------
  // keyboard shortcuts
  // -----------------------------------------------------------------
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === " ") {
        e.preventDefault();
        setSettings((s) => ({ ...s, paused: !s.paused }));
      } else if (k === "r") {
        clearDynamic();
      } else if (k === "c") {
        clearDynamic();
      } else if (k === "1") setSettings((s) => ({ ...s, shape: "circle" }));
      else if (k === "2") setSettings((s) => ({ ...s, shape: "box" }));
      else if (k === "3") setSettings((s) => ({ ...s, shape: "triangle" }));
      else if (k === "4") setSettings((s) => ({ ...s, shape: "pentagon" }));
      else if (k === "5") setSettings((s) => ({ ...s, shape: "hexagon" }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearDynamic]);

  // -----------------------------------------------------------------
  // main loop
  // -----------------------------------------------------------------
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
      if (dt > 0.25) dt = 0.25; // avoid spiral after tab switch
      if (dt <= 0) dt = 1 / 120;

      const s = settingsRef.current;

      // --- drive grabbed body toward the cursor (kinematic) ---
      const ptr = pointerRef.current;
      if (ptr.grab) {
        const target = new Vec2(ptr.x, ptr.y).sub(ptr.grabOffset);
        const prev = ptr.grab.position.clone();
        const gdt = Math.max((now - ptr.lastGrabTime) / 1000, 1 / 120);
        const vel = target.sub(prev).mul(1 / gdt);
        ptr.grab.setGrabTransform(target, vel, 0.6);
        ptr.lastGrabTime = now;
      }

      // --- physics ---
      if (!s.paused) {
        accRef.current += dt * s.timeScale;
        let steps = 0;
        while (accRef.current >= FIXED_DT && steps < MAX_SUBSTEPS) {
          world.step(FIXED_DT);
          accRef.current -= FIXED_DT;
          steps++;
        }
        if (steps === MAX_SUBSTEPS) accRef.current = 0;
      }

      // --- render ---
      const { w, h } = sizeRef.current;
      const ghost: GhostShape | null =
        ptr.inside && !ptr.down && !ptr.grab
          ? {
              kind: s.shape,
              x: ptr.x,
              y: ptr.y,
              radius: s.size,
              color: "#94a3b8",
            }
          : null;

      // expose manifolds + broadphase pairs for debug overlays
      const manifolds = s.debug.showContacts ? world.manifolds : [];
      const broadphasePairs: [RigidBody, RigidBody][] =
        s.debug.showBroadphase ? computeBroadphasePairs(world) : [];

      renderWorld(ctx, world, w, h, {
        colors: COLORS,
        debug: s.debug,
        manifolds,
        broadphasePairs,
        grabbedId: ptr.grab?.id,
        ghost,
      });

      // --- stats (throttled) ---
      const instantFps = 1 / dt;
      fpsAvgRef.current = fpsAvgRef.current * 0.9 + instantFps * 0.1;
      statsTickRef.current += dt;
      if (statsTickRef.current >= 0.2) {
        statsTickRef.current = 0;
        setStats({
          fps: Math.round(fpsAvgRef.current),
          bodies: world.bodies.filter((b) => !b.isStatic).length,
          contacts: world.manifolds.length,
          pairs: broadphasePairs.length || computeBroadphasePairs(world).length,
        });
      }
    };

    lastFrameRef.current = performance.now();
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [resize]);

  // -----------------------------------------------------------------
  // control helpers
  // -----------------------------------------------------------------
  const update = <K extends keyof SandboxSettings>(key: K, value: SandboxSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const toggleDebug = (key: keyof DebugOptions) =>
    setSettings((s) => ({ ...s, debug: { ...s.debug, [key]: !s.debug[key] } }));

  return (
    <div className="h-full flex flex-col lg:flex-row gap-3">
      {/* canvas stage */}
      <div
        ref={containerRef}
        className="relative h-[52vh] lg:h-auto lg:flex-1 min-h-0 rounded-xl overflow-hidden border border-neutral-800 bg-[#0b0e14] shadow-inner"
      >
        <canvas
          ref={canvasRef}
          className="block w-full h-full touch-none cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onPointerLeave={onPointerLeave}
          onContextMenu={(e) => e.preventDefault()}
        />
        {/* HUD overlay */}
        <div className="pointer-events-none absolute top-3 left-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            <StatBadge icon={<Activity className="size-3" />} label="FPS" value={stats.fps} />
            <StatBadge label="Bodies" value={stats.bodies} />
            <StatBadge label="Contacts" value={stats.contacts} />
            {settings.debug.showBroadphase && (
              <StatBadge label="Pairs" value={stats.pairs} />
            )}
          </div>
          {settings.paused && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-1 text-xs font-medium text-amber-300 border border-amber-500/40 w-fit">
              <Pause className="size-3" /> Paused
            </span>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex justify-between items-end gap-2">
          <p className="text-[11px] text-neutral-500 font-mono leading-relaxed max-w-[70%]">
            <span className="text-neutral-400">Click</span> empty space to spawn ·
            <span className="text-neutral-400"> Drag</span> a body to throw ·
            <span className="text-neutral-400"> Right-click</span> to delete
          </p>
        </div>
      </div>

      {/* control panel */}
      <aside className="flex-1 lg:flex-none lg:w-[320px] shrink-0 min-h-0 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900/70 backdrop-blur p-4 space-y-5 scroll-thin">
        {/* transport */}
        <Section title="Simulation">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={settings.paused ? "default" : "secondary"}
              className="flex-1"
              onClick={() => update("paused", !settings.paused)}
            >
              {settings.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {settings.paused ? "Play" : "Pause"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={stepOnce}
              disabled={!settings.paused}
            >
              <StepForward className="size-4" /> Step
            </Button>
          </div>
          <Button size="sm" variant="destructive" className="w-full" onClick={clearDynamic}>
            <Trash2 className="size-4" /> Clear bodies
          </Button>
        </Section>

        {/* shape & spawn */}
        <Section title="Spawner">
          <Label className="text-xs text-neutral-400">Shape</Label>
          <ToggleGroup
            type="single"
            value={settings.shape}
            onValueChange={(v) => v && update("shape", v as SandboxShapeKind)}
            className="grid grid-cols-5 gap-1 w-full"
          >
            {SHAPE_OPTIONS.map((o) => (
              <ToggleGroupItem
                key={o.value}
                value={o.value}
                aria-label={o.label}
                className="flex flex-col gap-0.5 h-12 data-[state=on]:bg-neutral-700"
              >
                {o.icon}
                <span className="text-[9px]">{o.label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <SliderRow
            label="Size"
            value={settings.size}
            min={10}
            max={70}
            step={1}
            unit="px"
            onChange={(v) => update("size", v)}
          />
        </Section>

        {/* world physics */}
        <Section title="World Physics">
          <SliderRow
            label="Gravity"
            value={settings.gravity}
            min={-600}
            max={2000}
            step={10}
            unit="px/s²"
            onChange={(v) => update("gravity", v)}
          />
          <SliderRow
            label="Restitution"
            value={settings.restitution}
            min={0}
            max={1}
            step={0.01}
            unit=""
            onChange={(v) => update("restitution", v)}
          />
          <SliderRow
            label="Friction"
            value={settings.friction}
            min={0}
            max={1}
            step={0.01}
            unit=""
            onChange={(v) => update("friction", v)}
          />
          <SliderRow
            label="Time scale"
            value={settings.timeScale}
            min={0}
            max={2}
            step={0.05}
            unit="×"
            onChange={(v) => update("timeScale", v)}
          />
        </Section>

        {/* presets */}
        <Section title="Presets">
          <Select onValueChange={(v) => runPreset(v as PresetName)}>
            <SelectTrigger className="w-full" size="sm">
              <SelectValue placeholder="Load a scene…" />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <Button
                key={p.value}
                size="sm"
                variant="outline"
                onClick={() => runPreset(p.value)}
              >
                <Sparkles className="size-3.5" /> {p.label}
              </Button>
            ))}
          </div>
        </Section>

        {/* debug */}
        <Section title="Debug Overlays">
          <DebugToggle
            label="Contact points"
            icon={<Crosshair className="size-3.5" />}
            checked={settings.debug.showContacts}
            onChange={() => toggleDebug("showContacts")}
          />
          <DebugToggle
            label="Contact normals"
            checked={settings.debug.showNormals}
            onChange={() => toggleDebug("showNormals")}
          />
          <DebugToggle
            label="Velocity vectors"
            checked={settings.debug.showVelocity}
            onChange={() => toggleDebug("showVelocity")}
          />
          <DebugToggle
            label="AABB (broad phase)"
            checked={settings.debug.showAABB}
            onChange={() => toggleDebug("showAABB")}
          />
          <DebugToggle
            label="Broadphase pairs"
            checked={settings.debug.showBroadphase}
            onChange={() => toggleDebug("showBroadphase")}
          />
          <DebugToggle
            label="Grid"
            checked={settings.debug.showGrid}
            onChange={() => toggleDebug("showGrid")}
          />
        </Section>

        <div className="pt-1 text-[10px] text-neutral-500 font-mono leading-relaxed border-t border-neutral-800">
          <p className="text-neutral-400 mb-1">Shortcuts</p>
          <p>Space — pause/play</p>
          <p>1–5 — pick shape</p>
          <p>R / C — clear</p>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// small presentational helpers
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-neutral-400">{label}</Label>
        <span className="text-xs font-mono text-neutral-300 tabular-nums">
          {value.toFixed(step < 1 ? 2 : 0)}
          {unit && <span className="text-neutral-500 ml-0.5">{unit}</span>}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}

function DebugToggle({
  label,
  icon,
  checked,
  onChange,
}: {
  label: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs text-neutral-300 flex items-center gap-1.5 cursor-pointer">
        {icon}
        {label}
      </Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function StatBadge({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-neutral-900/80 px-2 py-1 text-[11px] font-mono text-neutral-300 border border-neutral-700/60 backdrop-blur">
      {icon}
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-100 tabular-nums">{value}</span>
    </span>
  );
}

// compute AABB-overlap pairs for the debug overlay (mirrors world broadphase)
function computeBroadphasePairs(world: PhysicsWorld): [RigidBody, RigidBody][] {
  const pairs: [RigidBody, RigidBody][] = [];
  const bs = world.bodies;
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i];
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j];
      if (a.isStatic && b.isStatic) continue;
      if (a.kinematic && b.kinematic) continue;
      const am = a.aabb;
      const bm = b.aabb;
      if (
        am.max.x >= bm.min.x &&
        am.min.x <= bm.max.x &&
        am.max.y >= bm.min.y &&
        am.min.y <= bm.max.y
      ) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}
