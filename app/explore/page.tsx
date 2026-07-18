import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ExploreClient } from "@/app/explore/explore-client";

export const metadata: Metadata = {
  title: "Explore your record · YesYou Health",
  description: "Explore a locally imported health record in rendered and raw formats.",
};

export default async function ExplorePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=%2Fexplore");
  if (session.user.role !== "patient") redirect("/dashboard");
  return <ExploreClient />;
}
