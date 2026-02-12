import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { resolveHomeForUser } from "@/lib/auth/portal";
import PatientClient from "@/app/patient/PatientClient";

export default async function PatientPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (session.user.isSystemAdmin) {
    redirect("/system");
  }
  if (session.user.role !== "PATIENT") {
    redirect(resolveHomeForUser(session.user));
  }

  return (
    <div className="min-h-dvh px-0 pb-0 pt-0 sm:px-6 sm:pb-12 sm:pt-10">
      <PatientClient tenantId={session.user.tenantId} />
    </div>
  );
}
