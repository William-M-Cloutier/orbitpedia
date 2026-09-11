"use client";

import {
  DEFAULT_SIZE_MODE,
  SIZE_MODES,
  type SizeMode,
} from "@/viz/sizeTiers";

type Props = {
  mode: SizeMode;
  onModeChange: (mode: SizeMode) => void;
};

export function SizeModeControl({ mode, onModeChange }: Props) {
  const active = SIZE_MODES.find((m) => m.id === mode) ?? SIZE_MODES[0]!;

  return (
    <div className="pointer-events-auto rounded-lg border border-white/10 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300 shadow-lg backdrop-blur">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-medium uppercase tracking-wide text-zinc-500">
          Size
        </span>
        <span className="text-[10px] text-zinc-500">{active.blurb}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {SIZE_MODES.map((m) => {
          const on = m.id === mode;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onModeChange(m.id)}
              className={
                on
                  ? "rounded-md bg-sky-600 px-2 py-1 font-medium text-white"
                  : "rounded-md bg-white/5 px-2 py-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
              }
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { DEFAULT_SIZE_MODE };
