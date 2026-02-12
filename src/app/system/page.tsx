import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { resolveHomeForUser } from "@/lib/auth/portal";
import TenantsClient from "@/app/system/TenantsClient";

export default async function SystemPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.user.isSystemAdmin) {
    redirect(resolveHomeForUser(session.user));
  }

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
  });

  const items = tenants.map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    createdAt: tenant.createdAt.toISOString(),
  }));

  return (
    <div className="min-h-dvh px-6 pb-16 pt-10">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <header className="rounded-[28px] border border-black/10 bg-white/80 p-8 shadow-[0_18px_40px_var(--shadow-color)]">
          <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
            System Portal
          </p>
          <h1 className="mt-3 text-4xl text-[color:var(--ink-900)]">
            Gestao de tenants
          </h1>
          <p className="mt-3 text-sm text-[color:var(--ink-700)]">
            Crie e acompanhe clinicas e organizacoes.
          </p>
        </header>

        <TenantsClient initialTenants={items} />
      </div>
    </div>
  );
}
