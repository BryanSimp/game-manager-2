import { Redirect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { LibraryEntry } from "@gm/shared";
import { authClient } from "@/lib/auth";
import { api } from "@/lib/api";
import { resolveImage, STATUS_COLORS } from "@/lib/ui";

export default function LibraryScreen() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const library = useQuery({
    queryKey: ["library"],
    queryFn: () => api.getLibrary(),
    enabled: !!session,
  });

  if (isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;

  return (
    <View style={styles.screen}>
      <FlatList
        data={library.data ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={library.isRefetching} onRefresh={() => library.refetch()} />
        }
        contentContainerStyle={{ padding: 12, paddingBottom: 96 }}
        ListEmptyComponent={
          library.isLoading ? (
            <ActivityIndicator style={{ marginTop: 48 }} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Your library is empty</Text>
              <Text style={styles.emptyText}>Tap + to add your first game.</Text>
            </View>
          )
        }
        renderItem={({ item }) => <LibraryRow entry={item} onPress={() => router.push(`/game/${item.id}`)} />}
      />
      <TouchableOpacity style={styles.fab} onPress={() => router.push("/add")}>
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </View>
  );
}

function LibraryRow({ entry, onPress }: { entry: LibraryEntry; onPress: () => void }) {
  const status = STATUS_COLORS[entry.status];
  const cover = resolveImage(entry.game.coverSrc);
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.cover}>
        {cover && <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title} numberOfLines={1}>
          {entry.game.title}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: status.bg }]}>
            <Text style={[styles.badgeText, { color: status.text }]}>{status.label}</Text>
          </View>
          {entry.rating != null && <Text style={styles.rating}>★ {entry.rating}</Text>}
        </View>
        {entry.platforms.length > 0 && (
          <Text style={styles.platforms} numberOfLines={1}>
            {entry.platforms.map((p) => p.abbreviation ?? p.name).join(" · ")}
          </Text>
        )}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#101014" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 10,
    marginBottom: 8,
  },
  cover: {
    width: 48,
    height: 64,
    borderRadius: 6,
    backgroundColor: "#27272a",
    overflow: "hidden",
  },
  title: { color: "#fafafa", fontSize: 15, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  rating: { color: "#fbbf24", fontSize: 12 },
  platforms: { color: "#71717a", fontSize: 11, marginTop: 3 },
  chevron: { color: "#52525b", fontSize: 24, paddingLeft: 4 },
  empty: { alignItems: "center", marginTop: 64 },
  emptyTitle: { color: "#fafafa", fontSize: 16, fontWeight: "600" },
  emptyText: { color: "#71717a", fontSize: 13, marginTop: 4 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#4f46e5",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },
  fabText: { color: "#fff", fontSize: 28, lineHeight: 32 },
});
