import { CallbackClient } from "@/app/callback/callback-client";
import { requireEpicClientId } from "@/lib/server-config";

export default function CallbackPage() {
  return <CallbackClient defaultClientId={requireEpicClientId()} />;
}
