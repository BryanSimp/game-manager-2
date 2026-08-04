import { Link } from "@tanstack/react-router";

const ext = "text-zinc-400 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-200";

/**
 * Site footer: the legal pages plus the attribution our data providers'
 * terms ask for — IGDB (Twitch Developer Services Agreement), SteamGridDB
 * (API terms), and the Steam Web API ("Powered by Steam", no implied
 * endorsement by Valve). Rendered by the Shell, by the public legal pages and
 * by the marketing layout, so the credits are visible wherever provider data
 * is shown — and so every public page carries the Privacy/Terms/Contact links
 * an ad network expects to find.
 */
export function Footer() {
  return (
    <footer className="mt-10 border-t border-zinc-800">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-zinc-500">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link to="/guides" className="font-medium text-zinc-400 hover:text-zinc-200">
            Guides
          </Link>
          <Link to="/contact" className="font-medium text-zinc-400 hover:text-zinc-200">
            Contact
          </Link>
          <Link to="/privacy" className="font-medium text-zinc-400 hover:text-zinc-200">
            Privacy Policy
          </Link>
          <Link to="/terms" className="font-medium text-zinc-400 hover:text-zinc-200">
            Terms of Service
          </Link>
          <span className="ml-auto">
            Powered by{" "}
            <a href="https://store.steampowered.com" target="_blank" rel="noopener noreferrer" className={ext}>
              Steam
            </a>
          </span>
        </div>
        <p className="mt-3">
          Game metadata and covers provided by{" "}
          <a href="https://www.igdb.com" target="_blank" rel="noopener noreferrer" className={ext}>
            IGDB
          </a>
          . Alternate artwork courtesy of{" "}
          <a href="https://www.steamgriddb.com" target="_blank" rel="noopener noreferrer" className={ext}>
            SteamGridDB
          </a>
          . Steam library and achievement data via the official{" "}
          <a href="https://steamcommunity.com/dev" target="_blank" rel="noopener noreferrer" className={ext}>
            Steam Web API
          </a>
          .
        </p>
        <p className="mt-1 text-zinc-600">
          Game Manager is not affiliated with, sponsored by, or endorsed by Valve Corporation,
          Twitch Interactive (IGDB), or SteamGridDB. All game titles, artwork, and trademarks
          belong to their respective owners.
        </p>
      </div>
    </footer>
  );
}
