import type { Metadata } from "next";

import { ExploreClient } from "@/app/explore/explore-client";

export const metadata: Metadata = {
  title: "Explore your record · YesYou Health",
  description: "Explore a locally imported health record in rendered and raw formats.",
};

export default function ExplorePage() {
  return <ExploreClient />;
}
