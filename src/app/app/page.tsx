import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { resolveHomeForUser } from "@/lib/auth/portal";
import PsychologistClient from "@/app/app/PsychologistClient";

export default async function PsychologistPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (session.user.isSystemAdmin) {
    redirect("/system");
  }
  if (session.user.role !== "PSYCHOLOGIST") {
    redirect(resolveHomeForUser(session.user));
  }

  return (
    <div className="min-h-screen px-6 pb-12 pt-10">
      <PsychologistClient tenantId={session.user.tenantId} />
    </div>
  );
}
