import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { resolveHomeForUser } from "@/lib/auth/portal";
import { prisma } from "@/lib/prisma";
import AdminClient from "@/app/admin/AdminClient";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (session.user.isSystemAdmin) {
    redirect("/system");
  }
  if (session.user.role !== "ADMIN") {
    redirect(resolveHomeForUser(session.user));
  }

  const tenantId = session.user.tenantId;
  const [tenant, psychologists, patients, conversations] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId } }),
    prisma.user.findMany({
      where: { tenantId, role: "PSYCHOLOGIST" },
      include: { psychologistProfile: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      where: { tenantId, role: "PATIENT" },
      include: { patientProfile: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.conversation.findMany({
      where: { tenantId },
      include: { psychologist: { include: { psychologistProfile: true } } },
    }),
  ]);

  const patientAssignments = new Map(
    conversations.map((conv) => [
      conv.patientUserId,
      conv.psychologist.psychologistProfile?.displayName ??
        conv.psychologist.email ??
        "Psicologo",
    ]),
  );

  const mappedPsychologists = psychologists.map((user) => ({
    id: user.id,
    email: user.email,
    isActive: user.isActive,
    displayName: user.psychologistProfile?.displayName ?? null,
    createdAt: user.createdAt.toISOString(),
  }));

  const mappedPatients = patients.map((user) => ({
    id: user.id,
    email: user.email,
    isActive: user.isActive,
    displayName: user.patientProfile?.displayName ?? null,
    phoneE164: user.patientProfile?.phoneE164 ?? null,
    preferredLanguage:
      (user.patientProfile as { preferredLanguage?: "PT" | "ES" | "EN" })
        ?.preferredLanguage ?? "ES",
    psychologistName: patientAssignments.get(user.id) ?? null,
    createdAt: user.createdAt.toISOString(),
  }));

  return (
    <div className="min-h-screen px-6 pb-16 pt-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
              Portal Administrativo
            </p>
            <h1 className="mt-2 text-3xl text-[color:var(--ink-900)]">
              {tenant?.name ?? "Clinica"}
            </h1>
          </div>
        </header>

        <AdminClient
          initialPsychologists={mappedPsychologists}
          initialPatients={mappedPatients}
        />
      </div>
    </div>
  );
}

