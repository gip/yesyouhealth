import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { listFields } from "@/lib/server/fields";
import { addLiterature, listLiterature } from "@/lib/server/literature";
import { parseLiteratureInput } from "@/lib/server/validation";

export async function GET(request: Request): Promise<NextResponse> {
  const fieldSlug = new URL(request.url).searchParams.get("field");
  const entries = await listLiterature(fieldSlug ? { fieldSlug } : {});
  return NextResponse.json({ literature: entries });
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
  if (session.user.role !== "doctor") {
    return NextResponse.json({ error: "Only doctors can add literature." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The literature request is invalid." }, { status: 400 });
  }

  const knownFieldIds = (await listFields()).map((field) => field.id);
  const parsed = parseLiteratureInput(body, knownFieldIds);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const id = await addLiterature(session.user.id, parsed.value);
  if (!id) {
    return NextResponse.json(
      { error: "You can only add literature to one of your selected fields." },
      { status: 403 },
    );
  }
  return NextResponse.json({ id }, { status: 201 });
}
