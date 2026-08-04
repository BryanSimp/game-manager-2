import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { authClient } from "../../lib/auth.js";

/** In-page anchors, used on the landing page where the sections exist. */
const SECTIONS = [
  { id: "features", label: "Features" },
  { id: "guides", label: "Guides" },
  { id: "faq", label: "FAQ" },
];

const linkClass =
  "rounded-lg px-3 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white";

const primaryClass =
  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500";

const secondaryClass =
  "rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800";

/**
 * Sticky top navigation for the public pages.
 *
 * `variant="landing"` links to the sections on the page itself; every other
 * public page gets router links back to them. Two variants rather than one
 * clever component because an anchor to `#features` from `/contact` scrolls
 * nowhere, and a router link to `/#features` from the landing page is a
 * pointless navigation.
 */
export function MarketingNav({ variant = "page" }: { variant?: "landing" | "page" }) {
  const [open, setOpen] = useState(false);
  const { data: session } = authClient.useSession();

  const navLinks =
    variant === "landing" ? (
      SECTIONS.map((section) => (
        <a key={section.id} href={`#${section.id}`} className={linkClass} onClick={() => setOpen(false)}>
          {section.label}
        </a>
      ))
    ) : (
      <>
        <Link to="/welcome" className={linkClass} onClick={() => setOpen(false)}>
          Home
        </Link>
        <Link to="/guides" className={linkClass} onClick={() => setOpen(false)}>
          Guides
        </Link>
        <Link to="/contact" className={linkClass} onClick={() => setOpen(false)}>
          Contact
        </Link>
      </>
    );

  // A signed-in visitor reading a guide shouldn't be told to sign up.
  const ctas = session ? (
    <Link to="/" className={primaryClass} onClick={() => setOpen(false)}>
      Open your library
    </Link>
  ) : (
    <>
      <Link to="/login" className={secondaryClass} onClick={() => setOpen(false)}>
        Log in
      </Link>
      <Link to="/register" className={primaryClass} onClick={() => setOpen(false)}>
        Get started
      </Link>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3">
        <Link to="/" className="shrink-0 text-base font-bold tracking-tight text-zinc-100">
          🎮 Game Manager
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 md:flex">
          {navLinks}
        </nav>
        <div className="hidden shrink-0 items-center gap-2 md:flex">{ctas}</div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="marketing-mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          className="ml-auto rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 md:hidden"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open && (
        <div id="marketing-mobile-nav" className="border-t border-zinc-800 px-4 py-3 md:hidden">
          <nav aria-label="Primary" className="flex flex-col gap-1">
            {navLinks}
          </nav>
          <div className="mt-3 flex flex-col gap-2">{ctas}</div>
        </div>
      )}
    </header>
  );
}
