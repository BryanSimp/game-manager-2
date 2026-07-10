import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  boxSpecFor,
  caseColorFor,
  caseColorIsLight,
  FAMILY_ACCENT,
  type ShelfEntry,
  type ShelfRow,
} from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";

type SortMode = "custom" | "title" | "release" | "rating";

function sortEntries(entries: ShelfEntry[], mode: SortMode): ShelfEntry[] {
  const list = [...entries];
  switch (mode) {
    case "custom":
      return list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    case "title":
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case "release":
      return list.sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"));
    case "rating":
      return list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  }
}

export function ShelfPage() {
  const queryClient = useQueryClient();
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const shelf = useQuery({ queryKey: ["shelf"], queryFn: () => api.getShelf() });

  const saveOrder = useMutation({
    mutationFn: ({ platformId, ids }: { platformId: string; ids: string[] }) =>
      api.setShelfOrder(platformId, ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shelf"] }),
  });

  const shelves = shelf.data ?? [];

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-bold">
          Shelf{" "}
          <span className="text-sm font-normal text-zinc-500">
            {shelves.reduce((acc, s) => acc + s.entries.length, 0)} copies across{" "}
            {shelves.length} consoles
          </span>
        </h1>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Sort
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200"
          >
            <option value="custom">Custom (drag to arrange)</option>
            <option value="title">Title A–Z</option>
            <option value="release">Release date</option>
            <option value="rating">Highest rated</option>
          </select>
        </label>
      </div>

      {shelf.isLoading && <p className="text-zinc-500">Loading shelf…</p>}

      {shelves.length === 0 && !shelf.isLoading && (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-12 text-center">
          <p className="mb-2 text-lg font-semibold">Your shelf is empty</p>
          <p className="text-sm text-zinc-400">
            Mark which platforms you own games on (open a game → "Owned on") and they appear
            here as boxes on your consoles' shelves.
          </p>
        </div>
      )}

      <div className="space-y-8">
        {shelves.map((row) => (
          <ShelfRowView
            key={row.platform.id}
            row={row}
            sortMode={sortMode}
            onReorder={(ids) => saveOrder.mutate({ platformId: row.platform.id, ids })}
          />
        ))}
      </div>
    </Shell>
  );
}

function ShelfRowView({
  row,
  sortMode,
  onReorder,
}: {
  row: ShelfRow;
  sortMode: SortMode;
  onReorder: (orderedUserGameIds: string[]) => void;
}) {
  const caseStyle = {
    color: caseColorFor(row.platform.name, row.platform.family),
    badge: FAMILY_ACCENT[row.platform.family],
  };
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const dragId = useRef<string | null>(null);

  const entries = useMemo(() => {
    const sorted = sortEntries(row.entries, sortMode);
    if (sortMode === "custom" && localOrder) {
      const byId = new Map(sorted.map((e) => [e.userGameId, e]));
      const ordered = localOrder
        .map((id) => byId.get(id))
        .filter((e): e is ShelfEntry => !!e);
      const missing = sorted.filter((e) => !localOrder.includes(e.userGameId));
      return [...ordered, ...missing];
    }
    return sorted;
  }, [row.entries, sortMode, localOrder]);

  function handleDrop(targetId: string) {
    const sourceId = dragId.current;
    dragId.current = null;
    if (!sourceId || sourceId === targetId) return;
    const ids = entries.map((e) => e.userGameId);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    setLocalOrder(ids);
    onReorder(ids);
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline gap-3">
        <span
          className="rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white"
          style={{ backgroundColor: caseStyle.badge }}
        >
          {row.platform.abbreviation ?? row.platform.name}
        </span>
        <h2 className="font-semibold">{row.platform.name}</h2>
        <span className="text-sm text-zinc-500">{row.entries.length} games</span>
      </div>

      <div
        className="flex gap-3 overflow-x-auto rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-4 pb-2"
        style={{ boxShadow: "inset 0 -14px 18px -14px rgba(0,0,0,0.9)" }}
      >
        {entries.map((entry) => (
          <GameBox
            key={`${entry.userGameId}-${entry.format}`}
            entry={entry}
            platformName={row.platform.name}
            caseColor={caseStyle.color}
            draggable={sortMode === "custom"}
            onDragStart={() => (dragId.current = entry.userGameId)}
            onDrop={() => handleDrop(entry.userGameId)}
          />
        ))}
        {/* shelf plank */}
      </div>
      <div
        className="h-2 rounded-b-lg"
        style={{
          background: "linear-gradient(180deg, #3f3f46 0%, #27272a 100%)",
          boxShadow: "0 4px 8px rgba(0,0,0,0.6)",
        }}
      />
    </section>
  );
}

const SHELF_BOX_H = 118; // px — every box on a shelf row is this tall; width/depth follow real ratios

function GameBox({
  entry,
  platformName,
  caseColor,
  draggable,
  onDragStart,
  onDrop,
}: {
  entry: ShelfEntry;
  platformName: string;
  caseColor: string;
  draggable: boolean;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const physical = entry.format === "physical";
  const spec = boxSpecFor(platformName);
  // real retail proportions: SNES boxes come out landscape, Switch cases slim & tall
  const boxW = Math.round(SHELF_BOX_H * (spec.w / spec.h));
  const boxD = Math.max(7, Math.round(SHELF_BOX_H * (spec.d / spec.h)));
  const lightCase = caseColorIsLight(caseColor);

  const cover = entry.coverSrc ? (
    <img
      src={entry.coverSrc}
      alt={entry.title}
      loading="lazy"
      draggable={false}
      className="h-full w-full object-cover"
    />
  ) : (
    <div className="flex h-full items-center justify-center bg-zinc-800 p-1.5 text-center text-[10px] font-semibold text-zinc-400">
      {entry.title}
    </div>
  );

  return (
    <Link
      to="/game/$id"
      params={{ id: entry.userGameId }}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      title={`${entry.title} (${physical ? "physical" : "digital"})`}
      className={`group flex-none select-none ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ width: physical ? boxW : 90 }}
    >
      {physical ? (
        // real 3D case at the platform's retail proportions; straightens on hover
        <div className="case-scene">
          <div
            className="case3d"
            style={{
              width: boxW,
              height: SHELF_BOX_H,
              filter: "drop-shadow(4px 6px 6px rgba(0,0,0,0.55))",
            }}
          >
            <div className="case3d-front bg-zinc-800">
              {spec.style !== "cardboard" && spec.wordmark && (
                <div
                  className="absolute inset-x-0 top-0 z-10 flex items-center justify-center overflow-hidden font-extrabold"
                  style={{
                    height: Math.round(SHELF_BOX_H * 0.08),
                    backgroundColor: caseColor,
                    color: lightCase ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.92)",
                    fontSize: 6,
                    letterSpacing: "0.1em",
                  }}
                >
                  {spec.wordmark}
                </div>
              )}
              {cover}
              {entry.status === "finished" && (
                <span className="absolute left-1 top-1 z-10 rounded bg-black/70 px-1 text-[10px]">
                  ✓
                </span>
              )}
            </div>
            <div className="case3d-spine" style={{ width: boxD, backgroundColor: caseColor }}>
              <div
                className="mt-1 rounded-[1px]"
                style={{
                  width: Math.max(2, boxD * 0.3),
                  height: 14,
                  backgroundColor: lightCase ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.85)",
                }}
              />
              <span
                className="case3d-spine-title"
                style={{ color: lightCase ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.92)" }}
              >
                {entry.title.toUpperCase()}
              </span>
            </div>
            <div className="case3d-edge" />
          </div>
        </div>
      ) : (
        <div
          className="relative overflow-hidden rounded-lg bg-zinc-800 opacity-90 transition group-hover:-translate-y-1"
          style={{ height: SHELF_BOX_H, boxShadow: "0 2px 4px rgba(0,0,0,0.4)" }}
        >
          {cover}
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px]">💾</span>
          {entry.status === "finished" && (
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px]">✓</span>
          )}
        </div>
      )}
      <p className="mt-1 truncate text-center text-[11px] text-zinc-400 group-hover:text-zinc-200">
        {entry.title}
      </p>
    </Link>
  );
}
