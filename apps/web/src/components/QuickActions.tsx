import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LibraryEntry, OwnershipFormat, UpdateEntryInput } from "@gm/shared";
import { api } from "../lib/api.js";
import { StarRating } from "./StarRating.js";
import { CollectionPicker } from "./CollectionPicker.js";
import { AddConsoleControl, usePlatforms } from "./ConsolePicker.js";
import { statusChip } from "../lib/format.js";
import { useCategories } from "../lib/categories.js";
import { usePreferences } from "../lib/prefs.js";

const PANEL_WIDTH = 340;
/** Breathing room between the panel and the edge of the window. */
const MARGIN = 8;

/**
 * Everything you'd open a game's page to change, done where the game already
 * is: category, 100%, rating, tags, which consoles it's on, and which
 * collections it belongs to.
 *
 * The point is what *doesn't* happen. Marking something beaten used to mean
 * leaving the library, editing, and coming back to a grid that had forgotten
 * your sort and your scroll position — so the second game took as long to
 * file as the first. Nothing here navigates, and the caller holds the grid's
 * order while the panel is open (see `heldOrder` in the library page), so the
 * card you're editing stays exactly where you left it even when the edit is
 * the thing that would have moved it.
 */
export function QuickActionsPanel({
  entry,
  anchor,
  onClose,
  onChanged,
}: {
  entry: LibraryEntry;
  /** the button the panel hangs off, so it can flip above when space runs out */
  anchor: HTMLElement | null;
  onClose: () => void;
  /** fired after any write, so the grid can pin this card in place */
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const prefs = usePreferences();
  const categories = useCategories();
  const panelRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredStyle(anchor, panelRef);

  const allTags = useQuery({ queryKey: ["tags"], queryFn: () => api.getTags() });
  const platforms = usePlatforms();
  const [newTag, setNewTag] = useState("");
  // one line for whatever last went wrong: react-query keeps each mutation's
  // own error until that mutation runs again, so four of them left on screen
  // would still be showing a failed tag name after you'd moved on
  const [error, setError] = useState<string | null>(null);

  // click-away and Escape both close — but a click on the button that opened
  // it is the button's own business, or it would close and reopen at once
  useEffect(() => {
    function onDown(ev: MouseEvent) {
      const target = ev.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  function refreshed() {
    setError(null);
    onChanged();
    queryClient.invalidateQueries({ queryKey: ["library"] });
    queryClient.invalidateQueries({ queryKey: ["entry", entry.id] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  function failed(err: unknown) {
    setError(err instanceof Error ? err.message : "That didn't save");
  }

  const update = useMutation({
    mutationFn: (input: UpdateEntryInput) => api.updateEntry(entry.id, input),
    onSuccess: refreshed,
    onError: failed,
  });

  const setTags = useMutation({
    mutationFn: (tagIds: string[]) => api.setEntryTags(entry.id, tagIds),
    onSuccess: refreshed,
    onError: failed,
  });

  const createAndAttachTag = useMutation({
    mutationFn: async (name: string) => {
      const tag = await api.createTag({ name });
      await api.setEntryTags(entry.id, [...entry.tags.map((t) => t.id), tag.id]);
    },
    onSuccess: () => {
      setNewTag("");
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      refreshed();
    },
    onError: failed,
  });

  const setPlatforms = useMutation({
    mutationFn: (owned: Array<{ platformId: string; format: OwnershipFormat }>) =>
      api.setEntryPlatforms(entry.id, owned),
    onSuccess: () => {
      refreshed();
      // filing a game under a console can add it to your consoles list
      queryClient.invalidateQueries({ queryKey: ["consoles"] });
      queryClient.invalidateQueries({ queryKey: ["platforms"] });
    },
    onError: failed,
  });

  const owned = new Map(entry.platforms.map((p) => [p.platformId, p.format]));

  function togglePlatform(platformId: string) {
    const next = new Map(owned);
    if (next.has(platformId)) next.delete(platformId);
    else next.set(platformId, "digital");
    setPlatforms.mutate([...next].map(([platform, format]) => ({ platformId: platform, format })));
  }

  function toggleFormat(platformId: string) {
    const next = new Map(owned);
    next.set(platformId, next.get(platformId) === "digital" ? "physical" : "digital");
    setPlatforms.mutate([...next].map(([platform, format]) => ({ platformId: platform, format })));
  }

  // your consoles, minus the ones this game already sits on
  const spare = (platforms.data ?? []).filter((p) => p.owned && !owned.has(p.id));
  const saving =
    update.isPending || setTags.isPending || setPlatforms.isPending || createAndAttachTag.isPending;

  return (
    <div
      ref={panelRef}
      style={style}
      role="dialog"
      aria-label={`Quick actions for ${entry.game.title}`}
      className="z-50 w-[340px] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl shadow-black/50"
    >
      <div className="mb-2 flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">
          {entry.game.title}
        </p>
        {saving && <span className="flex-none text-xs text-zinc-500">Saving…</span>}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close quick actions"
          className="flex-none text-zinc-500 hover:text-zinc-200"
        >
          ✕
        </button>
      </div>

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

      <Section label="Category">
        <div className="flex flex-wrap gap-1.5">
          {(categories ?? []).map((cat) => {
            const chip = statusChip(cat.key, prefs, categories);
            const active = entry.status === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => update.mutate({ status: cat.key })}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  active
                    ? chip.className
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                }`}
                style={active ? chip.style : undefined}
              >
                {cat.label}
              </button>
            );
          })}
          {entry.status === "finished" && (
            <button
              type="button"
              onClick={() => update.mutate({ completed100: !entry.completed100 })}
              title="Everything done — collectibles, endings, the lot"
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                entry.completed100
                  ? "border-amber-500 bg-amber-950 text-amber-300"
                  : "border-dashed border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
              }`}
            >
              💯 100%
            </button>
          )}
        </div>
      </Section>

      <Section label="Your rating">
        <StarRating value={entry.rating} onChange={(v) => update.mutate({ rating: v })} />
      </Section>

      <Section label="Tags">
        <div className="flex flex-wrap items-center gap-1.5">
          {(allTags.data ?? []).map((t) => {
            const active = entry.tags.some((et) => et.id === t.id);
            const color = t.color ?? "#71717a";
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  const current = entry.tags.map((et) => et.id);
                  setTags.mutate(
                    active ? current.filter((tid) => tid !== t.id) : [...current, t.id],
                  );
                }}
                className="rounded-full border px-2.5 py-1 text-xs font-medium transition"
                style={
                  active
                    ? { backgroundColor: `${color}26`, color, borderColor: `${color}66` }
                    : { borderColor: "#3f3f46", color: "#71717a" }
                }
              >
                {t.name}
              </button>
            );
          })}
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              if (newTag.trim()) createAndAttachTag.mutate(newTag.trim());
            }}
            className="inline-flex"
          >
            <input
              value={newTag}
              onChange={(ev) => setNewTag(ev.target.value)}
              placeholder="+ new tag"
              className="w-24 rounded-full border border-dashed border-zinc-700 bg-transparent px-2.5 py-1 text-xs outline-none placeholder:text-zinc-600 focus:border-indigo-500"
            />
          </form>
        </div>
      </Section>

      <Section label="Owned on">
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.platforms.map((p) => (
            <span
              key={p.platformId}
              className="inline-flex overflow-hidden rounded-lg border border-zinc-700"
            >
              <button
                type="button"
                onClick={() => togglePlatform(p.platformId)}
                title="Take this game off the console"
                className="bg-indigo-600/30 px-2 py-1 text-xs text-indigo-200 hover:bg-indigo-600/50"
              >
                {p.parentName ? "↳ " : ""}
                {p.abbreviation ?? p.name}
              </button>
              <button
                type="button"
                onClick={() => toggleFormat(p.platformId)}
                title="Toggle physical/digital"
                className="border-l border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs hover:bg-zinc-700"
              >
                {p.format === "physical" ? "📦" : "💾"}
              </button>
            </span>
          ))}
          {spare.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => togglePlatform(p.id)}
              title={p.parentName ? `${p.parentName} storefront` : undefined}
              className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
            >
              {p.parentName ? "↳ " : ""}
              {p.abbreviation ?? p.name}
            </button>
          ))}
          <AddConsoleControl
            platforms={platforms.data ?? []}
            onAdded={(p) => togglePlatform(p.id)}
            label="+ New console"
          />
        </div>
      </Section>

      <Section label="Collections">
        <CollectionPicker gameId={entry.game.id} />
      </Section>

      <Link
        to="/game/$id"
        params={{ id: entry.id }}
        className="mt-3 block border-t border-zinc-800 pt-2 text-xs font-medium text-indigo-400 hover:text-indigo-300"
      >
        Open the full page — notes, lists, play time →
      </Link>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      {children}
    </div>
  );
}

/**
 * Pin the panel to its button in viewport coordinates.
 *
 * Fixed rather than absolute because the card it hangs off clips its own
 * overflow (that's what keeps the cover's corners rounded), and a popover
 * inside it would be sliced. It prefers to sit below the button, flips above
 * when the bottom of the window is closer than the panel is tall, and never
 * exceeds the window's height — a `ResizeObserver` re-places it as sections
 * inside it open and close.
 */
function useAnchoredStyle(
  anchor: HTMLElement | null,
  panelRef: React.RefObject<HTMLDivElement | null>,
): CSSProperties {
  const [placement, setPlacement] = useState<CSSProperties>({
    position: "fixed",
    // nothing to measure against yet: render it, invisibly, so it has a height
    // to place on the very next frame rather than flashing in the wrong corner
    visibility: "hidden",
    top: 0,
    left: 0,
  });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    function place() {
      if (!anchor || !panel) return;
      const button = anchor.getBoundingClientRect();
      const height = panel.offsetHeight;
      const maxHeight = window.innerHeight - MARGIN * 2;

      const below = button.bottom + MARGIN;
      const above = button.top - height - MARGIN;
      let top = below;
      if (below + height > window.innerHeight - MARGIN && above >= MARGIN) top = above;
      top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, window.innerHeight - height - MARGIN));

      // opens outward from the button, so the card you're editing stays
      // visible beside the panel rather than underneath it; against the right
      // edge of the window it falls back to opening inward
      const outward = button.left;
      const inward = button.right - PANEL_WIDTH;
      const left = Math.min(
        Math.max(outward + PANEL_WIDTH > window.innerWidth - MARGIN ? inward : outward, MARGIN),
        Math.max(MARGIN, window.innerWidth - PANEL_WIDTH - MARGIN),
      );

      setPlacement({ position: "fixed", top, left, maxHeight, visibility: "visible" });
    }

    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, panelRef]);

  return placement;
}
