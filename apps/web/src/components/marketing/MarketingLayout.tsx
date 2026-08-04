import type { ReactNode } from "react";
import { Footer } from "../Footer.js";
import { MarketingNav } from "./MarketingNav.js";
import { AdRail } from "./AdRail.js";
import { AdSlot } from "./AdSlot.js";
import { AD_SLOTS } from "../../lib/adsense.js";

/**
 * The 'classic web' chrome shared by every public page: sticky nav, a centred
 * content column flanked by two sticky ad rails, and the site footer.
 *
 * Deliberately outside the `Shell` — these pages must render with no session,
 * no `/api/me` fetch and no redirect to /login, both so a visitor can read
 * them before signing up and so an ad crawler can fetch them at all.
 *
 * Below `xl` the rails drop away and the whole thing is one column; the ad
 * that would have been in a rail moves under the content as a horizontal unit.
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

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-6 px-4 py-6">
        <AdRail side="left" slotId={AD_SLOTS.railLeft} />

        {/* min-w-0 so long words and wide children can't stretch the column
            and squeeze the rails */}
        <main className="min-w-0 flex-1">
          {children}
          <AdSlot
            slotId={AD_SLOTS.contentMobile}
            format="horizontal"
            minHeight={100}
            className="mt-10 xl:hidden"
          />
        </main>

        <AdRail side="right" slotId={AD_SLOTS.railRight} />
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
