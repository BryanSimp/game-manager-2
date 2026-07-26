import { useState } from "react";
import { Redirect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { GAME_STATUSES, type GameStatus, type LibraryEntry } from "@gm/shared";
import { authClient } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatHours, resolveImage, STATUS_COLORS } from "@/lib/ui";

const SORTS = [
  { key: "added", label: "Recent" },
  { key: "title", label: "A–Z" },
  { key: "rating", label: "Rating" },
  { key: "ttb", label: "Time" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

export default function LibraryScreen() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [statusFilter, setStatusFilter] = useState<GameStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("added");

  const library = useQuery({
    queryKey: ["library"],
    queryFn: () => api.getLibrary(),
    enabled: !!session,
  });

  const needle = search.trim().toLowerCase();
  const entries = (library.data ?? [])
    .filter((e) => statusFilter === "all" || e.status === statusFilter)
    .filter((e) => !needle || e.game.title.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === "title") return a.game.title.localeCompare(b.game.title);
      if (sort === "rating") return (b.rating ?? -1) - (a.rating ?? -1);
      // shortest main story first; games without a time-to-beat sink to the bottom
      if (sort === "ttb")
        return (
          (a.game.ttbMain ?? Number.MAX_SAFE_INTEGER) - (b.game.ttbMain ?? Number.MAX_SAFE_INTEGER)
        );
      return b.createdAt.localeCompare(a.createdAt);
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
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search library…"
          placeholderTextColor="#71717a"
          autoCapitalize="none"
        />
        {SORTS.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.sortBtn, sort === s.key && styles.sortActive]}
            onPress={() => setSort(s.key)}
          >
            <Text style={[styles.sortText, sort === s.key && styles.sortTextActive]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: "center" }}
      >
        <FilterChip
          label={`All (${library.data?.length ?? 0})`}
          active={statusFilter === "all"}
          onPress={() => setStatusFilter("all")}
        />
        {GAME_STATUSES.map((s) => {
          const n = (library.data ?? []).filter((e) => e.status === s).length;
          const meta = STATUS_COLORS[s];
          return (
            <FilterChip
              key={s}
              label={`${meta.label} (${n})`}
              active={statusFilter === s}
              activeColor={meta.text}
              activeBg={meta.bg}
              onPress={() => setStatusFilter(statusFilter === s ? "all" : s)}
            />
          );
        })}
      </ScrollView>
      <FlatList
        data={entries}
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

function FilterChip({
  label,
  active,
  onPress,
  activeColor,
  activeBg,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  activeColor?: string;
  activeBg?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.filterChip,
        active && {
          backgroundColor: activeBg ?? "#312e81",
          borderColor: activeColor ?? "#818cf8",
        },
      ]}
    >
      <Text style={[styles.filterChipText, active && { color: activeColor ?? "#c7d2fe" }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function LibraryRow({ entry, onPress }: { entry: LibraryEntry; onPress: () => void }) {
  const status = STATUS_COLORS[entry.status];
  const cover = resolveImage(entry.game.coverSrc);
  const ttb = formatHours(entry.game.ttbMain);
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
          {ttb && <Text style={styles.ttb}>⏱ {ttb}</Text>}
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
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  search: {
    flex: 1,
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    color: "#fafafa",
    fontSize: 14,
  },
  sortBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3f3f46",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  sortActive: { backgroundColor: "#312e81", borderColor: "#818cf8" },
  sortText: { color: "#a1a1aa", fontSize: 11, fontWeight: "600" },
  sortTextActive: { color: "#c7d2fe" },
  filterBar: { flexGrow: 0, paddingVertical: 10 },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3f3f46",
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  filterChipText: { color: "#a1a1aa", fontSize: 13, fontWeight: "500" },
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
  ttb: { color: "#a1a1aa", fontSize: 12 },
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
