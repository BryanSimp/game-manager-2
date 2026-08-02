import { useMemo, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { GAME_STATUSES, type GameStatus, type LibraryEntry } from "@gm/shared";
import { authClient } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatHours, resolveImage, STATUS_COLORS, statusStyle } from "@/lib/ui";
import { groupConsoles, onPlatform } from "@/lib/platforms";
import { usePreferences } from "@/lib/prefs";

const SORTS = [
  { key: "added", label: "Recent" },
  { key: "title", label: "A–Z" },
  { key: "rating", label: "Rating" },
  { key: "ttb", label: "Time" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: session, isPending } = authClient.useSession();
  const [statusFilter, setStatusFilter] = useState<GameStatus | "all">("all");
  const [platformFilter, setPlatformFilter] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("added");

  const library = useQuery({
    queryKey: ["library"],
    queryFn: () => api.getLibrary(),
    enabled: !!session,
  });
  const consoles = useQuery({
    queryKey: ["consoles"],
    queryFn: () => api.getConsoles(),
    enabled: !!session,
  });

  const all = useMemo(() => library.data ?? [], [library.data]);

  // one chip per console you own, storefronts indented under their platform —
  // picking PC therefore includes everything you bought on Steam
  const platformChips = useMemo(
    () =>
      groupConsoles(consoles.data ?? []).flatMap((group) => [
        { id: group.console.platform.id, label: group.console.platform.name, child: false },
        ...group.storefronts.map((s) => ({
          id: s.platform.id,
          label: s.platform.name,
          child: true,
        })),
      ]),
    [consoles.data],
  );

  const sortIndex = SORTS.findIndex((s) => s.key === sort);
  const needle = search.trim().toLowerCase();
  const entries = all
    .filter((e) => statusFilter === "all" || e.status === statusFilter)
    .filter((e) => platformFilter === "all" || onPlatform(e.platforms, platformFilter))
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
        {/* four sort buttons used to share this row with the search box and
            squeezed it to a sliver — one button that cycles instead. A picker
            would be an Alert, and Android only renders three of its buttons */}
        <TouchableOpacity
          style={styles.sortBtn}
          accessibilityLabel={`Sorted by ${SORTS[sortIndex]!.label}, tap to change`}
          onPress={() => setSort(SORTS[(sortIndex + 1) % SORTS.length]!.key)}
        >
          <Text style={styles.sortText} numberOfLines={1}>
            ⇅ {SORTS[sortIndex]!.label}
          </Text>
        </TouchableOpacity>
      </View>

      <ChipBar>
        <Chip
          label={`All (${all.length})`}
          active={statusFilter === "all"}
          onPress={() => setStatusFilter("all")}
        />
        {GAME_STATUSES.map((s) => {
          const n = all.filter((e) => e.status === s).length;
          // empty categories only clutter the bar — except the one you're in,
          // so you can always click back out of it
          if (n === 0 && statusFilter !== s) return null;
          const meta = STATUS_COLORS[s];
          return (
            <Chip
              key={s}
              label={`${meta.label} (${n})`}
              active={statusFilter === s}
              activeColor={meta.text}
              activeBg={meta.bg}
              onPress={() => setStatusFilter(statusFilter === s ? "all" : s)}
            />
          );
        })}
      </ChipBar>

      {platformChips.length > 0 && (
        <ChipBar>
          <Text style={styles.barLabel}>Console</Text>
          <Chip
            label="Any"
            active={platformFilter === "all"}
            onPress={() => setPlatformFilter("all")}
          />
          {platformChips.map((p) => {
            const n = all.filter((e) => onPlatform(e.platforms, p.id)).length;
            if (n === 0 && platformFilter !== p.id) return null;
            return (
              <Chip
                key={p.id}
                label={`${p.child ? "↳ " : ""}${p.label} (${n})`}
                active={platformFilter === p.id}
                onPress={() => setPlatformFilter(platformFilter === p.id ? "all" : p.id)}
              />
            );
          })}
        </ChipBar>
      )}

      {platformFilter !== "all" && (
        <TouchableOpacity
          style={styles.consoleLink}
          onPress={() => router.push(`/console/${platformFilter}`)}
        >
          <Text style={styles.consoleLinkText}>
            Open the {platformChips.find((p) => p.id === platformFilter)?.label ?? "console"} page ›
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={library.isRefetching} onRefresh={() => library.refetch()} />
        }
        contentContainerStyle={{ padding: 12, paddingBottom: 96 + insets.bottom }}
        ListEmptyComponent={
          library.isLoading ? (
            <ActivityIndicator style={{ marginTop: 48 }} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {all.length === 0 ? "Your library is empty" : "Nothing matches those filters"}
              </Text>
              <Text style={styles.emptyText}>
                {all.length === 0
                  ? "Tap + to add your first game."
                  : "Clear a filter to see more games."}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <LibraryRow entry={item} onPress={() => router.push(`/game/${item.id}`)} />
        )}
      />

      <TouchableOpacity
        style={[styles.fab, { bottom: 24 + insets.bottom }]}
        accessibilityLabel="Add a game"
        onPress={() => router.push("/add")}
      >
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </View>
  );
}

/** A horizontally scrolling row of chips that never squeezes its neighbours. */
function ChipBar({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipBar}
      contentContainerStyle={styles.chipBarContent}
    >
      {children}
    </ScrollView>
  );
}

function Chip({
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
        styles.chip,
        active && {
          backgroundColor: activeBg ?? "#312e81",
          borderColor: activeColor ?? "#818cf8",
        },
      ]}
    >
      <Text style={[styles.chipText, active && { color: activeColor ?? "#c7d2fe" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function LibraryRow({ entry, onPress }: { entry: LibraryEntry; onPress: () => void }) {
  const prefs = usePreferences();
  const status = statusStyle(entry.status, prefs?.badgeOpacity ?? 100);
  const cover = resolveImage(entry.game.coverSrc);
  const ttb = formatHours(entry.game.ttbMain);
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.cover}>
        {cover && (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title} numberOfLines={2}>
          {entry.game.title}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: status.bg }]}>
            <Text style={[styles.badgeText, { color: status.text }]} numberOfLines={1}>
              {status.label}
            </Text>
          </View>
          {entry.rating != null && (prefs?.showRating ?? true) && (
            <Text style={styles.rating}>★ {entry.rating}</Text>
          )}
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
    gap: 8,
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
    paddingVertical: 9,
    color: "#fafafa",
    fontSize: 15,
  },
  sortBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3f3f46",
    backgroundColor: "#18181b",
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  sortText: { color: "#c7d2fe", fontSize: 13, fontWeight: "600" },
  consoleLink: { paddingHorizontal: 12, paddingTop: 10 },
  consoleLinkText: { color: "#818cf8", fontSize: 12, fontWeight: "600" },
  chipBar: { flexGrow: 0, marginTop: 8 },
  chipBarContent: { paddingHorizontal: 12, gap: 8, alignItems: "center" },
  barLabel: { color: "#52525b", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3f3f46",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { color: "#a1a1aa", fontSize: 13, fontWeight: "500" },
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
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 4 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, maxWidth: 140 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  rating: { color: "#fbbf24", fontSize: 12 },
  ttb: { color: "#a1a1aa", fontSize: 12 },
  platforms: { color: "#71717a", fontSize: 11, marginTop: 3 },
  chevron: { color: "#52525b", fontSize: 24, paddingLeft: 4 },
  empty: { alignItems: "center", marginTop: 64, paddingHorizontal: 24 },
  emptyTitle: { color: "#fafafa", fontSize: 16, fontWeight: "600", textAlign: "center" },
  emptyText: { color: "#71717a", fontSize: 13, marginTop: 4, textAlign: "center" },
  fab: {
    position: "absolute",
    right: 20,
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
