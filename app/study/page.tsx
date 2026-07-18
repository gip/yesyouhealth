import type { Metadata } from "next";

import { StudyClient } from "@/app/study/study-client";

export const metadata: Metadata = {
  title: "Longitudinal study · YesYou Health",
  description:
    "Review a de-identified longitudinal view of your imported health record and add your comments.",
};

export default function StudyPage() {
  return <StudyClient />;
}
