/**
 * Lightweight procedural Milky Way disk + bulge for the Systems map.
 * Scales with world coords (1 unit = 1 ly). Two palettes only — no bitmaps.
 */
import { MW_DISK_R_LY, SOL_GAL } from "@/lib/skyLayout";

export type MwLook = "realistic" | "artistic";

type Props = {
  look: MwLook;
};

const RX = MW_DISK_R_LY;
const RY = MW_DISK_R_LY * 0.42;

export function MilkyWayBackdrop({ look }: Props) {
  const realistic = look === "realistic";
  const diskId = realistic ? "mwDiskR" : "mwDiskA";
  const bulgeId = realistic ? "mwBulgeR" : "mwBulgeA";
  const dustId = realistic ? "mwDustR" : "mwDustA";

  const bg = realistic ? "#05070f" : "#07051a";
  const diskInner = realistic ? "#1a2238" : "#3b1d6e";
  const diskMid = realistic ? "#12182a" : "#1e1040";
  const diskOuter = realistic ? "#080b14" : "#0a0618";
  const bulgeCore = realistic ? "#c4b49a" : "#ffc978";
  const bulgeMid = realistic ? "#6a5a48" : "#e07840";
  const dust = realistic ? "rgba(40,36,48,0.55)" : "rgba(90,40,110,0.45)";
  const arm = realistic
    ? "rgba(160,175,210,0.07)"
    : "rgba(255,180,120,0.14)";
  const arm2 = realistic
    ? "rgba(120,140,180,0.05)"
    : "rgba(140,160,255,0.12)";

  return (
    <g aria-hidden="true" style={{ pointerEvents: "none" }}>
      <defs>
        <radialGradient id={diskId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={diskInner} stopOpacity={realistic ? 0.85 : 0.95} />
          <stop offset="45%" stopColor={diskMid} stopOpacity={realistic ? 0.55 : 0.7} />
          <stop offset="100%" stopColor={diskOuter} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={bulgeId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={bulgeCore} stopOpacity={realistic ? 0.55 : 0.75} />
          <stop offset="40%" stopColor={bulgeMid} stopOpacity={realistic ? 0.28 : 0.4} />
          <stop offset="100%" stopColor={bulgeMid} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={dustId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={dust} stopOpacity={0} />
          <stop offset="50%" stopColor={dust} stopOpacity={1} />
          <stop offset="100%" stopColor={dust} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Deep field */}
      <rect
        x={-RX * 1.35}
        y={-RX * 1.1}
        width={RX * 2.7}
        height={RX * 2.2}
        fill={bg}
      />

      {/* Soft halo */}
      <ellipse cx={0} cy={0} rx={RX * 1.05} ry={RY * 1.15} fill={`url(#${diskId})`} />

      {/* Main disk */}
      <ellipse cx={0} cy={0} rx={RX} ry={RY} fill={`url(#${diskId})`} opacity={0.95} />

      {/* Spiral-ish arm strokes (few paths — not thousands of stars) */}
      <ellipse
        cx={0}
        cy={0}
        rx={RX * 0.72}
        ry={RY * 0.72}
        fill="none"
        stroke={arm}
        strokeWidth={RX * 0.08}
        transform="rotate(-18)"
      />
      <ellipse
        cx={0}
        cy={0}
        rx={RX * 0.48}
        ry={RY * 0.5}
        fill="none"
        stroke={arm2}
        strokeWidth={RX * 0.06}
        transform="rotate(28)"
      />
      <ellipse
        cx={0}
        cy={0}
        rx={RX * 0.88}
        ry={RY * 0.86}
        fill="none"
        stroke={arm2}
        strokeWidth={RX * 0.045}
        transform="rotate(-52)"
      />

      {/* Dust lane across the plane */}
      <ellipse
        cx={0}
        cy={0}
        rx={RX * 0.92}
        ry={RY * 0.12}
        fill={`url(#${dustId})`}
      />

      {/* Central bulge */}
      <ellipse
        cx={0}
        cy={0}
        rx={RX * 0.14}
        ry={RY * 0.28}
        fill={`url(#${bulgeId})`}
      />

      {/* Local Sol neighborhood cue (tiny, not a hub decoration) */}
      <circle
        cx={SOL_GAL.x}
        cy={SOL_GAL.y}
        r={120}
        fill={realistic ? "rgba(120,160,220,0.06)" : "rgba(255,200,120,0.08)"}
      />
    </g>
  );
}
