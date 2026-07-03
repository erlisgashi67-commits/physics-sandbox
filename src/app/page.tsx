"use client";

import * as React from "react";
import { Boxes, Github, Zap, Gamepad2, FlaskConical } from "lucide-react";
import PhysicsSandbox from "@/components/physics-sandbox";
import SiegeGame from "@/components/siege-game";

type Mode = "sandbox" | "siege";

export default function Home() {
  const [mode, setMode] = React.useState<Mode>("sandbox");

  return (
    <div className="dark h-screen flex flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      {/* header */}
      <header className="shrink-0 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-rose-500 text-neutral-950 shrink-0 shadow-lg shadow-rose-500/20">
              <Boxes className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
                Rigid Body Sandbox
              </h1>
              <p className="text-[11px] sm:text-xs text-neutral-400 truncate">
                A custom 2D physics engine — SAT collision, impulse solver, joints, CCD — zero dependencies
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* mode switch */}
            <div className="flex rounded-lg border border-neutral-800 bg-neutral-900 p-0.5">
              <ModeButton
                active={mode === "sandbox"}
                onClick={() => setMode("sandbox")}
                icon={<FlaskConical className="size-3.5" />}
                label="Sandbox"
              />
              <ModeButton
                active={mode === "siege"}
                onClick={() => setMode("siege")}
                icon={<Gamepad2 className="size-3.5" />}
                label="Siege"
              />
            </div>
            <div className="hidden lg:flex items-center gap-2">
              <Badge2>
                <Zap className="size-3 text-amber-400" /> Canvas + TypeScript
              </Badge2>
              <Badge2>
                <Github className="size-3 text-emerald-400" /> No physics libs
              </Badge2>
            </div>
          </div>
        </div>
      </header>

      {/* main stage */}
      <main className="flex-1 min-h-0 p-3">
        {mode === "sandbox" ? (
          <PhysicsSandbox />
        ) : (
          <SiegeGame onExit={() => setMode("sandbox")} />
        )}
      </main>

      {/* sticky footer */}
      <footer className="shrink-0 border-t border-neutral-800 bg-neutral-950/80 backdrop-blur">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-1.5 px-4 py-2 text-[11px] text-neutral-500">
          <p className="font-mono">
            Rigid-body dynamics · SAT · Sutherland–Hodgman · Baumgarte · constraints · CCD substepping
          </p>
          <p className="font-mono text-neutral-600">
            Built from scratch — every vector, every impulse, by hand.
          </p>
        </div>
      </footer>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
        active
          ? "bg-neutral-700 text-neutral-50 shadow-sm"
          : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Badge2({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-neutral-300">
      {children}
    </span>
  );
}
