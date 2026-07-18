import { redirect } from "next/navigation";

import { auth } from "@/auth";

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (session.user.role === "doctor") redirect("/doctor");
  if (session.user.role === "patient") redirect("/patient");
  redirect("/onboarding");
}
