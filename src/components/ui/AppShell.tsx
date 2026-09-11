import { TopBar } from "./TopBar";

export function AppShell({
  children,
  rail,
}: {
  children: React.ReactNode;
  rail?: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#05080f] text-zinc-100">
      <TopBar />
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
