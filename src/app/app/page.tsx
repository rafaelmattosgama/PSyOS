import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { resolveHomeForUser } from "@/lib/auth/portal";
import PsychologistClient from "@/app/app/PsychologistClient";
import { prisma } from "@/lib/prisma";

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

  const profile = await prisma.psychologistProfile.findUnique({
    where: { userId: session.user.id },
  });

  return (
    <div className="h-dvh overflow-hidden px-0 pb-0 pt-0 sm:h-auto sm:min-h-dvh sm:overflow-visible sm:px-6 sm:pb-12 sm:pt-10">
      <PsychologistClient
        tenantId={session.user.tenantId}
        psychologistName={profile?.displayName ?? session.user.email ?? "Psicologo"}
      />
    </div>
  );
}

