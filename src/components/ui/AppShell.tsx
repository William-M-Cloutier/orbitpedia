import { Suspense } from "react";
import { TopBar } from "./TopBar";

function TopBarFallback() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070b14]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
        <span className="shrink-0 font-semibold tracking-tight text-sky-300">
          Orbitpedia
        </span>
        <div className="h-8 flex-1 rounded-lg bg-white/5" aria-hidden />
      </div>
    </header>
  );
}

export function AppShell({
  children,
  rail,
}: {
  children: React.ReactNode;
  rail?: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#05080f] text-zinc-100">
      {/* useSearchParams in TopBar needs Suspense — /systems had none (Explore/Discover wrap page). */}
      <Suspense fallback={<TopBarFallback />}>
        <TopBar />
      </Suspense>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {rail ? (
          <div className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden">
            {rail}
          </div>
        ) : null}
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
