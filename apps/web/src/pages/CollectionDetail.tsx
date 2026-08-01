import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BUILTIN_CATEGORIES, type CollectionLink, type CollectionNode } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";

const NODE_W = 92;
const NODE_H = 122;

/** Ring colour for a node's category; unknown/custom keys get a neutral grey. */
function statusRing(status: string | null): string {
  if (!status) return "#3f3f46";
  return BUILTIN_CATEGORIES.find((c) => c.key === status)?.color ?? "#71717a";
}

interface LocalNode extends CollectionNode {}

export function CollectionDetailPage() {
  const { id } = useParams({ from: "/collection/$id" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const collection = useQuery({ queryKey: ["collection", id], queryFn: () => api.getCollection(id) });
  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary() });

  const [nodes, setNodes] = useState<LocalNode[]>([]);
  const [links, setLinks] = useState<CollectionLink[]>([]);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const dragRef = useRef<{ gameId: string; offsetX: number; offsetY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dirtyRef = useRef(false);

  // sync server → local when not mid-edit
  useEffect(() => {
    if (collection.data && !dirtyRef.current) {
      setNodes(collection.data.games);
      setLinks(collection.data.links);
    }
  }, [collection.data]);

  const saveLayout = useMutation({
    mutationFn: (payload: { nodes: LocalNode[]; links: CollectionLink[] }) =>
      api.saveCollectionLayout(id, {
        nodes: payload.nodes.map((n) => ({ gameId: n.gameId, x: n.x, y: n.y })),
        links: payload.links.map((l) => ({
          fromGameId: l.fromGameId,
          toGameId: l.toGameId,
          label: l.label,
        })),
      }),
    onSuccess: () => {
      dirtyRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["collection", id] });
    },
  });

  const addGame = useMutation({
    mutationFn: (gameId: string) => api.addCollectionGame(id, gameId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", id] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const removeGame = useMutation({
    mutationFn: (gameId: string) => api.removeCollectionGame(id, gameId),
    onSuccess: () => {
      dirtyRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["collection", id] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const deleteCollection = useMutation({
    mutationFn: () => api.deleteCollection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      navigate({ to: "/collections" });
    },
  });

  function svgPoint(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left + svg.parentElement!.scrollLeft, y: e.clientY - rect.top };
  }

  function onNodePointerDown(e: React.PointerEvent, node: LocalNode) {
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
          saveLayout.mutate({ nodes, links: next });
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
    setNodes((prev) =>
      prev.map((n) =>
        n.gameId === drag.gameId
          ? {
              ...n,
              x: Math.max(0, Math.min(2000, point.x - drag.offsetX)),
              y: Math.max(0, Math.min(1400, point.y - drag.offsetY)),
            }
          : n,
      ),
    );
  }

  function onPointerUp() {
    if (dragRef.current) {
      dragRef.current = null;
      saveLayout.mutate({ nodes, links });
    }
  }

  function deleteLink(linkId: string) {
    if (!confirm("Remove this connection?")) return;
    const next = links.filter((l) => l.id !== linkId);
    setLinks(next);
    dirtyRef.current = true;
    saveLayout.mutate({ nodes, links: next });
  }

  if (collection.isLoading) {
    return (
      <Shell>
        <p className="text-zinc-500">Loading…</p>
      </Shell>
    );
  }
  if (!collection.data) {
    return (
      <Shell>
        <p className="text-red-400">Collection not found.</p>
      </Shell>
    );
  }

  const inCollection = new Set(nodes.map((n) => n.gameId));
  const addable = (library.data ?? []).filter((e) => !inCollection.has(e.game.id));
  const nodeById = new Map(nodes.map((n) => [n.gameId, n]));
  const canvasW = Math.max(1000, ...nodes.map((n) => n.x + NODE_W + 60));
  const canvasH = Math.max(560, ...nodes.map((n) => n.y + NODE_H + 60));

  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-bold">{collection.data.name}</h1>
        <select
          onChange={(e) => {
            if (e.target.value) addGame.mutate(e.target.value);
            e.target.value = "";
          }}
          defaultValue=""
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
        >
          <option value="" disabled>
            ＋ Add game from library…
          </option>
          {addable.map((e) => (
            <option key={e.game.id} value={e.game.id}>
              {e.game.title}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setConnectMode(!connectMode);
            setConnectFrom(null);
          }}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
            connectMode
              ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
              : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          {connectMode
            ? connectFrom
              ? "Now click the game that comes AFTER"
              : "Click the game that comes FIRST"
            : "🔗 Connect play order"}
        </button>
        <button
          onClick={() => {
            if (confirm(`Delete collection "${collection.data!.name}"? Games stay in your library.`))
              deleteCollection.mutate();
          }}
          className="rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950"
        >
          Delete
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-12 text-center">
          <p className="mb-2 text-lg font-semibold">No games yet</p>
          <p className="text-sm text-zinc-400">
            Add games from your library above, drag them into an order, then use "Connect play
            order" to draw the path.
          </p>
        </div>
      ) : (
        <div className="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950">
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
                <g key={link.id} onClick={() => deleteLink(link.id)} className="cursor-pointer">
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
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
            {nodes.map((node) => (
              <g
                key={node.gameId}
                transform={`translate(${node.x}, ${node.y})`}
                onPointerDown={(e) => onNodePointerDown(e, node)}
                className={connectMode ? "cursor-crosshair" : "cursor-grab"}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="#18181b"
                  stroke={
                    connectFrom === node.gameId ? "#818cf8" : statusRing(node.status)
                  }
                  strokeWidth={connectFrom === node.gameId ? 3 : 2}
                />
                {node.coverSrc && (
                  <image
                    href={node.coverSrc}
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
                  {node.title.length > 16 ? `${node.title.slice(0, 15)}…` : node.title}
                </text>
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
              </g>
            ))}
          </svg>
        </div>
      )}

      <p className="mt-3 text-xs text-zinc-500">
        Drag boxes to arrange · "Connect play order" then click two games to draw an arrow · click
        an arrow to remove it · ring color = your status
      </p>
    </Shell>
  );
}
