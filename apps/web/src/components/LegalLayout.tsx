import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Footer } from "./Footer.js";

/**
 * Chrome for the public legal pages (/privacy, /terms). Deliberately outside
 * the Shell: these must be readable before signing up — the register page
 * points at them — so there's no auth gate and no app nav.
 */
export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-800">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          <Link to="/" className="text-base font-bold tracking-tight">
            🎮 Game Manager
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">{title}</h1>
        <p className="mt-1 text-xs text-zinc-500">Last updated: {updated}</p>
        <div className="mt-8 space-y-8">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-zinc-100">{heading}</h2>
      <div className="space-y-3 text-sm leading-6 text-zinc-300">{children}</div>
    </section>
  );
}
