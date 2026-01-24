"use client";

import { useState } from "react";

type Tenant = {
  id: string;
  name: string;
  createdAt: string;
};

type Props = {
  initialTenants: Tenant[];
};

export default function TenantsClient({ initialTenants }: Props) {
  const [tenants, setTenants] = useState(initialTenants);
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [status, setStatus] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) {
      setStatus("Informe um nome.");
      return;
    }
    setStatus("Criando...");
    const response = await fetch("/api/system/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, adminEmail: adminEmail || undefined }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      tenant?: Tenant;
      error?: string;
    };
    if (!response.ok) {
      setStatus(data.error ?? "Erro ao criar tenant.");
      return;
    }
    if (data.tenant) {
      setTenants([data.tenant, ...tenants]);
      setName("");
      setAdminEmail("");
      setStatus("Tenant criado.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[24px] border border-black/10 bg-white/85 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
        <h2 className="text-2xl text-[color:var(--ink-900)]">Criar tenant</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1.2fr_1fr_auto]">
          <input
            className="h-12 flex-1 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
            placeholder="Nome da clinica"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="h-12 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
            placeholder="Email do admin"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
          />
          <button
            className="h-12 rounded-xl bg-[color:var(--accent-500)] px-6 text-sm font-semibold text-white"
            type="button"
            onClick={handleCreate}
          >
            Criar
          </button>
        </div>
        <p className="mt-3 text-xs text-[color:var(--ink-500)]">
          Se o admin for informado, o primeiro acesso exigira definir senha.
        </p>
        {status ? (
          <p className="mt-3 text-xs text-[color:var(--ink-500)]">{status}</p>
        ) : null}
      </div>

      <div className="rounded-[24px] border border-black/10 bg-white/85 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
        <h2 className="text-2xl text-[color:var(--ink-900)]">Tenants</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {tenants.map((tenant) => (
            <div
              key={tenant.id}
              className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] px-4 py-3"
            >
              <p className="text-sm font-semibold text-[color:var(--ink-900)]">
                {tenant.name}
              </p>
              <p className="text-xs text-[color:var(--ink-500)]">{tenant.id}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
