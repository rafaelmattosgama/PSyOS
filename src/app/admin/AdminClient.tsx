"use client";

import { useMemo, useState } from "react";

type Psychologist = {
  id: string;
  email: string | null;
  isActive: boolean;
  displayName: string | null;
  createdAt: string;
};

type Patient = {
  id: string;
  email: string | null;
  isActive: boolean;
  displayName: string | null;
  phoneE164: string | null;
  preferredLanguage: "PT" | "ES" | "EN";
  psychologistName?: string | null;
  createdAt: string;
};

type Props = {
  initialPsychologists: Psychologist[];
  initialPatients: Patient[];
};

async function postJson<T>(url: string, payload: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data;
}

async function patchJson<T>(url: string, payload: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data;
}

export default function AdminClient({
  initialPsychologists,
  initialPatients,
}: Props) {
  const [psychologists, setPsychologists] = useState(initialPsychologists);
  const [patients, setPatients] = useState(initialPatients);
  const [status, setStatus] = useState("");

  const [newPsychEmail, setNewPsychEmail] = useState("");
  const [newPsychName, setNewPsychName] = useState("");
  const [newPatientEmail, setNewPatientEmail] = useState("");
  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientPhone, setNewPatientPhone] = useState("");
  const [newPatientPsychologist, setNewPatientPsychologist] = useState("");
  const [newPatientLanguage, setNewPatientLanguage] = useState<
    Patient["preferredLanguage"]
  >("ES");

  const activePsychologists = useMemo(
    () => psychologists.filter((item) => item.isActive),
    [psychologists],
  );

  const handleCreatePsychologist = async () => {
    try {
      setStatus("Criando psicologo...");
      const data = await postJson<{ psychologist: Psychologist }>(
        "/api/admin/psychologists",
        {
          email: newPsychEmail,
          displayName: newPsychName,
        },
      );
      setPsychologists([data.psychologist, ...psychologists]);
      setNewPsychEmail("");
      setNewPsychName("");
      setStatus("Psicologo criado.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const handleUpdatePsychologist = async (
    id: string,
    updates: Partial<Psychologist>,
  ) => {
    try {
      setStatus("Atualizando psicologo...");
      const data = await patchJson<{ psychologist: Psychologist }>(
        `/api/admin/psychologists/${id}`,
        updates,
      );
      setPsychologists(
        psychologists.map((item) => (item.id === id ? data.psychologist : item)),
      );
      setStatus("Psicologo atualizado.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const handleCreatePatient = async () => {
    try {
      setStatus("Criando paciente...");
      const data = await postJson<{ patient: Patient }>("/api/admin/patients", {
        email: newPatientEmail,
        displayName: newPatientName,
        phoneE164: newPatientPhone,
        psychologistUserId: newPatientPsychologist || undefined,
        preferredLanguage: newPatientLanguage,
      });
      setPatients([data.patient, ...patients]);
      setNewPatientEmail("");
      setNewPatientName("");
      setNewPatientPhone("");
      setNewPatientPsychologist("");
      setNewPatientLanguage("ES");
      setStatus("Paciente criado.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const handleUpdatePatient = async (
    id: string,
    updates: Partial<Patient>,
  ) => {
    try {
      setStatus("Atualizando paciente...");
      const data = await patchJson<{ patient: Patient }>(
        `/api/admin/patients/${id}`,
        updates,
      );
      setPatients(
        patients.map((item) => (item.id === id ? data.patient : item)),
      );
      setStatus("Paciente atualizado.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[28px] border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
          <h2 className="text-2xl text-[color:var(--ink-900)]">Psicologos</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input
              className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
              placeholder="Email do psicologo"
              value={newPsychEmail}
              onChange={(event) => setNewPsychEmail(event.target.value)}
            />
            <input
              className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
              placeholder="Nome de exibicao"
              value={newPsychName}
              onChange={(event) => setNewPsychName(event.target.value)}
            />
            <button
              className="h-11 rounded-xl bg-[color:var(--accent-500)] px-4 text-sm font-semibold text-white"
              type="button"
              onClick={handleCreatePsychologist}
            >
              Criar
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {psychologists.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4"
              >
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    className="h-10 rounded-lg border border-black/10 bg-white/90 px-3 text-sm"
                    defaultValue={item.email ?? ""}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (!value || value === item.email) {
                        return;
                      }
                      handleUpdatePsychologist(item.id, { email: value });
                    }}
                  />
                  <input
                    className="h-10 rounded-lg border border-black/10 bg-white/90 px-3 text-sm"
                    defaultValue={item.displayName ?? ""}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (!value || value === item.displayName) {
                        return;
                      }
                      handleUpdatePsychologist(item.id, { displayName: value });
                    }}
                  />
                  <button
                    className={`h-10 rounded-lg px-3 text-xs font-semibold ${
                      item.isActive
                        ? "border border-black/10 bg-white text-[color:var(--ink-900)]"
                        : "bg-[color:var(--accent-500)] text-white"
                    }`}
                    type="button"
                    onClick={() =>
                      handleUpdatePsychologist(item.id, {
                        isActive: !item.isActive,
                      })
                    }
                  >
                    {item.isActive ? "Desativar" : "Ativar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
          <h2 className="text-2xl text-[color:var(--ink-900)]">Equipe</h2>
          <p className="mt-2 text-sm text-[color:var(--ink-500)]">
            Gerencie psicologos e pacientes associados ao tenant.
          </p>
        </div>
      </section>

      <section className="rounded-[28px] border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
        <h2 className="text-2xl text-[color:var(--ink-900)]">Pacientes</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
          <input
            className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
            placeholder="Email do paciente"
            value={newPatientEmail}
            onChange={(event) => setNewPatientEmail(event.target.value)}
          />
          <input
            className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
            placeholder="Nome"
            value={newPatientName}
            onChange={(event) => setNewPatientName(event.target.value)}
          />
          <input
            className="h-11 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
            placeholder="Telefone E164"
            value={newPatientPhone}
            onChange={(event) => setNewPatientPhone(event.target.value)}
          />
          <select
            className="h-11 rounded-xl border border-black/10 bg-white/90 px-3 text-sm"
            value={newPatientPsychologist}
            onChange={(event) => setNewPatientPsychologist(event.target.value)}
          >
            <option value="">Psicologo responsavel</option>
            {activePsychologists.map((psych) => (
              <option key={psych.id} value={psych.id}>
                {psych.displayName ?? psych.email}
              </option>
            ))}
          </select>
          <select
            className="h-11 rounded-xl border border-black/10 bg-white/90 px-3 text-sm"
            value={newPatientLanguage}
            onChange={(event) =>
              setNewPatientLanguage(event.target.value as Patient["preferredLanguage"])
            }
          >
            <option value="ES">Espanhol</option>
            <option value="PT">Portugues</option>
            <option value="EN">Ingles</option>
          </select>
          <button
            className="h-11 rounded-xl bg-[color:var(--accent-500)] px-4 text-sm font-semibold text-white"
            type="button"
            onClick={handleCreatePatient}
          >
            Criar
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {patients.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-4"
            >
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <input
                  className="h-10 rounded-lg border border-black/10 bg-white/90 px-3 text-sm"
                  defaultValue={item.email ?? ""}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (!value || value === item.email) {
                      return;
                    }
                    handleUpdatePatient(item.id, { email: value });
                  }}
                />
                <input
                  className="h-10 rounded-lg border border-black/10 bg-white/90 px-3 text-sm"
                  defaultValue={item.displayName ?? ""}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (!value || value === item.displayName) {
                      return;
                    }
                    handleUpdatePatient(item.id, { displayName: value });
                  }}
                />
                <input
                  className="h-10 rounded-lg border border-black/10 bg-white/90 px-3 text-sm"
                  defaultValue={item.phoneE164 ?? ""}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (!value || value === item.phoneE164) {
                      return;
                    }
                    handleUpdatePatient(item.id, { phoneE164: value });
                  }}
                />
                <select
                  className="h-10 rounded-lg border border-black/10 bg-white/90 px-3 text-xs"
                  defaultValue={item.preferredLanguage}
                  onChange={(event) =>
                    handleUpdatePatient(item.id, {
                      preferredLanguage: event.target.value as Patient["preferredLanguage"],
                    })
                  }
                >
                  <option value="ES">Espanhol</option>
                  <option value="PT">Portugues</option>
                  <option value="EN">Ingles</option>
                </select>
                <button
                  className={`h-10 rounded-lg px-3 text-xs font-semibold ${
                    item.isActive
                      ? "border border-black/10 bg-white text-[color:var(--ink-900)]"
                      : "bg-[color:var(--accent-500)] text-white"
                  }`}
                  type="button"
                  onClick={() =>
                    handleUpdatePatient(item.id, { isActive: !item.isActive })
                  }
                >
                  {item.isActive ? "Desativar" : "Ativar"}
                </button>
              </div>
              <p className="mt-2 text-xs text-[color:var(--ink-500)]">
                Psicologo: {item.psychologistName ?? "Nao atribuido"}
              </p>
            </div>
          ))}
        </div>
      </section>

      {status ? (
        <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] px-4 py-3 text-xs text-[color:var(--ink-500)]">
          {status}
        </div>
      ) : null}
    </div>
  );
}
