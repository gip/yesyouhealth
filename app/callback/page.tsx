import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { CallbackClient } from "@/app/callback/callback-client";
import { requireEpicClientId } from "@/lib/server-config";

export default async function CallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      if (typeof value === "string") params.set(key, value);
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/callback${suffix}`)}`);
  }
  if (session.user.role !== "patient") redirect("/dashboard");
  return <CallbackClient defaultClientId={requireEpicClientId()} />;
}
