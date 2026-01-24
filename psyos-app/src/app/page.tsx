export default function Home() {
  return (
    <div className="min-h-screen px-6 pb-16 pt-10 text-[color:var(--ink-900)] sm:px-10">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-[color:var(--accent-500)]/90 shadow-[0_10px_30px_rgba(196,87,60,0.35)]" />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--ink-500)]">
              PsyOS
            </p>
            <p className="text-sm font-semibold text-[color:var(--ink-900)]">
              Plataforma clinica multi-tenant
            </p>
          </div>
        </div>
        <a
          href="/login"
          className="rounded-full border border-black/10 bg-white/70 px-4 py-2 text-sm font-semibold text-[color:var(--ink-900)] shadow-[0_10px_30px_var(--shadow-color)] backdrop-blur"
        >
          Entrar
        </a>
      </header>

      <main className="mx-auto mt-12 w-full max-w-5xl">
        <section className="rounded-[32px] border border-black/10 bg-white/70 p-8 shadow-[0_25px_60px_var(--shadow-color)] backdrop-blur sm:p-12">
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ink-500)]">
            Acompanhamento entre sessoes
          </p>
          <h1 className="mt-4 text-4xl leading-tight text-[color:var(--ink-900)] sm:text-5xl">
            Um espaco seguro para o paciente registrar o que sente e seguir em
            contato com sua psicologa.
          </h1>
          <p className="mt-4 text-base leading-7 text-[color:var(--ink-700)] sm:text-lg">
            O paciente pode escrever pelo WhatsApp ou pelo portal web, mantendo o
            historico organizado e acessivel para a psicologa acompanhar entre as
            sessoes.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="/login"
              className="rounded-full bg-[color:var(--accent-500)] px-5 py-2 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(196,87,60,0.35)]"
            >
              Entrar no sistema
            </a>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              {
                title: "Privacidade em primeiro lugar",
                detail: "Conversas protegidas para o paciente se sentir seguro.",
              },
              {
                title: "Continuidade entre sessoes",
                detail: "Registro claro do que aconteceu no dia a dia.",
              },
              {
                title: "Suporte com respeito clinico",
                detail: "Orientacao sem substituir a terapia.",
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
