import { Suspense } from "react";
import { SearchClient } from "./SearchClient";

/** Server Suspense boundary for useSearchParams (avoids CSR-bailout page). */
export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-zinc-500">Loading Search…</div>
      }
    >
      <SearchClient />
    </Suspense>
  );
}
