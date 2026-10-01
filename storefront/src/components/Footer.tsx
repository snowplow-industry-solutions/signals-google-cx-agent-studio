export function Footer() {
  return (
    <footer className="border-t border-white/10 px-6 py-10 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.45em] text-[var(--muted)]">
            High-End Fashion Retail Demo
          </p>
          <p className="font-(--font-display) text-3xl text-foreground">
            Personalized by in-session Signals attributes.
          </p>
        </div>
        <div className="max-w-xl text-sm leading-7 text-[var(--muted)]">
          This storefront is designed to make Signals legible in a live demo: quiet luxury
          styling, visible personalization callouts, and tasteful interventions instead of
          promotional tactics.
        </div>
      </div>
    </footer>
  );
}
