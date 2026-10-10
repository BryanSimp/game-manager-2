import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BUILTIN_CATEGORIES,
  COLLECTION_GRAPH_NAME_MAX,
  type CollectionGameVersion,
  type CollectionGraph,
  type CollectionLink,
  type CollectionNode,
} from "@gm/shared";
import { api } from "../lib/api.js";
import { statusChip, statusLabel } from "../lib/format.js";
import { useCategories } from "../lib/categories.js";
import { usePreferences } from "../lib/prefs.js";

const NODE_W = 92;
const NODE_H = 122;

type Point = { x: number; y: number };

/** Ring colour for a node's category; unknown/custom keys get a neutral grey. */
function statusRing(status: string | null): string {
  if (!status) return "#3f3f46";
  return BUILTIN_CATEGORIES.find((c) => c.key === status)?.color ?? "#71717a";
}

function positionsOf(graph: CollectionGraph): Map<string, Point> {
  return new Map(graph.nodes.map((n) => [n.gameId, { x: n.x, y: n.y }]));
}

/** The same loose grid the server uses for a game nobody has placed yet. */
function gridSlot(n: number): Point {
  return { x: 80 + (n % 5) * 150, y: 80 + Math.floor(n / 5) * 190 };
}

/**
 * One of a collection's graphs: the games as draggable nodes, the arrows
 * between them, and this graph's own name.
 *
 * A collection has several of these over the same games — the page renders
 * one at a time and keys it by graph id, so everything in here (the local
 * layout, the Arrange toggle, a half-drawn arrow) belongs to one graph and
 * resets when you switch tabs.
 *
 * It opens read-only. It used to be permanently editable, which meant the only
 * thing clicking a game could do was drag it — and a stray drag silently PUT a
 * new layout. Reading a play order is the common case; rearranging one is not.
 */
export function CollectionGraphView({
  collectionId,
  graph,
  games,
  isOwner,
  canDelete,
  showLatest,
  onShowLatest,
  onDeleted,
}: {
  collectionId: string;
  graph: CollectionGraph;
  games: CollectionNode[];
  isOwner: boolean;
  /** false for a collection's last graph, which the API won't delete */
  canDelete: boolean;
  /** held by the page so it carries from one graph tab to the next */
  showLatest: boolean;
  onShowLatest: (next: boolean) => void;
  onDeleted: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState(() => positionsOf(graph));
  const [links, setLinks] = useState<CollectionLink[]>(graph.links);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(graph.name);
  // whose versions card is open, and whether a click pinned it there
  const [card, setCard] = useState<{ gameId: string; pinned: boolean } | null>(null);

  const dragRef = useRef<{ gameId: string; offsetX: number; offsetY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dirtyRef = useRef(false);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const cardTimer = useRef<number | null>(null);

  // sync server → local when not mid-edit
  useEffect(() => {
    if (!dirtyRef.current) {
      setPositions(positionsOf(graph));
      setLinks(graph.links);
    }
  }, [graph]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["collection", collectionId] });

  const saveLayout = useMutation({
    mutationFn: (payload: { positions: Map<string, Point>; links: CollectionLink[] }) =>
      api.saveCollectionLayout(collectionId, graph.id, {
        nodes: games.map((g, i) => ({
          gameId: g.gameId,
          ...(payload.positions.get(g.gameId) ?? gridSlot(i)),
        })),
        links: payload.links.map((l) => ({
          fromGameId: l.fromGameId,
          toGameId: l.toGameId,
          label: l.label,
        })),
      }),
    onSuccess: () => {
      dirtyRef.current = false;
      invalidate();
    },
  });

  const removeGame = useMutation({
    mutationFn: (gameId: string) => api.removeCollectionGame(collectionId, gameId),
    onSuccess: () => {
      dirtyRef.current = false;
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const rename = useMutation({
    mutationFn: (name: string) => api.renameCollectionGraph(collectionId, graph.id, name),
    onSuccess: () => {
      setRenaming(false);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteCollectionGraph(collectionId, graph.id),
    onSuccess: () => {
      // leave the tab first: this component is about to have no graph to draw
      onDeleted();
      invalidate();
    },
  });

  // ---- the versions card ----

  function clearCardTimer() {
    if (cardTimer.current !== null) {
      window.clearTimeout(cardTimer.current);
      cardTimer.current = null;
    }
  }
  useEffect(() => clearCardTimer, []);

  // A short wait before opening, so sweeping the pointer across the graph
  // doesn't strobe cards; a slightly longer one before closing, so the pointer
  // can cross the gap between a node and its card. A pinned card ignores both.
  function hoverIn(gameId: string) {
    clearCardTimer();
    if (card?.pinned || card?.gameId === gameId) return;
    cardTimer.current = window.setTimeout(() => setCard({ gameId, pinned: false }), 150);
  }
  function hoverOut() {
    clearCardTimer();
    if (card?.pinned) return;
    cardTimer.current = window.setTimeout(() => setCard(null), 220);
  }
  /** Clicking the badge pins the card — the only way to open it without a mouse. */
  function togglePinned(gameId: string) {
    clearCardTimer();
    setCard(card?.pinned && card.gameId === gameId ? null : { gameId, pinned: true });
  }

  // ---- arranging ----

  function svgPoint(e: React.PointerEvent): Point {
    // the svg's own rect already moves with its scroll container
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onNodePointerDown(e: React.PointerEvent, node: CollectionNode & Point) {
    // in view mode a click opens the game; onClick handles it
    if (!canEdit) return;
    if (connectMode) {
      if (!connectFrom) {
        setConnectFrom(node.gameId);
      } else if (connectFrom !== node.gameId) {
        const exists = links.some(
          (l) => l.fromGameId === connectFrom && l.toGameId === node.gameId,
        );
        if (!exists) {
          const next = [
            ...links,
            { id: `local-${Date.now()}`, fromGameId: connectFrom, toGameId: node.gameId, label: null },
          ];
          setLinks(next);
          dirtyRef.current = true;
          saveLayout.mutate({ positions, links: next });
        }
        setConnectFrom(null);
      } else {
        setConnectFrom(null);
      }
      return;
    }
    const point = svgPoint(e);
    dragRef.current = { gameId: node.gameId, offsetX: point.x - node.x, offsetY: point.y - node.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = svgPoint(e);
    dirtyRef.current = true;
    setPositions((prev) =>
      new Map(prev).set(drag.gameId, {
        x: Math.max(0, Math.min(2000, point.x - drag.offsetX)),
        y: Math.max(0, Math.min(1400, point.y - drag.offsetY)),
      }),
    );
  }

  function onPointerUp() {
    if (dragRef.current) {
      dragRef.current = null;
      saveLayout.mutate({ positions, links });
    }
  }

  function deleteLink(linkId: string) {
    if (!confirm("Remove this connection?")) return;
    const next = links.filter((l) => l.id !== linkId);
    setLinks(next);
    dirtyRef.current = true;
    saveLayout.mutate({ positions, links: next });
  }

  /** Open a game: your copy when you own it, otherwise its catalog page. */
  function open(target: { gameId: string; userGameId: string | null }) {
    if (target.userGameId) navigate({ to: "/game/$id", params: { id: target.userGameId } });
    else navigate({ to: "/catalog/$gameId", params: { gameId: target.gameId } });
  }

  // someone else's published collection is always read-only, whatever the
  // Arrange toggle says
  const canEdit = isOwner && editing;
  const nodes = games.map((g, i) => ({ ...g, ...(positions.get(g.gameId) ?? gridSlot(i)) }));
  const nodeById = new Map(nodes.map((n) => [n.gameId, n]));
  const canvasW = Math.max(1000, ...nodes.map((n) => n.x + NODE_W + 60));
  const canvasH = Math.max(560, ...nodes.map((n) => n.y + NODE_H + 60));

  /**
   * The newer version a node shows in place of its own game, when "Show
   * latest versions" is on.
   *
   * Not while arranging — that edits the collection's real games, and a ✕
   * that removes "Resident Evil 4 (2005)" shouldn't be sitting on a picture of
   * the 2023 one. And not when the newer version already has a node of its
   * own here: a collection that lists both wants to show both, not the remake
   * twice.
   */
  function standInFor(node: CollectionNode): CollectionGameVersion | null {
    if (!node.latestVersionId || nodeById.has(node.latestVersionId)) return null;
    return node.versions.find((v) => v.gameId === node.latestVersionId) ?? null;
  }
  const withVersions = nodes.filter((n) => n.versions.length > 0).length;
  const swappable = nodes.filter((n) => standInFor(n)).length;
  const swapping = showLatest && !canEdit;

  const cardNode = card && !canEdit ? (nodeById.get(card.gameId) ?? null) : null;
  const button = "rounded-lg border px-3 py-1.5 text-sm font-medium";
  const idle = "border-zinc-700 text-zinc-300 hover:bg-zinc-800";
  const lit = "border-indigo-500 bg-indigo-600/20 text-indigo-200";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {isOwner && (
          <>
            <button
              onClick={() => {
                setEditing(!editing);
                setConnectMode(false);
                setConnectFrom(null);
                setCard(null);
              }}
              className={`${button} ${editing ? lit : idle}`}
            >
              {editing ? "✓ Done arranging" : "✎ Arrange"}
            </button>
            {editing && (
              <button
                onClick={() => {
                  setConnectMode(!connectMode);
                  setConnectFrom(null);
                }}
                className={`${button} ${connectMode ? lit : idle}`}
              >
                {connectMode
                  ? connectFrom
                    ? "Now click the game that comes AFTER"
                    : "Click the game that comes FIRST"
                  : "🔗 Connect games"}
              </button>
            )}
          </>
        )}

        {/* shown even when nothing is linked, disabled with the reason: a
            control that only appears once you've linked a remake can't teach
            you that linking one does anything here */}
        <button
          onClick={() => onShowLatest(!showLatest)}
          // paused while arranging: that edits the collection's own games, so
          // those are what the graph draws until you're done
          disabled={swappable === 0 || canEdit}
          aria-pressed={showLatest}
          title={
            canEdit
              ? "Paused while arranging — the graph shows the collection's own games"
              : swappable > 0
                ? "Swap each game for the most recent remake or remaster you've linked to it"
                : withVersions > 0
                  ? "Nothing to swap — each game here is already its newest version, or the newer one is on this graph too"
                  : "Link a remake or remaster on a game's Linked tab and it shows up here"
          }
          className={`${button} ${showLatest && swappable > 0 ? lit : idle} disabled:opacity-40 disabled:hover:bg-transparent`}
        >
          {showLatest && swappable > 0 ? "✓ " : ""}Show latest versions
          {swappable > 0 && <span className="ml-1.5 text-xs opacity-70">{swappable}</span>}
        </button>

        {isOwner && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {renaming ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const name = draftName.trim();
                  if (!name || name === graph.name) setRenaming(false);
                  else rename.mutate(name);
                }}
              >
                <input
                  autoFocus
                  value={draftName}
                  onChange={(ev) => setDraftName(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Escape") setRenaming(false);
                  }}
                  maxLength={COLLECTION_GRAPH_NAME_MAX}
                  aria-label="Graph name"
                  className="w-44 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={rename.isPending}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
                >
                  Save
                </button>
                <button type="button" onClick={() => setRenaming(false)} className={`${button} ${idle}`}>
                  Cancel
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setDraftName(graph.name);
                  rename.reset();
                  setRenaming(true);
                }}
                className={`${button} ${idle}`}
              >
                Rename
              </button>
            )}
            <button
              onClick={() => {
                if (
                  confirm(
                    `Delete the "${graph.name}" graph? Its layout and arrows go with it — the games stay in the collection.`,
                  )
                )
                  remove.mutate();
              }}
              disabled={!canDelete || remove.isPending}
              title={canDelete ? undefined : "A collection keeps at least one graph — rename this one instead"}
              className="rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Delete graph
            </button>
          </div>
        )}
      </div>

      {(rename.isError || remove.isError || saveLayout.isError) && (
        <p className="mb-3 text-sm text-red-400">
          {rename.isError
            ? rename.error.message
            : remove.isError
              ? remove.error.message
              : "Couldn't save the layout — your last change isn't stored yet."}
        </p>
      )}

      {games.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-12 text-center text-sm text-zinc-400">
          {isOwner
            ? 'Nothing to arrange yet — use "Add game" above, and every game you add lands on this graph.'
            : "The author hasn't added any games to this one yet."}
        </div>
      )}

      <div
        className={`overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950 ${
          games.length === 0 ? "hidden" : ""
        }`}
      >
        <svg
          ref={svgRef}
          width={canvasW}
          height={canvasH}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="block"
          style={{ touchAction: "none" }}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#818cf8" />
            </marker>
          </defs>

          {/* edges */}
          {links.map((link) => {
            const from = nodeById.get(link.fromGameId);
            const to = nodeById.get(link.toGameId);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y + NODE_H / 2;
            return (
              <g
                key={link.id}
                // only a hit target while arranging — otherwise brushing an
                // arrow on the way to a game would offer to delete it
                onClick={canEdit ? () => deleteLink(link.id) : undefined}
                className={canEdit ? "cursor-pointer" : undefined}
              >
                {canEdit && (
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
                )}
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#818cf8"
                  strokeWidth={2}
                  markerEnd="url(#arrow)"
                  opacity={0.8}
                />
              </g>
            );
          })}

          {/* nodes */}
          {nodes.map((node) => {
            const standIn = swapping ? standInFor(node) : null;
            // what the node draws: the collection's own game, or the newer
            // version standing in for it
            const shown = standIn ?? node;
            const hasVersions = node.versions.length > 0 && !canEdit;
            return (
              <g
                key={node.gameId}
                ref={(el) => {
                  if (el) nodeEls.current.set(node.gameId, el);
                  else nodeEls.current.delete(node.gameId);
                }}
                transform={`translate(${node.x}, ${node.y})`}
                onPointerDown={(e) => onNodePointerDown(e, node)}
                onPointerEnter={hasVersions ? () => hoverIn(node.gameId) : undefined}
                onPointerLeave={hasVersions ? hoverOut : undefined}
                // reading the graph, a click opens the game it's showing — your
                // copy if you own it, its catalog page if you don't
                onClick={canEdit ? undefined : () => open(shown)}
                role={canEdit ? undefined : "link"}
                className={
                  canEdit ? (connectMode ? "cursor-crosshair" : "cursor-grab") : "cursor-pointer"
                }
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="#18181b"
                  stroke={connectFrom === node.gameId ? "#818cf8" : statusRing(shown.status)}
                  strokeWidth={connectFrom === node.gameId ? 3 : 2}
                />
                {shown.coverSrc && (
                  <image
                    href={shown.coverSrc}
                    x={4}
                    y={4}
                    width={NODE_W - 8}
                    height={NODE_H - 26}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath="inset(0 round 5px)"
                    style={{ pointerEvents: "none" }}
                  />
                )}
                <text
                  x={NODE_W / 2}
                  y={NODE_H - 8}
                  textAnchor="middle"
                  fill="#d4d4d8"
                  fontSize={9}
                  style={{ pointerEvents: "none" }}
                >
                  {shown.title.length > 16 ? `${shown.title.slice(0, 15)}…` : shown.title}
                </text>
                {/* a game you don't own — clicking opens it anyway */}
                {!shown.userGameId && (
                  <circle cx={10} cy={10} r={5} fill="#3f3f46" style={{ pointerEvents: "none" }}>
                    <title>Not in your library</title>
                  </circle>
                )}
                {/* "there are other versions of this": two stacked sheets and
                    how many. Filled in when the node is showing one of them. */}
                {hasVersions && (
                  <g
                    transform={`translate(${NODE_W - 32}, 5)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePinned(node.gameId);
                    }}
                  >
                    <title>
                      {standIn
                        ? `Showing the latest version — this collection lists ${node.title}`
                        : `${node.versions.length} other version${node.versions.length === 1 ? "" : "s"} linked`}
                    </title>
                    <rect
                      width={27}
                      height={15}
                      rx={7.5}
                      fill={standIn ? "#6366f1" : "#1e1b4b"}
                      stroke="#818cf8"
                    />
                    <rect
                      x={5}
                      y={3}
                      width={6}
                      height={6}
                      rx={1}
                      fill="none"
                      stroke={standIn ? "#ffffff" : "#a5b4fc"}
                    />
                    <rect
                      x={7.5}
                      y={5.5}
                      width={6}
                      height={6}
                      rx={1}
                      fill={standIn ? "#6366f1" : "#1e1b4b"}
                      stroke={standIn ? "#ffffff" : "#a5b4fc"}
                    />
                    <text
                      x={20}
                      y={11}
                      textAnchor="middle"
                      fill={standIn ? "#ffffff" : "#c7d2fe"}
                      fontSize={8.5}
                      fontWeight={600}
                    >
                      {node.versions.length}
                    </text>
                  </g>
                )}
                {canEdit && (
                  <g
                    transform={`translate(${NODE_W - 16}, 4)`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remove "${node.title}" from this collection?`))
                        removeGame.mutate(node.gameId);
                    }}
                    className="cursor-pointer"
                  >
                    <rect width={12} height={12} rx={3} fill="#3f3f46" />
                    <text x={6} y={9.5} textAnchor="middle" fill="#d4d4d8" fontSize={9}>
                      ×
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {cardNode && cardNode.versions.length > 0 && (
        <VersionsCard
          // a new card per node, so it's measured and placed from scratch
          key={cardNode.gameId}
          anchor={nodeEls.current.get(cardNode.gameId) ?? null}
          node={cardNode}
          pinned={card?.pinned ?? false}
          onEnter={clearCardTimer}
          onLeave={hoverOut}
          onClose={() => setCard(null)}
        />
      )}

      <p className={`mt-3 text-xs text-zinc-500 ${games.length === 0 ? "hidden" : ""}`}>
        {canEdit
          ? `Drag boxes to arrange · "Connect games" then click two games to draw an arrow ·
             click an arrow to remove it · ring color = your status`
          : "Click a game to open it · ring color = your status" +
            (withVersions > 0 ? " · hover a numbered badge for a game's other versions" : "") +
            (isOwner ? ' · "Arrange" to move things around' : "")}
      </p>
    </div>
  );
}

const RELATION_HEADINGS: Array<{ relation: CollectionGameVersion["relation"]; heading: string }> = [
  { relation: "original", heading: "Original" },
  { relation: "remake", heading: "Remakes & remasters" },
  { relation: "sibling", heading: "Other versions" },
];

/**
 * The other versions of one game on the graph — what it remakes, what remakes
 * it — each a link to that game.
 *
 * These come from the links you made on the game's Linked tab, so the card
 * ends with a way back there: it's the only place a wrong one can be fixed.
 */
function VersionsCard({
  anchor,
  node,
  pinned,
  onEnter,
  onLeave,
  onClose,
}: {
  anchor: SVGGElement | null;
  node: CollectionNode;
  pinned: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const prefs = usePreferences();
  const categories = useCategories();
  const ref = useRef<HTMLDivElement>(null);
  const style = useBesideStyle(anchor, ref);

  // a pinned card has no pointer-leave to close it, so a click anywhere else
  // or Escape does
  useEffect(() => {
    if (!pinned) return;
    function onDown(ev: MouseEvent) {
      const target = ev.target as Node;
      if (!ref.current?.contains(target) && !anchor?.contains(target)) onClose();
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
  }, [pinned, anchor, onClose]);

  const year = node.releaseDate?.slice(0, 4);

  return (
    <div
      ref={ref}
      style={style}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      className="z-40 w-72 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-xl"
    >
      <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        Other versions of
      </p>
      <p className="text-sm font-semibold text-zinc-100">
        {node.title}
        {year && <span className="ml-1.5 font-normal text-zinc-500">{year}</span>}
      </p>

      {RELATION_HEADINGS.map(({ relation, heading }) => {
        const rows = node.versions.filter((v) => v.relation === relation);
        if (rows.length === 0) return null;
        return (
          <div key={relation} className="mt-3">
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              {heading}
            </p>
            <ul className="space-y-1">
              {rows.map((version) => {
                const chip = version.status ? statusChip(version.status, prefs, categories) : null;
                const body = (
                  <>
                    <div className="h-12 w-9 flex-none overflow-hidden rounded bg-zinc-800">
                      {version.coverSrc && (
                        <img src={version.coverSrc} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* two lines rather than an ellipsis: a remaster is
                          usually named for the game it remasters, and
                          truncating makes them the same row */}
                      <p className="line-clamp-2 text-sm leading-snug text-zinc-200">
                        {version.title}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                        {version.releaseDate && <span>{version.releaseDate.slice(0, 4)}</span>}
                        {version.gameId === node.latestVersionId && (
                          <span className="rounded-full bg-indigo-600/30 px-1.5 text-indigo-200">
                            Latest
                          </span>
                        )}
                        {chip ? (
                          <span className={`${chip.className} rounded-full px-1.5`} style={chip.style}>
                            {statusLabel(version.status!, categories)}
                          </span>
                        ) : (
                          <span className="rounded-full border border-dashed border-zinc-700 px-1.5">
                            Not in your library
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                );
                const rowClass =
                  "flex items-center gap-2.5 rounded-lg p-1.5 transition hover:bg-zinc-800";
                return (
                  <li key={version.gameId}>
                    {version.userGameId ? (
                      <Link to="/game/$id" params={{ id: version.userGameId }} className={rowClass}>
                        {body}
                      </Link>
                    ) : (
                      <Link
                        to="/catalog/$gameId"
                        params={{ gameId: version.gameId }}
                        className={rowClass}
                      >
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <div className="mt-3 border-t border-zinc-800 pt-2 text-xs">
        {node.userGameId ? (
          <Link
            to="/game/$id"
            params={{ id: node.userGameId }}
            search={{ tab: "linked" }}
            className="font-medium text-indigo-400 hover:text-indigo-300"
          >
            Edit this game's links →
          </Link>
        ) : (
          <Link
            to="/catalog/$gameId"
            params={{ gameId: node.gameId }}
            search={{ tab: "linked" }}
            className="font-medium text-indigo-400 hover:text-indigo-300"
          >
            Edit this game's links →
          </Link>
        )}
      </div>
    </div>
  );
}

const CARD_GAP = 8;
const CARD_MARGIN = 8;

/**
 * Pin a card beside a node, in viewport coordinates.
 *
 * Fixed rather than absolute for the same reason the library's quick-actions
 * panel is: the graph sits in a scrolling box, and a card positioned inside it
 * would be clipped at the box's edge — exactly where the outermost nodes are.
 * It opens to the node's right, flips to the left when the window runs out,
 * and follows the node as either the page or the graph scrolls.
 */
function useBesideStyle(
  anchor: SVGGElement | null,
  panelRef: React.RefObject<HTMLDivElement | null>,
): CSSProperties {
  const [placement, setPlacement] = useState<CSSProperties>({
    position: "fixed",
    // nothing measured yet: render invisibly so there's a size to place by
    visibility: "hidden",
    top: 0,
    left: 0,
  });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    function place() {
      if (!anchor || !panel) return;
      const box = anchor.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const maxLeft = Math.max(CARD_MARGIN, window.innerWidth - width - CARD_MARGIN);
      const maxTop = Math.max(CARD_MARGIN, window.innerHeight - height - CARD_MARGIN);

      const right = box.right + CARD_GAP;
      const left = right + width > window.innerWidth - CARD_MARGIN ? box.left - width - CARD_GAP : right;
      setPlacement({
        position: "fixed",
        left: Math.min(Math.max(left, CARD_MARGIN), maxLeft),
        top: Math.min(Math.max(box.top, CARD_MARGIN), maxTop),
        maxHeight: window.innerHeight - CARD_MARGIN * 2,
        visibility: "visible",
      });
    }

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, panelRef]);

  return placement;
}
