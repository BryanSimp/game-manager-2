import { useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectionNode } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage, STATUS_COLORS, statusStyle } from "@/lib/ui";
import { useBadgeOpacity } from "@/lib/prefs";

/**
 * The web app has the full drag-node graph editor; on mobile we flatten the
 * play-order graph into a list: chain order when links exist (topological-ish
 * walk), layout order otherwise.
 */
function orderNodes(detail: { games: CollectionNode[]; links: { fromGameId: string; toGameId: string }[] }) {
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

  if (collection.isLoading || !collection.data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const detail = collection.data;
  const ordered = orderNodes(detail);
  const inCollection = new Set(detail.games.map((g) => g.gameId));
  const accent = detail.accentColor ?? "#4f46e5";
  const candidates = (library.data ?? []).filter((e) => !inCollection.has(e.game.id));

  return (
    <View style={styles.screen}>
      <FlatList
        data={ordered}
        keyExtractor={(g) => g.gameId}
        contentContainerStyle={{ padding: 12, paddingBottom: 96 }}
        ListHeaderComponent={
          <View style={{ marginBottom: 8 }}>
            {detail.description ? <Text style={styles.desc}>{detail.description}</Text> : null}
            {detail.links.length > 0 && (
              <Text style={styles.orderNote}>Listed in play order</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No games in this collection yet.</Text>
        }
        renderItem={({ item, index }) => {
          const cover = resolveImage(item.coverSrc);
          const status = item.status ? statusStyle(item.status, badgeOpacity) : null;
          return (
            <View style={styles.row}>
              <Text style={[styles.orderNum, { color: accent }]}>{index + 1}</Text>
              <View style={styles.cover}>
                {cover && (
                  <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                {status ? (
                  <View style={[styles.badge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.badgeText, { color: status.text }]}>{status.label}</Text>
                  </View>
                ) : (
                  <Text style={styles.notOwned}>Not in library</Text>
                )}
              </View>
              <TouchableOpacity
                hitSlop={8}
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
              >
                <Text style={styles.removeX}>✕</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      {picking && (
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Add from library</Text>
            <TouchableOpacity onPress={() => setPicking(false)} hitSlop={8}>
              <Text style={styles.removeX}>✕</Text>
            </TouchableOpacity>
          </View>
          {library.isLoading ? (
            <ActivityIndicator style={{ marginVertical: 24 }} />
          ) : (
            <FlatList
              data={candidates}
              keyExtractor={(e) => e.id}
              style={{ maxHeight: 320 }}
              ListEmptyComponent={
                <Text style={styles.empty}>Everything in your library is already here.</Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickRow}
                  disabled={addGame.isPending}
                  onPress={() => addGame.mutate(item.game.id)}
                >
                  <Text style={styles.pickTitle} numberOfLines={1}>
                    {item.game.title}
                  </Text>
                  <Text style={[styles.pickAdd, { color: accent }]}>Add</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      )}

      {!picking && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: accent }]}
          onPress={() => setPicking(true)}
        >
          <Text style={styles.fabText}>＋</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#101014" },
  desc: { color: "#a1a1aa", fontSize: 13, marginBottom: 4 },
  orderNote: { color: "#71717a", fontSize: 11 },
  empty: { color: "#71717a", fontSize: 13, textAlign: "center", marginTop: 32 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 10,
    marginBottom: 8,
  },
  orderNum: { fontSize: 13, fontWeight: "800", width: 22, textAlign: "center" },
  cover: { width: 40, height: 53, borderRadius: 5, backgroundColor: "#27272a", overflow: "hidden" },
  title: { color: "#fafafa", fontSize: 14, fontWeight: "600" },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  badgeText: { fontSize: 10, fontWeight: "600" },
  notOwned: { color: "#52525b", fontSize: 11, marginTop: 4 },
  removeX: { color: "#52525b", fontSize: 16, padding: 4 },
  pickerSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#18181b",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: "#27272a",
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  pickerTitle: { color: "#fafafa", fontSize: 15, fontWeight: "700" },
  pickRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#27272a",
    gap: 12,
  },
  pickTitle: { color: "#e4e4e7", fontSize: 14, flex: 1 },
  pickAdd: { fontWeight: "700", fontSize: 13 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },
  fabText: { color: "#fff", fontSize: 28, lineHeight: 32 },
});
