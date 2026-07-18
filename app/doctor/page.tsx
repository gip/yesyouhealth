import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { DoctorClient } from "@/app/doctor/doctor-client";
import { fieldsForUser, listFields } from "@/lib/server/fields";
import { listLiterature } from "@/lib/server/literature";

export default async function DoctorPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=%2Fdoctor");
  if (session.user.role !== "doctor") redirect("/dashboard");

  const [allFields, myFields, submissions] = await Promise.all([
    listFields(),
    fieldsForUser(session.user.id),
    listLiterature({ doctorId: session.user.id }),
  ]);

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <p className="eyebrow">Doctor dashboard</p>
        <h1>Welcome{session.user.name ? `, ${session.user.name}` : ""}</h1>
        <p className="auth-note">
          Share peer-reviewed literature with the fields you practice in.
        </p>
      </header>
      <DoctorClient allFields={allFields} myFields={myFields} submissions={submissions} />
    </main>
  );
}
