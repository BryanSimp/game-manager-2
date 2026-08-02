import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
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
import { resolveImage, statusStyle } from "@/lib/ui";
import { useBadgeOpacity } from "@/lib/prefs";
import { colors, radius, space, type } from "@/lib/theme";
import {
  Badge,
  Button,
  Cover,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Loading,
  Screen,
  Sheet,
  SheetSection,
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

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
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

  if (collection.isLoading || !collection.data) return <Loading />;

  const detail = collection.data;
  const ordered = orderNodes(detail);
  const inCollection = new Set(detail.games.map((g) => g.gameId));
  const accent = detail.accentColor ?? colors.accent;

  return (
    <Screen>
      <FlatList
        data={ordered}
        keyExtractor={(g) => g.gameId}
        contentContainerStyle={{ padding: space.md, paddingBottom: 96 + insets.bottom }}
        ListHeaderComponent={
          <View style={{ marginBottom: space.sm, gap: space.sm }}>
            {detail.description ? <Text style={type.prose}>{detail.description}</Text> : null}
            {detail.links.length > 0 && (
              <View style={styles.orderNote}>
                <Icon name="git-branch-outline" size={13} color={colors.textFaint} />
                <Text style={type.micro}>Listed in play order</Text>
              </View>
            )}
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
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="albums-outline"
            title="No games here yet"
            text="Tap + to pull games in from your library."
          />
        }
        renderItem={({ item, index }) => {
          const status = item.status ? statusStyle(item.status, badgeOpacity) : null;
          return (
            <View style={styles.row}>
              <Text style={[type.label, styles.orderNum, { color: accent }]}>{index + 1}</Text>
              <Cover src={resolveImage(item.coverSrc)} width={40} height={53} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={type.bodyStrong} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={{ marginTop: 5 }}>
                  {status ? (
                    <Badge label={status.label} bg={status.bg} fg={status.text} />
                  ) : (
                    <Text style={type.micro}>Not in library</Text>
                  )}
                </View>
              </View>
              <IconButton
                name="close"
                accessibilityLabel={`Remove ${item.title} from this collection`}
                onPress={() =>
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
            </View>
          );
        }}
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
  orderNote: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: space.xs },
  headerRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  headerBtn: { minHeight: 38, paddingHorizontal: space.md },
  copiedTag: { flexDirection: "row", alignItems: "center", gap: 4 },
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
