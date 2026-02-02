"use client";

import { LANGUAGE_OPTIONS, useLanguage } from "@/lib/i18n";

export default function Home() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className="min-h-screen px-6 pb-16 pt-10 text-[color:var(--ink-900)] sm:px-10">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-[color:var(--accent-500)]/90 shadow-[0_10px_30px_rgba(196,87,60,0.35)]" />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
              {t.brandTag}
            </p>
            <p className="text-sm font-semibold text-[color:var(--ink-900)]">
              {t.brandSubtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
          <a
            href="/login"
            className="rounded-full border border-black/10 bg-white/70 px-4 py-2 text-sm font-semibold text-[color:var(--ink-900)] shadow-[0_10px_30px_var(--shadow-color)] backdrop-blur"
          >
            {t.homeLogin}
          </a>
        </div>
      </header>

      <main className="mx-auto mt-12 w-full max-w-5xl">
        <section className="rounded-[32px] border border-black/10 bg-white/70 p-8 shadow-[0_25px_60px_var(--shadow-color)] backdrop-blur sm:p-12">
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ink-500)]">
            {t.homeTag}
          </p>
          <h1 className="mt-4 text-4xl leading-tight text-[color:var(--ink-900)] sm:text-5xl">
            {t.homeTitle}
          </h1>
          <p className="mt-4 text-base leading-7 text-[color:var(--ink-700)] sm:text-lg">
            {t.homeBody}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="/login"
              className="rounded-full bg-[color:var(--accent-500)] px-5 py-2 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(196,87,60,0.35)]"
            >
              {t.homeCta}
            </a>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              {
                title: t.card1Title,
                detail: t.card1Detail,
              },
              {
                title: t.card2Title,
                detail: t.card2Detail,
              },
              {
                title: t.card3Title,
                detail: t.card3Detail,
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-black/10 bg-[color:var(--surface-100)] px-4 py-4"
              >
                <p className="text-sm font-semibold text-[color:var(--ink-900)]">
                  {item.title}
                </p>
                <p className="mt-2 text-xs text-[color:var(--ink-500)]">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
