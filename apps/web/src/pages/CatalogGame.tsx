import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OwnershipFormat } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { StarRating } from "../components/StarRating.js";
import { ConsoleSelect } from "../components/ConsolePicker.js";
import { AddCollectionToLibrary } from "../components/AddCollectionToLibrary.js";
import { CollectionPicker } from "../components/CollectionPicker.js";
import {
  LinkedGamesMenu,
  LinkedGamesPanel,
  linkCount,
  useGameLinks,
} from "../components/LinkedGames.js";
import { formatHours } from "../lib/format.js";
import { useCategories } from "../lib/categories.js";

type Tab = "overview" | "linked";

/**
 * A game you don't own, from the shared catalog.
 *
 * Collections can list games you haven't got — "the Zelda games in order" is
 * a reading list, not an inventory — and following one of those rows used to
 * drop you in the add-game search with the title pre-typed. That asked you to
 * find a game the app had already identified, and left you looking at a
 * search box instead of the thing you clicked. This is the game itself, with
 * adding reduced to one button.
 *
 * If it turns out you *do* own it, this redirects to your own copy: your
 * rating, notes and lists are the better page, and two URLs for one game you
 * own would be a bug you'd notice in the back button.
 *
 * Links get the same Linked tab the owned page has. A DLC you linked from its
 * base game lands here when you click it, and it has to say what it's DLC for
 * — a link that only showed on the games you own would only show half of
 * itself.
 */
export function CatalogGamePage() {
  const { gameId } = useParams({ from: "/catalog/$gameId" });
  const { tab: tabParam } = useSearch({ from: "/catalog/$gameId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useCategories();

  // in the URL for the same reason as the owned page: Back from a linked game
  // should land on the Linked tab you left
  const tab: Tab = tabParam ?? "overview";
  function setTab(next: Tab) {
    navigate({
      to: "/catalog/$gameId",
      params: { gameId },
      search: next === "overview" ? {} : { tab: next },
      replace: true,
      resetScroll: false,
    });
  }

  const catalog = useQuery({
    queryKey: ["catalog-game", gameId],
    queryFn: () => api.getCatalogGame(gameId),
  });
  const links = useGameLinks(gameId);
  const linkTotal = linkCount(links.data);

  const [status, setStatus] = useState<string>("");
  const [platformId, setPlatformId] = useState<string | null>(null);
  const [format, setFormat] = useState<OwnershipFormat>("digital");

  const owned = catalog.data?.userGameId ?? null;
  useEffect(() => {
    // replace, not push: the row you came from should still be one Back away.
    // A Linked tab carries over — the owned page has one too.
    if (owned) {
      navigate({
        to: "/game/$id",
        params: { id: owned },
        search: tabParam ? { tab: tabParam } : {},
        replace: true,
      });
    }
  }, [owned, tabParam, navigate]);

  const add = useMutation({
    mutationFn: () =>
      api.addToLibrary({
        gameId,
        // "" means "whatever my default category is" — the server fills it in
        ...(status ? { status } : {}),
        ...(platformId ? { platforms: [{ platformId, format }] } : {}),
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["consoles"] });
      queryClient.invalidateQueries({ queryKey: ["catalog-game", gameId] });
      navigate({ to: "/game/$id", params: { id: created.id }, replace: true });
    },
  });

  if (catalog.isLoading) {
    return (
      <Shell>
        <p className="text-zinc-500">Loading…</p>
      </Shell>
    );
  }
  if (!catalog.data) {
    return (
      <Shell>
        <p className="text-red-400">Game not found.</p>
      </Shell>
    );
  }

  const g = catalog.data.game;
  const rating = catalog.data.communityRating;
  const hasTimes = g.ttbMain != null || g.ttbMainExtra != null || g.ttbCompletionist != null;

  return (
    <Shell>
      <div className="grid gap-8 md:grid-cols-[240px_1fr]">
        <div>
          <div className="aspect-[3/4] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800">
            {g.coverSrc ? (
              <img src={g.coverSrc} alt={g.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center p-4 text-center font-semibold text-zinc-500">
                {g.title}
              </div>
            )}
          </div>

          {hasTimes && (
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm">
              <p className="mb-2 font-semibold text-zinc-300">How long to beat</p>
              <Ttb label="Main story" value={formatHours(g.ttbMain)} />
              <Ttb label="Main + extras" value={formatHours(g.ttbMainExtra)} />
              <Ttb label="Completionist" value={formatHours(g.ttbCompletionist)} />
            </div>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
            Not in your library
          </p>
          <h1 className="mt-1 text-2xl font-bold">{g.title}</h1>
          {g.releaseDate && (
            <p className="mt-1 text-sm text-zinc-500">Released {g.releaseDate}</p>
          )}
          <LinkedGamesMenu gameId={gameId} onManage={() => setTab("linked")} />

          <div className="mt-4 flex gap-1 border-b border-zinc-800">
            {(
              [
                { key: "overview", label: "Overview" },
                { key: "linked", label: "Linked" },
              ] as Array<{ key: Tab; label: string }>
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                  tab === t.key
                    ? "border-indigo-500 text-indigo-300"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t.label}
                {t.key === "linked" && linkTotal > 0 && (
                  <span className="ml-1.5 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">
                    {linkTotal}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === "linked" && (
            <LinkedGamesPanel gameId={gameId} igdbId={g.igdbId} title={g.title} />
          )}

          <div className={tab === "overview" ? "" : "hidden"}>
          <div className="mt-5 rounded-xl border border-indigo-900/60 bg-zinc-900 p-4">
            <p className="text-sm font-semibold text-zinc-200">Add it to your library</p>
            <p className="mt-1 text-xs text-zinc-500">
              Leave these alone to use your defaults — you can change everything afterwards.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={status}
                onChange={(ev) => setStatus(ev.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
              >
                <option value="">Default category</option>
                {(categories ?? []).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>

              <ConsoleSelect
                value={platformId}
                onChange={setPlatformId}
                placeholder="Default platform"
              />
              {platformId && (
                <button
                  onClick={() => setFormat(format === "digital" ? "physical" : "digital")}
                  title="Toggle physical/digital"
                  className="rounded-lg border border-zinc-700 px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  {format === "physical" ? "📦 Physical" : "💾 Digital"}
                </button>
              )}

              <button
                onClick={() => add.mutate()}
                disabled={add.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
              >
                {add.isPending ? "Adding…" : "+ Add to library"}
              </button>
            </div>
            {add.isError && (
              <p className="mt-2 text-xs text-red-400">
                {add.error instanceof Error ? add.error.message : "Couldn't add that game"}
              </p>
            )}
          </div>

          <div className="mt-5">
            <p className="mb-1 text-sm font-semibold text-zinc-300">Everyone's rating</p>
            {rating ? (
              <div className="flex items-center gap-2">
                <StarRating value={rating.average} />
                <span className="text-sm text-zinc-400">
                  {rating.average.toFixed(1)}
                  <span className="ml-1 text-xs text-zinc-600">
                    ({rating.count} rating{rating.count === 1 ? "" : "s"})
                  </span>
                </span>
              </div>
            ) : (
              <p className="text-xs text-zinc-600">
                Needs {catalog.data.minRatings} ratings before an average is shown.
              </p>
            )}
          </div>

          {g.summary && (
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-zinc-400">{g.summary}</p>
          )}

          <div className="mt-6">
            <p className="mb-2 text-sm font-semibold text-zinc-300">
              Collections{" "}
              <span className="font-normal text-zinc-500">
                (a collection is a reading list — you needn't own the game)
              </span>
            </p>
            <CollectionPicker gameId={gameId} />
          </div>

          <PublicLists gameId={gameId} />
          <InPublicCollections gameId={gameId} />
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Ttb({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-0.5 text-zinc-400">
      <span>{label}</span>
      <span className="font-medium text-zinc-200">{value}</span>
    </div>
  );
}

/**
 * Lists other players have published for this game — a reason to add it, and
 * a preview of what the Progress tab will offer once you have. Copying is
 * left to that tab: a list you can't tick off yet isn't much use.
 */
function PublicLists({ gameId }: { gameId: string }) {
  const lists = useQuery({
    queryKey: ["checklists", gameId],
    queryFn: () => api.getGameChecklists(gameId),
  });
  const items = lists.data?.public ?? [];
  if (items.length === 0) return null;

  return (
    <div className="mt-8">
      <p className="mb-2 text-sm font-semibold text-zinc-300">
        Public lists for this game
        <span className="ml-2 text-xs font-normal text-zinc-600">
          copy one from the Progress tab once it's yours
        </span>
      </p>
      <div className="space-y-1.5">
        {items.slice(0, 5).map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{c.title}</span>
            <span className="shrink-0 text-xs text-zinc-500">
              {c.itemCount} entries{c.authorName ? ` · by ${c.authorName}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Public collections featuring this game — the same block the owned page has. */
function InPublicCollections({ gameId }: { gameId: string }) {
  const found = useQuery({
    queryKey: ["public-collections", "game", gameId],
    queryFn: () => api.getPublicCollections({ gameId, limit: 5 }),
  });
  const items = found.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <div className="mt-8">
      <p className="mb-2 text-sm font-semibold text-zinc-300">In public collections</p>
      <div className="space-y-1.5">
        {items.map((c) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
          >
            <Link
              to="/collection/$id"
              params={{ id: c.id }}
              className="min-w-0 flex-1 hover:text-indigo-300"
            >
              <span className="block truncate text-sm text-zinc-200">
                <span className="mr-1.5 text-amber-400">★</span>
                {c.name}
              </span>
              <span className="text-xs text-zinc-500">
                by {c.mine ? "you" : c.authorName} · {c.total} games
              </span>
            </Link>
            <AddCollectionToLibrary collectionId={c.id} total={c.total} />
          </div>
        ))}
      </div>
    </div>
  );
}
