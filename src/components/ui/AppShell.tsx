import { TopBar } from "./TopBar";

export function AppShell({
  children,
  rail,
}: {
  children: React.ReactNode;
  rail?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[#05080f] text-zinc-100">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {rail}
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
