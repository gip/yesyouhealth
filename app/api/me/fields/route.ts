import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { listFields } from "@/lib/server/fields";
import { replaceUserFields } from "@/lib/server/users";
import { parseFieldIds } from "@/lib/server/validation";

export async function PUT(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user || session.user.role === null) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request is invalid." }, { status: 400 });
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const knownFieldIds = (await listFields()).map((field) => field.id);
  const parsed = parseFieldIds(record.fieldIds, knownFieldIds);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  await replaceUserFields(session.user.id, parsed.value);
  return NextResponse.json({ fieldIds: parsed.value });
}
