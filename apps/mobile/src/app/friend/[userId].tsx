import { useMemo, useState } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import type { FriendLibraryEntry } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage, statusStyle } from "@/lib/ui";
import { useBadgeOpacity } from "@/lib/prefs";

type ViewMode = "all" | "common" | "theirs";

const VIEWS: Array<{ key: ViewMode; label: string }> = [
  { key: "all", label: "Everything" },
  { key: "common", label: "In common" },
  { key: "theirs", label: "Only theirs" },
];

/** A friend's library, with the overlap with yours called out. Notes are never sent. */
export default function FriendLibraryScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const insets = useSafeAreaInsets();
  const badgeOpacity = useBadgeOpacity();
  const [view, setView] = useState<ViewMode>("all");
  const [search, setSearch] = useState("");

  const library = useQuery({
    queryKey: ["friend-library", userId],
    queryFn: () => api.getFriendLibrary(userId),
  });

  const data = library.data;

  const entries = useMemo(() => {
    const all = data?.entries ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter((e) => {
      if (view === "common" && !e.inCommon) return false;
      if (view === "theirs" && e.inCommon) return false;
      if (needle && !e.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, view, search]);

  if (library.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (library.isError || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>You can't see this library</Text>
        <Text style={styles.emptyText}>You may no longer be friends.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: data.friend.name }} />

      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${data.friend.name}'s games…`}
          placeholderTextColor="#71717a"
          autoCapitalize="none"
        />
      </View>
      <Text style={styles.summary}>
        {data.total} games · <Text style={styles.common}>{data.inCommon}</Text> you both have
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, marginTop: 8 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}
      >
        {VIEWS.map((v) => (
          <TouchableOpacity
            key={v.key}
            style={[styles.chip, view === v.key && styles.chipActive]}
            onPress={() => setView(v.key)}
          >
            <Text style={[styles.chipText, view === v.key && styles.chipTextActive]}>
              {v.label}
              {v.key === "common" && ` (${data.inCommon})`}
              {v.key === "theirs" && ` (${data.total - data.inCommon})`}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={entries}
        keyExtractor={(item) => item.gameId}
        refreshControl={
          <RefreshControl refreshing={library.isRefetching} onRefresh={() => library.refetch()} />
        }
        contentContainerStyle={{ padding: 12, paddingBottom: 32 + insets.bottom }}
        ListEmptyComponent={<Text style={styles.emptyText}>Nothing matches that filter.</Text>}
        renderItem={({ item }) => <FriendGameRow entry={item} badgeOpacity={badgeOpacity} />}
      />
    </View>
  );
}

function FriendGameRow({
  entry,
  badgeOpacity,
}: {
  entry: FriendLibraryEntry;
  badgeOpacity: number;
}) {
  const status = statusStyle(entry.status, badgeOpacity);
  const cover = resolveImage(entry.coverSrc);
  const mine = entry.myStatus ? statusStyle(entry.myStatus, badgeOpacity) : null;

  return (
    <View style={styles.row}>
      <View style={styles.cover}>
        {cover && (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title} numberOfLines={2}>
          {entry.title}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: status.bg }]}>
            <Text style={[styles.badgeText, { color: status.text }]} numberOfLines={1}>
              {status.label}
            </Text>
          </View>
          {entry.rating != null && <Text style={styles.rating}>★ {entry.rating}</Text>}
          {entry.completed100 && <Text style={styles.hundred}>100%</Text>}
        </View>
        {entry.platforms.length > 0 && (
          <Text style={styles.platforms} numberOfLines={1}>
            {entry.platforms.join(" · ")}
          </Text>
        )}
        {mine && (
          <Text style={styles.yours} numberOfLines={1}>
            Yours: <Text style={{ color: mine.text }}>{mine.label}</Text>
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101014",
    padding: 24,
  },
  searchRow: { paddingHorizontal: 12, paddingTop: 10 },
  search: {
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: "#fafafa",
    fontSize: 15,
  },
  summary: { color: "#71717a", fontSize: 12, paddingHorizontal: 12, marginTop: 8 },
  common: { color: "#818cf8", fontWeight: "700" },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3f3f46",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: "#312e81", borderColor: "#818cf8" },
  chipText: { color: "#a1a1aa", fontSize: 13, fontWeight: "500" },
  chipTextActive: { color: "#c7d2fe" },
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
  cover: { width: 46, height: 62, borderRadius: 6, backgroundColor: "#27272a", overflow: "hidden" },
  title: { color: "#fafafa", fontSize: 15, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 4 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, maxWidth: 140 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  rating: { color: "#fbbf24", fontSize: 12 },
  hundred: { color: "#6ee7b7", fontSize: 11, fontWeight: "700" },
  platforms: { color: "#71717a", fontSize: 11, marginTop: 3 },
  yours: { color: "#52525b", fontSize: 11, marginTop: 3 },
  emptyTitle: { color: "#fafafa", fontSize: 16, fontWeight: "600", textAlign: "center" },
  emptyText: { color: "#71717a", fontSize: 13, marginTop: 6, textAlign: "center" },
});
