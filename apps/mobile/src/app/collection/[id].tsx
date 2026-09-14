import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AddCollectionGameInput, CollectionNode } from "@gm/shared";
import { api } from "@/lib/api";
import { formatHours, resolveImage, statusStyle } from "@/lib/ui";
import { useBadgeOpacity } from "@/lib/prefs";
import { colors, radius, space, type } from "@/lib/theme";
import {
  Badge,
  Button,
  Chevron,
  Chip,
  ChipBar,
  CollectionTimeLine,
  Cover,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Loading,
  Screen,
  Sheet,
  SheetSection,
  type IconName,
} from "@/components/ui";

/**
 * The web app has the full drag-node graph editor; on mobile we flatten the
 * play-order graph into a list: chain order when links exist (topological-ish
 * walk), layout order otherwise.
 */
function orderNodes(detail: {
  games: CollectionNode[];
  links: { fromGameId: string; toGameId: string }[];
}) {
  const { games, links } = detail;
  if (links.length === 0) {
    return [...games].sort((a, b) => a.y - b.y || a.x - b.x);
  }
  const hasIncoming = new Set(links.map((l) => l.toGameId));
  const next = new Map<string, string[]>();
  for (const l of links) {
    if (!next.has(l.fromGameId)) next.set(l.fromGameId, []);
    next.get(l.fromGameId)!.push(l.toGameId);
  }
  const byId = new Map(games.map((g) => [g.gameId, g]));
  const roots = games
    .filter((g) => !hasIncoming.has(g.gameId))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const ordered: CollectionNode[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId.get(id);
    if (node) ordered.push(node);
    for (const child of next.get(id) ?? []) walk(child);
  };
  for (const root of roots) walk(root.gameId);
  for (const g of games) if (!seen.has(g.gameId)) ordered.push(g);
  return ordered;
}

type ViewMode = "graph" | "list";
type ListSort = "custom" | "title" | "release" | "ttb";

// List first, and the default: a numbered run is what most people open a
// collection for. Play order is the specialist view, for orders that branch.
const VIEWS: Array<{ key: ViewMode; label: string; icon: IconName }> = [
  { key: "list", label: "List", icon: "list-outline" },
  { key: "graph", label: "Play order", icon: "git-branch-outline" },
];

const LIST_SORTS: Array<{ key: ListSort; label: string }> = [
  { key: "custom", label: "Custom order" },
  { key: "title", label: "Title" },
  { key: "release", label: "Release date" },
  { key: "ttb", label: "Time to beat" },
];

/**
 * Sort for the list view. Games missing the field a sort needs sink to the
 * bottom rather than jumbling into the middle — an unknown release date isn't
 * "the year 0".
 */
function sortNodes(games: CollectionNode[], sort: ListSort): CollectionNode[] {
  const byTitle = (a: CollectionNode, b: CollectionNode) => a.title.localeCompare(b.title);
  return [...games].sort((a, b) => {
    if (sort === "title") return byTitle(a, b);
    if (sort === "release") {
      if (!a.releaseDate && !b.releaseDate) return byTitle(a, b);
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return a.releaseDate.localeCompare(b.releaseDate) || byTitle(a, b);
    }
    if (sort === "ttb") {
      const av = a.ttbSeconds ?? a.ttbMain ?? Number.MAX_SAFE_INTEGER;
      const bv = b.ttbSeconds ?? b.ttbMain ?? Number.MAX_SAFE_INTEGER;
      return av - bv || byTitle(a, b);
    }
    return a.sortOrder - b.sortOrder || byTitle(a, b);
  });
}

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<ViewMode>("list");
  const [sort, setSort] = useState<ListSort>("custom");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CollectionNode[] | null>(null);
  const badgeOpacity = useBadgeOpacity();

  const collection = useQuery({
    queryKey: ["collection", id],
    queryFn: () => api.getCollection(id),
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["collection", id] });
    queryClient.invalidateQueries({ queryKey: ["collections"] });
  };
  const removeGame = useMutation({
    mutationFn: (gameId: string) => api.removeCollectionGame(id, gameId),
    onSuccess: invalidate,
  });
  const setPublic = useMutation({
    mutationFn: (isPublic: boolean) => api.updateCollection(id, { isPublic }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["public-collections"] });
    },
  });
  const saveOrder = useMutation({
    mutationFn: (ordered: CollectionNode[]) =>
      api.saveCollectionOrder(
        id,
        ordered.map((g) => g.gameId),
      ),
    onSuccess: () => {
      setEditing(false);
      setDraft(null);
      invalidate();
    },
  });

  function move(index: number, delta: number) {
    setDraft((prev) => {
      const next = [...(prev ?? [])];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  if (collection.isLoading || !collection.data) return <Loading />;

  const detail = collection.data;
  const inCollection = new Set(detail.games.map((g) => g.gameId));
  const accent = detail.accentColor ?? colors.accent;

  // the graph view walks the play-order links; the list view sorts the same
  // games by whatever you picked
  const rows =
    view === "graph"
      ? orderNodes(detail)
      : editing && draft
        ? draft
        : sortNodes(detail.games, sort);

  return (
    <Screen>
      <FlatList
        data={rows}
        keyExtractor={(g) => g.gameId}
        contentContainerStyle={{ padding: space.md, paddingBottom: 96 + insets.bottom }}
        ListHeaderComponent={
          <View style={{ marginBottom: space.sm, gap: space.sm }}>
            {detail.description ? <Text style={type.prose}>{detail.description}</Text> : null}

            <CollectionTimeLine time={detail.time} />

            <View style={styles.headerRow}>
              <Button
                label={detail.isPublic ? "Published" : "Publish"}
                icon={detail.isPublic ? "star" : "star-outline"}
                tone={detail.isPublic ? "primary" : "ghost"}
                busy={setPublic.isPending}
                onPress={() => setPublic.mutate(!detail.isPublic)}
                style={styles.headerBtn}
              />
              {detail.adoptedFromId && (
                <View style={styles.copiedTag}>
                  <Icon name="copy-outline" size={12} color={colors.textFaint} />
                  <Text style={type.micro}>Your copy</Text>
                </View>
              )}
            </View>

            {/* two ways to look at the same games: the graph's play order,
                or a numbered list you can sort and reorder */}
            <View style={styles.tabs}>
              {VIEWS.map((v) => (
                <Pressable
                  key={v.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: view === v.key }}
                  style={[styles.tab, view === v.key && { borderBottomColor: accent }]}
                  onPress={() => {
                    setView(v.key);
                    setEditing(false);
                    setDraft(null);
                  }}
                >
                  <Icon
                    name={v.icon}
                    size={14}
                    color={view === v.key ? colors.text : colors.textFaint}
                  />
                  <Text style={[type.label, view === v.key ? undefined : { color: colors.textFaint }]}>
                    {v.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {view === "graph" && detail.links.length > 0 && (
              <View style={styles.orderNote}>
                <Icon name="git-branch-outline" size={13} color={colors.textFaint} />
                <Text style={type.micro}>Following the play-order links</Text>
              </View>
            )}

            {view === "list" && (
              <>
                <ChipBar style={{ marginHorizontal: -space.md }}>
                  {LIST_SORTS.map((s) => (
                    <Chip
                      key={s.key}
                      label={s.label}
                      active={sort === s.key}
                      onPress={() => {
                        setSort(s.key);
                        if (s.key !== "custom") {
                          setEditing(false);
                          setDraft(null);
                        }
                      }}
                    />
                  ))}
                </ChipBar>
                {sort === "custom" && (
                  <View style={styles.headerRow}>
                    {editing ? (
                      <>
                        <Button
                          label="Save order"
                          icon="checkmark"
                          busy={saveOrder.isPending}
                          onPress={() => saveOrder.mutate(draft ?? sortNodes(detail.games, sort))}
                          style={styles.headerBtn}
                        />
                        <Button
                          label="Cancel"
                          tone="ghost"
                          onPress={() => {
                            setEditing(false);
                            setDraft(null);
                          }}
                          style={styles.headerBtn}
                        />
                      </>
                    ) : (
                      <Button
                        label="Edit order"
                        icon="swap-vertical"
                        tone="ghost"
                        onPress={() => {
                          setDraft(sortNodes(detail.games, "custom"));
                          setEditing(true);
                        }}
                        style={styles.headerBtn}
                      />
                    )}
                  </View>
                )}
                {editing && (
                  <Text style={type.micro}>
                    Use the arrows to set the order, then save. Rows don't open while editing.
                  </Text>
                )}
              </>
            )}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="albums-outline"
            title="No games here yet"
            text="Tap + to add games — yours, or ones you don't own."
          />
        }
        renderItem={({ item, index }) => (
          <CollectionRow
            game={item}
            index={index}
            accent={accent}
            badgeOpacity={badgeOpacity}
            editing={editing}
            isFirst={index === 0}
            isLast={index === rows.length - 1}
            onMove={(delta) => move(index, delta)}
            onOpen={() => {
              // owned → your copy of the game; not owned → the add screen,
              // which is where you'd go to get it
              if (item.userGameId) router.push(`/game/${item.userGameId}`);
              else router.push("/add");
            }}
            onRemove={() =>
              Alert.alert("Remove game", `Remove "${item.title}" from this collection?`, [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Remove",
                  style: "destructive",
                  onPress: () => removeGame.mutate(item.gameId),
                },
              ])
            }
          />
        )}
      />

      <AddGameSheet
        collectionId={id}
        excludeGameIds={inCollection}
        accent={accent}
        visible={picking}
        onClose={() => setPicking(false)}
        onAdded={invalidate}
      />

      {!picking && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a game to this collection"
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: accent, bottom: 24 + insets.bottom },
            pressed && { opacity: 0.85 },
          ]}
          onPress={() => setPicking(true)}
        >
          <Icon name="add" size={30} color="#ffffff" />
        </Pressable>
      )}
    </Screen>
  );
}

/**
 * One game in a collection. Tapping opens it while you're reading; while
 * you're editing the order it doesn't, because a mis-tap that navigates away
 * mid-reorder loses the whole draft.
 */
function CollectionRow({
  game,
  index,
  accent,
  badgeOpacity,
  editing,
  isFirst,
  isLast,
  onMove,
  onOpen,
  onRemove,
}: {
  game: CollectionNode;
  index: number;
  accent: string;
  badgeOpacity: number;
  editing: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: number) => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const status = game.status ? statusStyle(game.status, badgeOpacity) : null;
  const year = game.releaseDate ? game.releaseDate.slice(0, 4) : null;
  // what this game still costs you, not just what it costs: a beaten game is
  // no longer time you owe, and a part-ticked mission list is pro-rated
  const full = formatHours(game.ttbSeconds ?? game.ttbMain);
  const left = formatHours(game.remainingSeconds);
  const ttb = game.finished
    ? full && `✓ ${full}`
    : game.endless
      ? "∞ endless"
      : left && game.remainingSeconds !== game.ttbSeconds
        ? `${left} left of ${full}`
        : full;

  const body = (
    <>
      <Text style={[type.label, styles.orderNum, { color: accent }]}>{index + 1}</Text>
      <Cover src={resolveImage(game.coverSrc)} width={40} height={53} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type.bodyStrong} numberOfLines={2}>
          {game.title}
        </Text>
        <View style={styles.metaRow}>
          {status ? (
            <Badge label={status.label} bg={status.bg} fg={status.text} />
          ) : (
            <View style={styles.notOwned}>
              <Text style={type.micro}>Not in library</Text>
            </View>
          )}
          {year && <Text style={type.micro}>{year}</Text>}
          {ttb && (
            <View style={styles.metaItem}>
              <Icon name="time-outline" size={11} color={colors.textFaint} />
              <Text style={type.micro}>{ttb}</Text>
            </View>
          )}
        </View>
      </View>
    </>
  );

  if (editing) {
    return (
      <View style={styles.row}>
        {body}
        <View style={styles.moveButtons}>
          <IconButton
            name="chevron-up"
            accessibilityLabel={`Move ${game.title} up`}
            onPress={() => !isFirst && onMove(-1)}
            color={isFirst ? colors.border : colors.textMuted}
            size={16}
          />
          <IconButton
            name="chevron-down"
            accessibilityLabel={`Move ${game.title} down`}
            onPress={() => !isLast && onMove(1)}
            color={isLast ? colors.border : colors.textMuted}
            size={16}
          />
        </View>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={game.userGameId ? `Open ${game.title}` : `Add ${game.title}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.row, !game.userGameId && styles.rowGhost, pressed && { opacity: 0.7 }]}
    >
      {body}
      {game.userGameId ? (
        <Chevron />
      ) : (
        <Icon name="add-circle-outline" size={20} color={accent} />
      )}
      <IconButton
        name="close"
        accessibilityLabel={`Remove ${game.title} from this collection`}
        onPress={onRemove}
      />
    </Pressable>
  );
}

/**
 * Add a game by searching, not by scrolling a dropdown of everything you own —
 * and a collection isn't limited to your library, so IGDB results sit
 * underneath. Adding one of those pulls the game into the shared catalog but
 * deliberately not into your library.
 */
function AddGameSheet({
  collectionId,
  excludeGameIds,
  accent,
  visible,
  onClose,
  onAdded,
}: {
  collectionId: string;
  excludeGameIds: Set<string>;
  accent: string;
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const library = useQuery({
    queryKey: ["library"],
    queryFn: () => api.getLibrary(),
    enabled: visible,
  });
  const igdb = useQuery({
    queryKey: ["game-search", query],
    queryFn: () => api.searchGames(query),
    enabled: visible && query.length >= 2,
  });

  const add = useMutation({
    mutationFn: (input: AddCollectionGameInput) => api.addCollectionGame(collectionId, input),
    onSuccess: () => {
      setInput("");
      setQuery("");
      onAdded();
    },
  });

  const needle = query.toLowerCase();
  const mine = (library.data ?? [])
    .filter((e) => !excludeGameIds.has(e.game.id))
    .filter((e) => !needle || e.game.title.toLowerCase().includes(needle))
    .slice(0, 8);
  const mineTitles = new Set(mine.map((e) => e.game.title.toLowerCase()));
  const external = (igdb.data?.results ?? [])
    .filter((r) => !mineTitles.has(r.title.toLowerCase()))
    .filter((r) => !r.gameId || !excludeGameIds.has(r.gameId))
    .slice(0, 8);

  return (
    <Sheet visible={visible} title="Add a game" onClose={onClose}>
      <Field
        value={input}
        onChangeText={setInput}
        placeholder="Search your library or IGDB…"
        autoCapitalize="none"
        returnKeyType="search"
      />
      {add.isError && (
        <Text style={[type.caption, { color: colors.danger, marginTop: space.sm }]}>
          {add.error instanceof Error ? add.error.message : "Couldn't add that game"}
        </Text>
      )}

      {mine.length > 0 && <SheetSection label="In your library" />}
      {mine.map((e) => (
        <AddRow
          key={e.game.id}
          title={e.game.title}
          coverSrc={resolveImage(e.game.coverSrc)}
          accent={accent}
          busy={add.isPending}
          onPress={() => add.mutate({ gameId: e.game.id })}
        />
      ))}

      {query.length >= 2 && (
        <>
          <SheetSection label="From IGDB · this collection only" />
          {igdb.isLoading && <ActivityIndicator color={colors.accentBorder} />}
          {!igdb.isLoading && external.length === 0 && (
            <Text style={type.caption}>No other matches.</Text>
          )}
          {external.map((r) => (
            <AddRow
              key={`${r.igdbId ?? r.gameId ?? r.title}`}
              title={r.title}
              year={r.releaseYear}
              coverSrc={resolveImage(r.coverSrc)}
              accent={accent}
              busy={add.isPending}
              onPress={() => add.mutate(r.igdbId ? { igdbId: r.igdbId } : { gameId: r.gameId! })}
            />
          ))}
        </>
      )}

      {query.length < 2 && mine.length === 0 && (
        <Text style={[type.caption, { marginTop: space.sm }]}>
          Type to search. Games you don't own can be added too.
        </Text>
      )}
    </Sheet>
  );
}

function AddRow({
  title,
  year,
  coverSrc,
  accent,
  busy,
  onPress,
}: {
  title: string;
  year?: number | null;
  coverSrc: string | null;
  accent: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.pickRow, pressed && { opacity: 0.7 }]}
    >
      <Cover src={coverSrc} width={34} height={45} />
      <Text style={[type.body, { flex: 1 }]} numberOfLines={2}>
        {title}
        {year ? ` (${year})` : ""}
      </Text>
      <Icon name="add-circle-outline" size={20} color={accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  orderNote: { flexDirection: "row", alignItems: "center", gap: 5 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  headerBtn: { minHeight: 38, paddingHorizontal: space.md },
  copiedTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    flex: 1,
    minHeight: 40,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, marginTop: 5 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  notOwned: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  rowGhost: { borderStyle: "dashed" },
  moveButtons: { gap: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.sm + 2,
    marginBottom: space.sm,
  },
  orderNum: { width: 22, textAlign: "center" },
  pickRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fab: {
    position: "absolute",
    right: space.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
});
