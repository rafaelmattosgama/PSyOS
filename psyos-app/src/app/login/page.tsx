"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type StatusState = {
  tone: "idle" | "loading" | "success" | "error";
  message: string;
};

type Stage = "email" | "login" | "setup" | "not_found";

const initialStatus: StatusState = { tone: "idle", message: "" };

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

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [stage, setStage] = useState<Stage>("email");
  const [status, setStatus] = useState<StatusState>(initialStatus);
  const router = useRouter();

  const setLoading = (message: string) =>
    setStatus({ tone: "loading", message });
  const setError = (message: string) =>
    setStatus({ tone: "error", message });
  const setSuccess = (message: string) =>
    setStatus({ tone: "success", message });

  const canUseEmail = email.trim().length > 0;
  const canUsePassword = password.trim().length > 0;

  const resetFlow = () => {
    setStage("email");
    setPassword("");
    setConfirmPassword("");
    setStatus(initialStatus);
  };

  const handleCheckEmail = async () => {
    if (!canUseEmail) {
      setError("Informe o email.");
      return;
    }
    try {
      setLoading("Verificando email...");
      const data = await postJson<{ status: Stage }>("/api/auth/email/check", {
        email,
      });
      if (data.status === "login") {
        setStage("login");
        setSuccess("Email encontrado. Informe a senha.");
      } else if (data.status === "setup") {
        setStage("setup");
        setSuccess("Primeiro acesso. Defina uma senha.");
      } else {
        setStage("not_found");
        setError("Email nao encontrado.");
      }
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const handlePasswordLogin = async () => {
    if (!canUseEmail || !canUsePassword) {
      setError("Informe email e senha.");
      return;
    }
    try {
      setLoading("Autenticando com senha...");
      const data = await postJson<{ redirectTo?: string }>(
        "/api/auth/password/login",
        {
          email,
          password,
        },
      );
      setSuccess("Login com senha ok.");
      if (data.redirectTo) {
        router.push(data.redirectTo);
      }
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const handlePasswordSetup = async () => {
    if (!canUseEmail || !canUsePassword || !confirmPassword.trim()) {
      setError("Informe email e as duas senhas.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas nao conferem.");
      return;
    }
    try {
      setLoading("Salvando senha...");
      const data = await postJson<{ redirectTo?: string }>(
        "/api/auth/password/setup",
        {
          email,
          password,
          confirmPassword,
        },
      );
      setSuccess("Senha criada. Entrando...");
      if (data.redirectTo) {
        router.push(data.redirectTo);
      }
    } catch (error) {
      setError((error as Error).message);
    }
  };

  return (
    <div className="min-h-screen px-6 pb-16 pt-12">
      <div className="mx-auto w-full max-w-5xl">
        <header className="rounded-[28px] border border-black/10 bg-white/80 p-8 shadow-[0_18px_40px_var(--shadow-color)]">
          <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
            Acesso seguro
          </p>
          <h1 className="mt-3 text-4xl text-[color:var(--ink-900)]">Entrar</h1>
          <p className="mt-3 max-w-2xl text-sm text-[color:var(--ink-700)]">
            Informe o email. Se ja existir, pedimos a senha. Se for o primeiro
            acesso, pedimos para criar a senha.
          </p>
        </header>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-black/10 bg-white/70 p-8 shadow-[0_18px_40px_var(--shadow-color)]">
            <div className="grid gap-3">
              <label className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                Email
              </label>
              <input
                className="h-12 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                placeholder="admin@psyos.local"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onFocus={() => setStatus(initialStatus)}
              />

              {stage === "login" || stage === "setup" ? (
                <>
                  <label className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    Senha
                  </label>
                  <input
                    className="h-12 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                    placeholder="Sua senha"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </>
              ) : null}

              {stage === "setup" ? (
                <>
                  <label className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    Confirmar senha
                  </label>
                  <input
                    className="h-12 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                    placeholder="Repita a senha"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                  <p className="text-xs text-[color:var(--ink-500)]">
                    Minimo 12 caracteres, maiuscula, minuscula, numero e simbolo.
                  </p>
                </>
              ) : null}
            </div>

            <div className="mt-6 grid gap-3">
              {stage === "email" || stage === "not_found" ? (
                <button
                  className="h-12 rounded-xl bg-[color:var(--accent-500)] text-sm font-semibold text-white shadow-[0_12px_24px_rgba(196,87,60,0.35)]"
                  type="button"
                  onClick={handleCheckEmail}
                >
                  Continuar
                </button>
              ) : null}

              {stage === "login" ? (
                <button
                  className="h-12 rounded-xl bg-[color:var(--accent-500)] text-sm font-semibold text-white shadow-[0_12px_24px_rgba(196,87,60,0.35)]"
                  type="button"
                  onClick={handlePasswordLogin}
                >
                  Entrar
                </button>
              ) : null}

              {stage === "setup" ? (
                <button
                  className="h-12 rounded-xl bg-[color:var(--accent-500)] text-sm font-semibold text-white shadow-[0_12px_24px_rgba(196,87,60,0.35)]"
                  type="button"
                  onClick={handlePasswordSetup}
                >
                  Criar senha
                </button>
              ) : null}

              {stage !== "email" ? (
                <button
                  className="h-12 rounded-xl border border-black/10 bg-white/80 text-sm font-semibold text-[color:var(--ink-900)]"
                  type="button"
                  onClick={resetFlow}
                >
                  Usar outro email
                </button>
              ) : null}
            </div>

            {status.message ? (
              <div
                className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
                  status.tone === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : status.tone === "error"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-black/10 bg-[color:var(--surface-100)] text-[color:var(--ink-600)]"
                }`}
              >
                {status.message}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-[28px] border border-black/10 bg-white/80 p-6 shadow-[0_18px_40px_var(--shadow-color)]">
              <h2 className="text-2xl text-[color:var(--ink-900)]">
                Contas demo
              </h2>
              <div className="mt-4 space-y-3 text-sm text-[color:var(--ink-600)]">
                <p>Admin: admin@psyos.local</p>
                <p>Psicologo: psicologo@psyos.local</p>
                <p>Paciente: paciente@psyos.local</p>
                <p>System: root@psyos.local</p>
                <p>Senha demo: 123456</p>
              </div>
            </div>
            <div className="rounded-[28px] border border-black/10 bg-[color:var(--surface-100)] p-6 text-xs text-[color:var(--ink-500)]">
              O tenant e identificado automaticamente pelo email.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
