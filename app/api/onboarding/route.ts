import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { listFields } from "@/lib/server/fields";
import { setRoleAndFields } from "@/lib/server/users";
import { parseOnboardingInput } from "@/lib/server/validation";

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
  if (session.user.role !== null) {
    return NextResponse.json({ error: "Your role is already set." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The onboarding request is invalid." }, { status: 400 });
  }

  const knownFieldIds = (await listFields()).map((field) => field.id);
  const parsed = parseOnboardingInput(body, knownFieldIds);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const applied = await setRoleAndFields(session.user.id, parsed.value.role, parsed.value.fieldIds);
  if (!applied) {
    return NextResponse.json({ error: "Your role is already set." }, { status: 409 });
  }
  return NextResponse.json({ role: parsed.value.role });
}
