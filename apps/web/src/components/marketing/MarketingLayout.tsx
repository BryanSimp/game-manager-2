import type { ReactNode } from "react";
import { Footer } from "../Footer.js";
import { MarketingNav } from "./MarketingNav.js";

/**
 * The chrome shared by every public page: sticky nav, a centred content
 * column, and the site footer.
 *
 * Deliberately outside the `Shell` — these pages must render with no session,
 * no `/api/me` fetch and no redirect to /login, so a visitor can read them
 * before signing up and a crawler can fetch them at all.
 *
 * The column used to be flanked by two 300px ad rails. Those are gone along
 * with the rest of the ad placeholders, so the content is centred on its own
 * and capped at a readable width rather than stretched across 1600px.
 */
export function MarketingLayout({
  children,
  variant = "page",
}: {
  children: ReactNode;
  variant?: "landing" | "page";
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav variant={variant} />

      <div className="mx-auto flex w-full max-w-6xl flex-1 px-4 py-6">
        {/* min-w-0 so long words and wide children can't stretch the column */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <Footer />
    </div>
  );
}

/** Standard heading block for a marketing section. */
export function SectionHeading({
  eyebrow,
  title,
  blurb,
  id,
}: {
  eyebrow?: string;
  title: string;
  blurb?: string;
  id?: string;
}) {
  return (
    <div id={id} className="scroll-mt-20">
      {eyebrow && (
        <p className="text-xs font-semibold tracking-widest text-indigo-400 uppercase">{eyebrow}</p>
      )}
      <h2 className="mt-2 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">{title}</h2>
      {blurb && <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{blurb}</p>}
    </div>
  );
}
