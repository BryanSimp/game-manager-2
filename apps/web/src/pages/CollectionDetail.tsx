import { useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COLLECTION_GRAPH_NAME_MAX,
  COLLECTION_NAME_MAX,
  MAX_COLLECTION_GRAPHS,
  type CollectionGraph,
} from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { AddCollectionGame } from "../components/AddCollectionGame.js";
import { CollectionGraphView } from "../components/CollectionGraph.js";
import { CollectionList } from "../components/CollectionList.js";
import { CollectionTimePanel } from "../components/CollectionTime.js";
import { MissingGamesBar } from "../components/MissingGamesBar.js";
import { usePreferences } from "../lib/prefs.js";

export function CollectionDetailPage() {
  const { id } = useParams({ from: "/collection/$id" });
  const { graph: graphParam } = useSearch({ from: "/collection/$id" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const collection = useQuery({ queryKey: ["collection", id], queryFn: () => api.getCollection(id) });
  const prefs = usePreferences();
  // "Never publish" hides the control rather than grey it out; the API
  // refuses a publish under that mode too, so this isn't the only guard. An
  // already-published collection keeps its button, so unpublishing is always
  // reachable.
  const canPublish = (prefs?.publishMode ?? "manual") !== "never";

  /**
   * Which view is open: the list, or one of the graphs.
   *
   * In the URL rather than in state, like a game page's tab: you leave a graph
   * by clicking a game on it, and Back should land on the graph you were
   * reading rather than on the list. No `?graph=` means the list — a numbered
   * run is what most people open a collection for, and the graphs are the
   * specialist views, for orders that branch.
   */
  function openTab(graphId: string | null) {
    navigate({
      to: "/collection/$id",
      params: { id },
      search: graphId ? { graph: graphId } : {},
      replace: true,
      resetScroll: false,
    });
  }

  // picking which of the games you don't own to add — see MissingGamesBar
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // held here, not in the graph, so it carries from one graph tab to the next
  const [showLatest, setShowLatest] = useState(false);
  const [addingGraph, setAddingGraph] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");

  const rename = useMutation({
    mutationFn: (name: string) => api.updateCollection(id, { name }),
    onSuccess: () => {
      setRenaming(false);
      // the name is quoted on your collection cards, in every game's
      // add-to-collection picker and — once published — on the browse list
      queryClient.invalidateQueries({ queryKey: ["collection", id] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["public-collections"] });
    },
  });

  const setPublic = useMutation({
    mutationFn: (isPublic: boolean) => api.updateCollection(id, { isPublic }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", id] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["public-collections"] });
    },
  });

  const deleteCollection = useMutation({
    mutationFn: () => api.deleteCollection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      navigate({ to: "/collections" });
    },
  });

  const adopt = useMutation({
    mutationFn: () => api.adoptCollection(id),
    onSuccess: (copy) => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      navigate({ to: "/collection/$id", params: { id: copy.id } });
    },
  });

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

  const isOwner = collection.data.isOwner;
  const games = collection.data.games;
  const graphs = collection.data.graphs;
  const inCollection = new Set(games.map((g) => g.gameId));
  // a `?graph=` that no longer exists (deleted, or a stale link) is the list
  const activeGraph = graphs.find((g) => g.id === graphParam) ?? null;

  const tabClass = (active: boolean) =>
    `-mb-px flex-none border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition ${
      active
        ? "border-indigo-500 text-indigo-300"
        : "border-transparent text-zinc-500 hover:text-zinc-300"
    }`;

  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {renaming ? (
          // the title becomes its own field, in place — the same rename a
          // graph gets in its toolbar, so the two read as one gesture
          <form
            className="mr-auto flex flex-wrap items-center gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              const name = draftName.trim();
              // blank or unchanged is "never mind", not an error
              if (!name || name === collection.data!.name) setRenaming(false);
              else rename.mutate(name);
            }}
          >
            <input
              autoFocus
              value={draftName}
              onChange={(ev) => setDraftName(ev.target.value)}
              // most renames replace the whole name, so start with it selected
              onFocus={(ev) => ev.target.select()}
              onKeyDown={(ev) => {
                if (ev.key === "Escape") setRenaming(false);
              }}
              maxLength={COLLECTION_NAME_MAX}
              aria-label="Collection name"
              className="w-80 max-w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-lg font-semibold outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={rename.isPending}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              {rename.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </form>
        ) : (
          <h1 className="mr-auto flex items-center gap-2 text-xl font-bold">
            {collection.data.isPublic && (
              <span className="text-amber-400" title="Published — anyone can browse and copy this">
                ★
              </span>
            )}
            {collection.data.name}
            {collection.data.adoptedFromId && (
              <span
                className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs font-normal text-zinc-500"
                title="Your own copy — edits here don't affect the original"
              >
                copied
              </span>
            )}
            {!isOwner && collection.data.authorName && (
              <span className="text-sm font-normal text-zinc-500">
                by {collection.data.authorName}
              </span>
            )}
          </h1>
        )}

        {isOwner ? (
          <>
            <AddCollectionGame collectionId={id} excludeGameIds={inCollection} />
            {/* A labelled button in the row with the others. It started as a
                grey pencil beside the title, which was tidy and which nobody
                could find — a control has to say what it does. The graph's own
                rename is labelled "Rename graph" so the two can't be mixed up. */}
            {!renaming && (
              <button
                onClick={() => {
                  setDraftName(collection.data!.name);
                  rename.reset();
                  setRenaming(true);
                }}
                title="Rename this collection"
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
              >
                ✎ Rename
              </button>
            )}
            {(canPublish || collection.data.isPublic) && (
              <button
                onClick={() => setPublic.mutate(!collection.data!.isPublic)}
                disabled={setPublic.isPending}
                title={
                  collection.data.isPublic
                    ? "Unpublish — existing copies people made stay theirs"
                    : "Publish so anyone can browse and copy it"
                }
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                  collection.data.isPublic
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-300"
                    : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {collection.data.isPublic ? "★ Published" : "☆ Publish"}
              </button>
            )}
            <button
              onClick={() => {
                if (
                  confirm(`Delete collection "${collection.data!.name}"? Games stay in your library.`)
                )
                  deleteCollection.mutate();
              }}
              className="rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950"
            >
              Delete
            </button>
          </>
        ) : (
          <button
            onClick={() => adopt.mutate()}
            disabled={adopt.isPending}
            title="Takes a private copy you can edit — the original is untouched"
            className="rounded-lg border border-indigo-500/50 px-3 py-1.5 text-sm font-semibold text-indigo-300 hover:bg-indigo-600/20 disabled:opacity-50"
          >
            Save a copy
          </button>
        )}
      </div>

      {/* a name you already use, or one the content filter won't take — the
          field stays open above so it can be fixed rather than retyped */}
      {renaming && rename.isError && (
        <p className="-mt-2 mb-4 text-sm text-red-400">{rename.error.message}</p>
      )}

      {/* games in here you haven't got: add all of them, or pick some. Yours
          or someone else's collection alike — a reading list you made is as
          likely to have gaps as one you're browsing */}
      <MissingGamesBar
        collectionId={id}
        games={games}
        selecting={selecting}
        selected={selected}
        onStartSelecting={() => {
          // the checkboxes live on the list — a graph has nothing to tick
          openTab(null);
          setSelected(new Set());
          setSelecting(true);
        }}
        onStopSelecting={() => {
          setSelecting(false);
          setSelected(new Set());
        }}
        onSelect={setSelected}
      />

      {/* The list, then a tab per graph. The list comes first because a
          numbered run is what most people open a collection for; each graph is
          its own arrangement of the same games — play order, timeline,
          release date — under whatever name you gave it. */}
      {/* wraps rather than scrolls: a scrolling row clips the active tab's
          underline where it overlaps this border */}
      <div className="mb-4 flex flex-wrap items-end gap-1 border-b border-zinc-800">
        <button onClick={() => openTab(null)} className={tabClass(!activeGraph)}>
          List
        </button>
        {graphs.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              openTab(g.id);
              // the graph has no checkboxes to choose with
              setSelecting(false);
              setSelected(new Set());
            }}
            className={tabClass(activeGraph?.id === g.id)}
          >
            {g.name}
          </button>
        ))}
        {isOwner && (
          <button
            onClick={() => setAddingGraph(!addingGraph)}
            disabled={graphs.length >= MAX_COLLECTION_GRAPHS}
            aria-expanded={addingGraph}
            title={
              graphs.length >= MAX_COLLECTION_GRAPHS
                ? `A collection can hold up to ${MAX_COLLECTION_GRAPHS} graphs`
                : "Another arrangement of these games — a timeline, release order, anything"
            }
            className="-mb-px flex-none border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-zinc-500 hover:text-indigo-300 disabled:opacity-40 disabled:hover:text-zinc-500"
          >
            ＋ New graph
          </button>
        )}
      </div>

      {addingGraph && isOwner && (
        <NewGraphForm
          collectionId={id}
          graphs={graphs}
          // offered as the thing to copy, since it's the one you're looking at
          current={activeGraph}
          onCancel={() => setAddingGraph(false)}
          onCreated={(graphId) => {
            setAddingGraph(false);
            setSelecting(false);
            setSelected(new Set());
            openTab(graphId);
          }}
        />
      )}

      {/* how long the run is, above every view — it's a fact about the
          collection, not about the way you're looking at it */}
      {games.length > 0 && <CollectionTimePanel time={collection.data.time} />}

      {/* an empty collection still opens its graphs: naming them "Timeline" and
          "Release date" before the first game goes in is a reasonable order
          to work in, and the graph draws its own "nothing here yet" */}
      {games.length === 0 && !activeGraph ? (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-12 text-center">
          <p className="mb-2 text-lg font-semibold">No games yet</p>
          <p className="text-sm text-zinc-400">
            {isOwner
              ? `Use "Add game" above — your library, or anything on IGDB you don't own yet — then
                 open a graph tab and hit Arrange to draw the path between them.`
              : "The author hasn't added any games to this one yet."}
          </p>
        </div>
      ) : activeGraph ? (
        <CollectionGraphView
          // one instance per graph: the local layout, the Arrange toggle and a
          // half-drawn arrow all belong to the graph they were started on
          key={activeGraph.id}
          collectionId={id}
          graph={activeGraph}
          games={games}
          isOwner={isOwner}
          canDelete={graphs.length > 1}
          showLatest={showLatest}
          onShowLatest={setShowLatest}
          onDeleted={() => {
            // the neighbouring graph, so deleting one doesn't throw you back
            // to the list
            const at = graphs.findIndex((g) => g.id === activeGraph.id);
            const next = graphs[at + 1] ?? graphs[at - 1] ?? null;
            openTab(next?.id ?? null);
          }}
        />
      ) : (
        <CollectionList
          collectionId={id}
          games={games}
          accent={collection.data.accentColor ?? "#818cf8"}
          readOnly={!isOwner}
          selecting={selecting}
          selected={selected}
          onToggleSelect={(gameId) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(gameId)) next.delete(gameId);
              else next.add(gameId);
              return next;
            })
          }
        />
      )}
    </Shell>
  );
}

/**
 * Name a new graph, and say what it starts as.
 *
 * "A fresh layout" is the default because it's the predictable one: every
 * game on a grid in list order, no arrows. Copying another graph brings its
 * layout *and* its arrows, which is the faster start when the new one is
 * mostly the old one — a timeline that only moves the prequels.
 */
function NewGraphForm({
  collectionId,
  graphs,
  current,
  onCancel,
  onCreated,
}: {
  collectionId: string;
  graphs: CollectionGraph[];
  current: CollectionGraph | null;
  onCancel: () => void;
  onCreated: (graphId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.createCollectionGraph(collectionId, {
        name: name.trim(),
        ...(copyFrom ? { copyFromGraphId: copyFrom } : {}),
      }),
    onSuccess: async (created) => {
      // wait for the collection to come back with the new graph in it before
      // switching — a tab pointing at a graph the page hasn't heard of yet
      // would read as "no such graph" and fall back to the list
      await queryClient.invalidateQueries({ queryKey: ["collection", collectionId] });
      onCreated(created.id);
    },
  });

  // the graph you're on first, since it's the likeliest one to want a copy of
  const sources = current ? [current, ...graphs.filter((g) => g.id !== current.id)] : graphs;

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        if (name.trim()) create.mutate();
      }}
      className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-zinc-500">
          Name
          <input
            autoFocus
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            maxLength={COLLECTION_GRAPH_NAME_MAX}
            placeholder="Timeline, Release date…"
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Start from
          <select
            value={copyFrom}
            onChange={(ev) => setCopyFrom(ev.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          >
            <option value="">A fresh layout</option>
            {sources.map((g) => (
              <option key={g.id} value={g.id}>
                A copy of “{g.name}”
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create graph"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
      {create.isError && <p className="mt-2 text-sm text-red-400">{create.error.message}</p>}
    </form>
  );
}
