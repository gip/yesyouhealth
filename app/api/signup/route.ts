import { NextResponse } from "next/server";

import { listFields } from "@/lib/server/fields";
import { hashPassword } from "@/lib/server/password";
import { createCredentialsUser, DuplicateEmailError } from "@/lib/server/users";
import { parseSignupInput } from "@/lib/server/validation";

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The signup request is invalid." }, { status: 400 });
  }

  const knownFieldIds = (await listFields()).map((field) => field.id);
  const parsed = parseSignupInput(body, knownFieldIds);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const passwordHash = await hashPassword(parsed.value.password);
    const user = await createCredentialsUser({
      email: parsed.value.email,
      name: parsed.value.name,
      passwordHash,
      role: parsed.value.role,
      fieldIds: parsed.value.fieldIds,
    });
    return NextResponse.json({ id: user.id, role: user.role }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
