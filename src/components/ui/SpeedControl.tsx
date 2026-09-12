"use client";

import { useEffect, useMemo, useState } from "react";

/** 1 simulated Earth day per 24h wall-clock (fun; not default). */
export const REALISM_DAYS_PER_SEC = 1 / 86_400;

export type SpeedPresetId =
  | "realism"
  | "slow"
  | "default"
  | "fast"
  | "warp";

export type SpeedPreset = {
  id: SpeedPresetId;
  label: string;
  /** Multiples of Realism scale. */
  multiple: number;
};

/** Presets are multiples of Realism. Default is slower than the old follow rate (6 d/s). */
export const SPEED_PRESETS: SpeedPreset[] = [
  { id: "realism", label: "Realism", multiple: 1 },
  { id: "slow", label: "Slow", multiple: 1_440 }, // 1 day / 60s
  { id: "default", label: "Default", multiple: 17_280 }, // 0.2 day / s = 1 day / 5s
  { id: "fast", label: "Fast", multiple: 518_400 }, // 6 day / s (former)
  { id: "warp", label: "Warp", multiple: 2_592_000 }, // 30 day / s
];

/**
 * Earth-sats Explore only — LEO-friendly table.
 * Default = 1 simulated day / 60s wall (1440× realism).
 */
export const EARTH_SATS_SPEED_PRESETS: SpeedPreset[] = [
  { id: "realism", label: "Realism", multiple: 1 },
  { id: "slow", label: "Slow", multiple: 288 }, // 1 day / 5 min
  { id: "default", label: "Default", multiple: 1_440 }, // 1 day / 60s
  { id: "fast", label: "Fast", multiple: 4_320 }, // 1 day / 20s
  { id: "warp", label: "Warp", multiple: 8_640 }, // 1 day / 10s
];

export const DEFAULT_SPEED_PRESET = SPEED_PRESETS.find((p) => p.id === "default")!;
export const SLOW_SPEED_PRESET = SPEED_PRESETS.find((p) => p.id === "slow")!;

export const EARTH_SATS_DEFAULT_SPEED_PRESET = EARTH_SATS_SPEED_PRESETS.find(
  (p) => p.id === "default",
)!;

/** Earth sats Explore default: 1 simulated day per 60s wall. */
export const EARTH_SATS_SPEED_MULTIPLE = EARTH_SATS_DEFAULT_SPEED_PRESET.multiple;

export function multipleToDaysPerSec(multiple: number): number {
  return multiple * REALISM_DAYS_PER_SEC;
}

export function daysPerSecToMultiple(daysPerSec: number): number {
  return daysPerSec / REALISM_DAYS_PER_SEC;
}

function formatSpeed(daysPerSec: number): string {
  if (daysPerSec <= 0) return "paused";
  if (daysPerSec < 1 / 86_400) return `${(daysPerSec * 86_400).toPrecision(2)}× real`;
  if (Math.abs(daysPerSec - 1 / 86_400) / (1 / 86_400) < 0.05) {
    return "1 day / 24h";
  }
  if (daysPerSec < 1 / 60) {
    const hoursPerDay = 24 / (daysPerSec * 86_400);
    return `1 day / ${hoursPerDay.toPrecision(2)}h`;
  }
  if (daysPerSec < 1) {
    const secPerDay = 1 / daysPerSec;
    if (secPerDay < 90) {
      const s = Math.round(secPerDay);
      return `1 day / ${s}s`;
    }
    return `1 day / ${(secPerDay / 60).toPrecision(2)}m`;
  }
  if (daysPerSec < 10) return `${daysPerSec.toPrecision(2)} d/s`;
  return `${Math.round(daysPerSec)} d/s`;
}

function multipleToSlider(multiple: number, maxMultiple: number): number {
  const LOG_MIN = Math.log10(1);
  const LOG_MAX = Math.log10(maxMultiple);
  const m = Math.min(Math.max(multiple, 1), maxMultiple);
  return (Math.log10(m) - LOG_MIN) / (LOG_MAX - LOG_MIN);
}

function sliderToMultiple(t: number, maxMultiple: number): number {
  const LOG_MIN = Math.log10(1);
  const LOG_MAX = Math.log10(maxMultiple);
  const log = LOG_MIN + Math.min(1, Math.max(0, t)) * (LOG_MAX - LOG_MIN);
  return 10 ** log;
}

function nearestPreset(
  multiple: number,
  presets: SpeedPreset[],
): SpeedPresetId | null {
  let best: SpeedPreset | null = null;
  let bestErr = Infinity;
  for (const p of presets) {
    const err = Math.abs(Math.log(multiple) - Math.log(p.multiple));
    if (err < bestErr) {
      bestErr = err;
      best = p;
    }
  }
  // Snap label only when close on a log scale
  return best && bestErr < 0.08 ? best.id : null;
}

type Props = {
  multiple: number;
  onMultipleChange: (multiple: number) => void;
  /**
   * When false, preset chips only light after a chip click (not nearest-match).
   */
  highlightNearestPreset?: boolean;
  /** Chip / slider table. Defaults to Sol Explore SPEED_PRESETS. */
  presets?: SpeedPreset[];
};

export function SpeedControl({
  multiple,
  onMultipleChange,
  highlightNearestPreset = true,
  presets = SPEED_PRESETS,
}: Props) {
  const maxMultiple = presets[presets.length - 1]?.multiple ?? SPEED_PRESETS[SPEED_PRESETS.length - 1].multiple;
  const daysPerSec = multipleToDaysPerSec(multiple);
  const nearest = useMemo(
    () => nearestPreset(multiple, presets),
    [multiple, presets],
  );
  const [clickedPreset, setClickedPreset] = useState<SpeedPresetId | null>(
    null,
  );

  useEffect(() => {
    if (!clickedPreset) return;
    const p = presets.find((x) => x.id === clickedPreset);
    if (!p) {
      setClickedPreset(null);
      return;
    }
    const err = Math.abs(Math.log(multiple) - Math.log(p.multiple));
    if (err >= 0.08) setClickedPreset(null);
  }, [multiple, clickedPreset, presets]);

  const active = highlightNearestPreset ? nearest : clickedPreset;
  const slider = multipleToSlider(multiple, maxMultiple);

  return (
    <div className="pointer-events-auto flex max-w-md flex-col gap-1.5 rounded-lg border border-white/10 bg-[#080d18]/90 px-3 py-2 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Speed
        </p>
        <p className="text-[11px] tabular-nums text-zinc-400">
          {formatSpeed(daysPerSec)}
          {active === "realism" && (
            <span className="ml-1 text-amber-400/90">· fun</span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {presets.map((p) => {
          const isOn = active === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setClickedPreset(p.id);
                onMultipleChange(p.multiple);
              }}
              className={`rounded px-2 py-0.5 text-[11px] transition ${
                isOn
                  ? p.id === "realism"
                    ? "bg-amber-500/25 text-amber-100"
                    : "bg-sky-500/25 text-sky-100"
                  : "bg-white/5 text-zinc-400 hover:text-zinc-200"
              }`}
              title={
                p.id === "realism"
                  ? "Earth day = 24 hours real time (not default)"
                  : `${p.multiple.toLocaleString()}× realism`
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={slider}
        onChange={(e) => {
          const next = sliderToMultiple(Number(e.target.value), maxMultiple);
          if (!highlightNearestPreset) {
            setClickedPreset(nearestPreset(next, presets));
          }
          onMultipleChange(next);
        }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-sky-400"
        aria-label="Simulation speed"
      />
    </div>
  );
}
