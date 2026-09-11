import Link from "next/link";
import type { Body } from "@/data/schema";
import { KIND_LABEL } from "@/data/catalog";
import { formatAu, formatMass, formatRadius } from "@/lib/units";

type Props = {
  body: Body;
  selected?: boolean;
  onSelect?: () => void;
};

export function BodyCard({ body, selected, onSelect }: Props) {
  return (
    <article
      className={`rounded-xl border p-4 transition ${
        selected
          ? "border-violet-400/50 bg-violet-500/10"
          : "border-white/10 bg-white/[0.03] hover:border-white/20"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-full"
            style={{ background: body.color ?? "#888" }}
          />
          <div>
            <h3 className="font-medium text-zinc-100">{body.name}</h3>
            <p className="text-xs text-zinc-500">{KIND_LABEL[body.kind]}</p>
          </div>
        </div>
        {onSelect && (
          <button
            type="button"
            onClick={onSelect}
            className={`rounded-md px-2 py-1 text-xs ${
              selected
                ? "bg-violet-500/30 text-violet-100"
                : "bg-white/5 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {selected ? "Selected" : "Compare"}
          </button>
        )}
      </div>
      <dl className="space-y-1 text-sm text-zinc-400">
        <div className="flex justify-between gap-2">
          <dt>Mass</dt>
          <dd className="text-zinc-200">{formatMass(body.facts.massKg)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Radius</dt>
          <dd className="text-zinc-200 text-right">
            {formatRadius(body.facts.radiusMeanKm)}
          </dd>
        </div>
        {body.orbit && (
          <div className="flex justify-between gap-2">
            <dt>a</dt>
            <dd className="text-zinc-200">{formatAu(body.orbit.aAu)}</dd>
          </div>
        )}
      </dl>
      <Link
        href={`/body/${body.id}`}
        className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300"
      >
        Details →
      </Link>
    </article>
  );
}
