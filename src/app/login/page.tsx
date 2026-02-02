"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LANGUAGE_OPTIONS, useLanguage } from "@/lib/i18n";

type StatusState = {
  tone: "idle" | "loading" | "success" | "error";
  message: string;
};

type Stage = "email" | "login" | "setup" | "not_found" | "reset_request" | "reset_confirm";

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
  const { language, setLanguage, t } = useLanguage();
  const [email, setEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [stage, setStage] = useState<Stage>("email");
  const [status, setStatus] = useState<StatusState>(initialStatus);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("reset");
    if (token) {
      handleResetViaLink(token, searchParams.get("email"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setLoading = (message: string) =>
    setStatus({ tone: "loading", message });
  const setError = (message: string) =>
    setStatus({ tone: "error", message });
  const setSuccess = (message: string) =>
    setStatus({ tone: "success", message });

  const canUseEmail = email.trim().length > 0;
  const canUsePassword = password.trim().length > 0;
  const hasMinLength = password.length >= 12;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const passwordMeetsAll =
    hasMinLength && hasUpper && hasLower && hasNumber && hasSymbol && passwordsMatch;

  const resetFlow = () => {
    setStage("email");
    setPassword("");
    setConfirmPassword("");
    setResetToken("");
    setStatus(initialStatus);
  };

  const handleCheckEmail = async () => {
    if (!canUseEmail) {
      setError(t.statusEmailRequired);
      return;
    }
    try {
      setLoading(t.statusCheckEmail);
      const data = await postJson<{ status: Stage }>("/api/auth/email/check", {
        email,
      });
      if (data.status === "login") {
        setStage("login");
        setSuccess(t.statusEmailFound);
      } else if (data.status === "setup") {
        setStage("setup");
        setSuccess(t.statusFirstAccess);
      } else {
        setStage("not_found");
        setError(t.statusEmailNotFound);
      }
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const handlePasswordLogin = async () => {
    if (!canUseEmail || !canUsePassword) {
      setError(t.statusLoginRequired);
      return;
    }
    try {
      setLoading(t.statusAuth);
      const data = await postJson<{ redirectTo?: string }>(
        "/api/auth/password/login",
        {
          email,
          password,
        },
      );
      setSuccess(t.statusLoginOk);
      if (data.redirectTo) {
        router.push(data.redirectTo);
      }
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const handlePasswordSetup = async () => {
    if (!canUseEmail || !canUsePassword || !confirmPassword.trim()) {
      setError(t.statusSetupRequired);
      return;
    }
    if (password !== confirmPassword) {
      setError(t.statusMismatch);
      return;
    }
    try {
      setLoading(t.statusSavingPassword);
      const data = await postJson<{ redirectTo?: string }>(
        "/api/auth/password/setup",
        {
          email,
          password,
          confirmPassword,
        },
      );
      setSuccess(t.statusPasswordCreated);
      if (data.redirectTo) {
        router.push(data.redirectTo);
      }
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const handleResetRequest = async () => {
    if (!canUseEmail) {
      setError(t.statusEmailRequired);
      return;
    }
    try {
      setLoading(t.statusCheckEmail);
      await postJson("/api/auth/password/reset/request", { email });
      setSuccess(t.resetLinkSent);
    } catch (error) {
      setSuccess(t.resetLinkSent);
    }
  };

  const handleResetConfirm = async () => {
    if (!canUseEmail || !passwordMeetsAll) {
      setError(t.statusSetupRequired);
      return;
    }
    if (!resetToken) {
      setError("Token ausente.");
      return;
    }
    try {
      setLoading(t.statusSavingPassword);
      await postJson("/api/auth/password/reset/confirm", {
        email,
        token: resetToken,
        password,
        confirmPassword,
      });
      setSuccess(t.resetPasswordOk);
      setStage("login");
      setPassword("");
      setConfirmPassword("");
      setResetToken("");
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const handleForgotPassword = () => {
    setStage("reset_request");
    setPassword("");
    setConfirmPassword("");
    setStatus(initialStatus);
  };

  const handleResetViaLink = (token: string, emailParam: string | null) => {
    setStage("reset_confirm");
    if (emailParam) {
      setEmail(emailParam);
    }
    setResetToken(token);
    setStatus(initialStatus);
  };

  return (
    <div className="min-h-screen px-6 pb-16 pt-12">
      <div className="mx-auto w-full max-w-5xl">
        <header className="rounded-[28px] border border-black/10 bg-white/80 p-8 shadow-[0_18px_40px_var(--shadow-color)]">
          <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--ink-500)]">
            {t.secureAccess}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-4xl text-[color:var(--ink-900)]">{t.loginTitle}</h1>
            <select
              className="h-9 rounded-full border border-black/10 bg-white/80 px-3 text-xs font-semibold text-[color:var(--ink-900)]"
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as typeof language)
              }
              aria-label="Idioma"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-3 max-w-2xl text-sm text-[color:var(--ink-700)]">
            {t.loginSubtitle}
          </p>
        </header>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-black/10 bg-white/70 p-8 shadow-[0_18px_40px_var(--shadow-color)]">
            <div className="grid gap-3">
              <label className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                {t.labelEmail}
              </label>
              <input
                className="h-12 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                placeholder={t.placeholderEmail}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onFocus={() => setStatus(initialStatus)}
              />
              {stage === "reset_request" ? (
                <p className="text-xs text-[color:var(--ink-500)]">
                  {t.resetPasswordIntro}
                </p>
              ) : null}

              {stage === "login" || stage === "setup" || stage === "reset_confirm" ? (
                <>
                  <label className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    {stage === "reset_confirm" ? t.newPassword : t.labelPassword}
                  </label>
                  <input
                    className="h-12 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                    placeholder={t.placeholderPassword}
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </>
              ) : null}

              {stage === "setup" || stage === "reset_confirm" ? (
                <>
                  <label className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                    {stage === "reset_confirm" ? t.confirmNewPassword : t.labelConfirm}
                  </label>
                  <input
                    className="h-12 rounded-xl border border-black/10 bg-white/90 px-4 text-sm"
                    placeholder={t.placeholderConfirm}
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                  <div className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] p-3 text-xs">
                    <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
                      {t.passwordChecklistTitle}
                    </p>
                    <div className="mt-2 space-y-1">
                      {[
                        { ok: hasMinLength, label: t.passwordMinLength },
                        { ok: hasUpper, label: t.passwordUpper },
                        { ok: hasLower, label: t.passwordLower },
                        { ok: hasNumber, label: t.passwordNumber },
                        { ok: hasSymbol, label: t.passwordSymbol },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className={`flex items-center gap-2 ${
                            item.ok ? "text-emerald-700" : "text-[color:var(--ink-500)]"
                          }`}
                        >
                          <span className="text-[10px]">
                            {item.ok ? "●" : "○"}
                          </span>
                          <span>{item.label}</span>
                        </div>
                      ))}
                      <div
                        className={`flex items-center gap-2 ${
                          passwordsMatch ? "text-emerald-700" : "text-[color:var(--ink-500)]"
                        }`}
                      >
                        <span className="text-[10px]">
                          {passwordsMatch ? "●" : "○"}
                        </span>
                        <span>{t.passwordMatch}</span>
                      </div>
                    </div>
                  </div>
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
                  {t.continue}
                </button>
              ) : null}

              {stage === "login" ? (
                <button
                  className="h-12 rounded-xl bg-[color:var(--accent-500)] text-sm font-semibold text-white shadow-[0_12px_24px_rgba(196,87,60,0.35)]"
                  type="button"
                  onClick={handlePasswordLogin}
                >
                  {t.login}
                </button>
              ) : null}

              {stage === "setup" ? (
                <button
                  className="h-12 rounded-xl bg-[color:var(--accent-500)] text-sm font-semibold text-white shadow-[0_12px_24px_rgba(196,87,60,0.35)]"
                  type="button"
                  onClick={handlePasswordSetup}
                  disabled={!passwordMeetsAll}
                >
                  {t.createPassword}
                </button>
              ) : null}

              {stage === "reset_request" ? (
                <button
                  className="h-12 rounded-xl bg-[color:var(--accent-500)] text-sm font-semibold text-white shadow-[0_12px_24px_rgba(196,87,60,0.35)]"
                  type="button"
                  onClick={handleResetRequest}
                >
                  {t.sendResetLink}
                </button>
              ) : null}

              {stage === "reset_confirm" ? (
                <button
                  className="h-12 rounded-xl bg-[color:var(--accent-500)] text-sm font-semibold text-white shadow-[0_12px_24px_rgba(196,87,60,0.35)]"
                  type="button"
                  onClick={handleResetConfirm}
                  disabled={!passwordMeetsAll}
                >
                  {t.resetPasswordAction}
                </button>
              ) : null}

              {stage === "login" ? (
                <button
                  className="h-12 rounded-xl border border-black/10 bg-white/80 text-sm font-semibold text-[color:var(--ink-900)]"
                  type="button"
                  onClick={handleForgotPassword}
                >
                  {t.forgotPassword}
                </button>
              ) : null}

              {stage !== "email" && stage !== "reset_request" ? (
                <button
                  className="h-12 rounded-xl border border-black/10 bg-white/80 text-sm font-semibold text-[color:var(--ink-900)]"
                  type="button"
                  onClick={resetFlow}
                >
                  {t.useAnotherEmail}
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
                {t.demoAccounts}
              </h2>
              <div className="mt-4 space-y-3 text-sm text-[color:var(--ink-600)]">
                <p>Admin: admin@psyos.local</p>
                <p>Psicologo: psicologo@psyos.local</p>
                <p>Paciente: paciente@psyos.local</p>
                <p>System: root@psyos.local</p>
                <p>{t.demoPassword}</p>
              </div>
            </div>
            <div className="rounded-[28px] border border-black/10 bg-[color:var(--surface-100)] p-6 text-xs text-[color:var(--ink-500)]">
              {t.tenantHint}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
