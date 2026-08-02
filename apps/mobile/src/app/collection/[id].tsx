import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectionNode } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage, statusStyle } from "@/lib/ui";
import { useBadgeOpacity } from "@/lib/prefs";
import { colors, radius, space, type } from "@/lib/theme";
import {
  Badge,
  Cover,
  EmptyState,
  Icon,
  IconButton,
  Loading,
  Screen,
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
  const library = useQuery({
    queryKey: ["library"],
    queryFn: () => api.getLibrary(),
    enabled: picking,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["collection", id] });
    queryClient.invalidateQueries({ queryKey: ["collections"] });
  };
  const addGame = useMutation({
    mutationFn: (gameId: string) => api.addCollectionGame(id, gameId),
    onSuccess: invalidate,
  });
  const removeGame = useMutation({
    mutationFn: (gameId: string) => api.removeCollectionGame(id, gameId),
    onSuccess: invalidate,
  });

  if (collection.isLoading || !collection.data) return <Loading />;

  const detail = collection.data;
  const ordered = orderNodes(detail);
  const inCollection = new Set(detail.games.map((g) => g.gameId));
  const accent = detail.accentColor ?? colors.accent;
  const candidates = (library.data ?? []).filter((e) => !inCollection.has(e.game.id));

  return (
    <Screen>
      <FlatList
        data={ordered}
        keyExtractor={(g) => g.gameId}
        contentContainerStyle={{ padding: space.md, paddingBottom: 96 + insets.bottom }}
        ListHeaderComponent={
          detail.description || detail.links.length > 0 ? (
            <View style={{ marginBottom: space.sm }}>
              {detail.description ? <Text style={type.prose}>{detail.description}</Text> : null}
              {detail.links.length > 0 && (
                <View style={styles.orderNote}>
                  <Icon name="git-branch-outline" size={13} color={colors.textFaint} />
                  <Text style={type.micro}>Listed in play order</Text>
                </View>
              )}
            </View>
          ) : null
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

      {picking && (
        <View style={[styles.pickerSheet, { paddingBottom: space.lg + insets.bottom }]}>
          <View style={styles.pickerHeader}>
            <Text style={type.heading}>Add from library</Text>
            <IconButton name="close" accessibilityLabel="Close" onPress={() => setPicking(false)} />
          </View>
          {library.isLoading ? (
            <Loading />
          ) : (
            <FlatList
              data={candidates}
              keyExtractor={(e) => e.id}
              style={{ maxHeight: 320 }}
              ListEmptyComponent={
                <Text style={type.caption}>Everything in your library is already here.</Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.pickRow, pressed && { opacity: 0.7 }]}
                  disabled={addGame.isPending}
                  onPress={() => addGame.mutate(item.game.id)}
                >
                  <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>
                    {item.game.title}
                  </Text>
                  <Icon name="add-circle-outline" size={20} color={accent} />
                </Pressable>
              )}
            />
          )}
        </View>
      )}

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

const styles = StyleSheet.create({
  orderNote: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: space.xs },
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
  pickerSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: space.sm,
  },
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
