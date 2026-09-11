import { redirect } from "next/navigation";

/** Explore is the home experience at `/`; keep this path working. */
export default async function ExploreRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") params.set(k, v);
    else if (Array.isArray(v) && v[0]) params.set(k, v[0]);
  }
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : "/");
}
