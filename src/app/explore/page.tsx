import { redirect } from "next/navigation";

/** Explore is the home experience at `/`; keep this path working. */
export default function ExploreRedirect() {
  redirect("/");
}
