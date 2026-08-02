import { useMemo, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
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
import { colors, radius, space, type } from "@/lib/theme";
import {
  Badge,
  Chevron,
  Cover,
  EmptyState,
  Field,
  Icon,
  Loading,
  OptionRow,
  Screen,
  Sheet,
  SheetButton,
  SheetSection,
} from "@/components/ui";

// `short` goes on the button, which is a third of a phone row wide; `label`
// goes in the sheet, which has room to say what the sort actually does
const SORTS = [
  { key: "added", label: "Recently added", short: "Recent", icon: "time-outline" },
  { key: "title", label: "Title A–Z", short: "A–Z", icon: "text-outline" },
  { key: "rating", label: "Highest rated", short: "Rating", icon: "star-outline" },
  { key: "ttb", label: "Shortest to beat", short: "Shortest", icon: "speedometer-outline" },
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
  const [sheet, setSheet] = useState<null | "filter" | "sort">(null);

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

  // one option per console you own, storefronts indented under their platform —
  // picking PC therefore includes everything you bought on Steam
  const platformOptions = useMemo(
    () =>
      groupConsoles(consoles.data ?? []).flatMap((group) => [
        { id: group.console.platform.id, label: group.console.platform.name, child: false },
        ...group.storefronts.map((s) => ({ id: s.platform.id, label: s.platform.name, child: true })),
      ]),
    [consoles.data],
  );

  const activeSort = SORTS.find((s) => s.key === sort)!;
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

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/login" />;

  const activeFilters = (statusFilter === "all" ? 0 : 1) + (platformFilter === "all" ? 0 : 1);
  const statusLabel = statusFilter === "all" ? null : STATUS_COLORS[statusFilter].label;
  const platformLabel =
    platformFilter === "all"
      ? null
      : (platformOptions.find((p) => p.id === platformFilter)?.label ?? "Console");
  // naming both filters overflows the button ("Backlog · Nintendo Switch 2"),
  // so two of them collapse to a count and the badge carries the detail
  const filterLabel =
    activeFilters === 0
      ? "All games"
      : activeFilters === 1
        ? (statusLabel ?? platformLabel)!
        : "2 filters";

  return (
    <Screen>
      <View style={styles.controls}>
        <View style={styles.searchWrap}>
          <Icon name="search" size={16} color={colors.textFaint} />
          <Field
            style={styles.search}
            value={search}
            onChangeText={setSearch}
            placeholder="Search library…"
            autoCapitalize="none"
            returnKeyType="search"
          />
        </View>
        {/* two roomy buttons instead of two scrolling rows of chips: seven
            categories plus a console each was more than a phone row can hold */}
        <View style={styles.buttonRow}>
          <SheetButton
            label={filterLabel}
            icon="filter-outline"
            active={activeFilters > 0}
            badge={activeFilters}
            onPress={() => setSheet("filter")}
            style={{ flex: 3 }}
          />
          <SheetButton
            label={activeSort.short}
            icon="swap-vertical"
            onPress={() => setSheet("sort")}
            style={{ flex: 2 }}
          />
        </View>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={library.isRefetching} onRefresh={() => library.refetch()} />
        }
        contentContainerStyle={{ padding: space.md, paddingBottom: 96 + insets.bottom }}
        ListHeaderComponent={
          platformFilter !== "all" ? (
            <Pressable
              accessibilityRole="link"
              style={styles.consoleLink}
              onPress={() => router.push(`/console/${platformFilter}`)}
            >
              <Text style={[type.caption, { color: colors.accentBorder }]}>
                Open the {platformLabel} page
              </Text>
              <Icon name="arrow-forward" size={13} color={colors.accentBorder} />
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          library.isLoading ? (
            <ActivityIndicator style={{ marginTop: 48 }} color={colors.accentBorder} />
          ) : activeFilters > 0 || needle ? (
            <EmptyState
              icon="filter-outline"
              title="Nothing matches those filters"
              text="Clear a filter to see more games."
            />
          ) : (
            <EmptyState
              icon="library-outline"
              title="Your library is empty"
              text="Tap the + button to add your first game."
            />
          )
        }
        renderItem={({ item }) => (
          <LibraryRow entry={item} onPress={() => router.push(`/game/${item.id}`)} />
        )}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a game"
        style={({ pressed }) => [styles.fab, { bottom: 24 + insets.bottom }, pressed && { opacity: 0.85 }]}
        onPress={() => router.push("/add")}
      >
        <Icon name="add" size={30} color="#ffffff" />
      </Pressable>

      <Sheet visible={sheet === "filter"} title="Filter" onClose={() => setSheet(null)}>
        <SheetSection label="Category" />
        <OptionRow
          label="All categories"
          count={all.length}
          selected={statusFilter === "all"}
          onPress={() => setStatusFilter("all")}
        />
        {GAME_STATUSES.map((s) => {
          const n = all.filter((e) => e.status === s).length;
          // an empty category is still worth showing here — the sheet has room,
          // and it tells you the category exists
          const meta = STATUS_COLORS[s];
          return (
            <OptionRow
              key={s}
              label={meta.label}
              count={n}
              tint={meta.text}
              selected={statusFilter === s}
              onPress={() => setStatusFilter(statusFilter === s ? "all" : s)}
            />
          );
        })}

        {platformOptions.length > 0 && (
          <>
            <SheetSection label="Console" />
            <OptionRow
              label="Any console"
              icon="game-controller-outline"
              count={all.length}
              selected={platformFilter === "all"}
              onPress={() => setPlatformFilter("all")}
            />
            {platformOptions.map((p) => (
              <OptionRow
                key={p.id}
                label={p.label}
                icon={p.child ? "storefront-outline" : undefined}
                indent={p.child}
                count={all.filter((e) => onPlatform(e.platforms, p.id)).length}
                selected={platformFilter === p.id}
                onPress={() => setPlatformFilter(platformFilter === p.id ? "all" : p.id)}
              />
            ))}
          </>
        )}

        {activeFilters > 0 && (
          <Pressable
            accessibilityRole="button"
            style={styles.clearRow}
            onPress={() => {
              setStatusFilter("all");
              setPlatformFilter("all");
            }}
          >
            <Icon name="close-circle-outline" size={16} color={colors.textMuted} />
            <Text style={[type.label, { color: colors.textMuted }]}>Clear filters</Text>
          </Pressable>
        )}
      </Sheet>

      <Sheet visible={sheet === "sort"} title="Sort by" onClose={() => setSheet(null)}>
        {SORTS.map((s) => (
          <OptionRow
            key={s.key}
            label={s.label}
            icon={s.icon}
            selected={sort === s.key}
            onPress={() => {
              setSort(s.key);
              setSheet(null);
            }}
          />
        ))}
      </Sheet>
    </Screen>
  );
}

function LibraryRow({ entry, onPress }: { entry: LibraryEntry; onPress: () => void }) {
  const prefs = usePreferences();
  const status = statusStyle(entry.status, prefs?.badgeOpacity ?? 100);
  const ttb = formatHours(entry.game.ttbMain);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <Cover src={resolveImage(entry.game.coverSrc)} width={48} height={64} />
      <View style={styles.rowBody}>
        <Text style={type.bodyStrong} numberOfLines={2}>
          {entry.game.title}
        </Text>
        <View style={styles.metaRow}>
          <Badge label={status.label} bg={status.bg} fg={status.text} />
          {entry.rating != null && (prefs?.showRating ?? true) && (
            <View style={styles.metaItem}>
              <Icon name="star" size={12} color={colors.star} />
              <Text style={[type.caption, { color: colors.star }]}>{entry.rating}</Text>
            </View>
          )}
          {ttb && (
            <View style={styles.metaItem}>
              <Icon name="time-outline" size={12} color={colors.textMuted} />
              <Text style={type.caption}>{ttb}</Text>
            </View>
          )}
        </View>
        {entry.platforms.length > 0 && (
          <Text style={[type.micro, { marginTop: 3 }]} numberOfLines={1}>
            {entry.platforms.map((p) => p.abbreviation ?? p.name).join(" · ")}
          </Text>
        )}
      </View>
      <Chevron />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: space.md, paddingTop: space.sm, gap: space.sm },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingLeft: space.md,
  },
  // the wrapper draws the border, so the input inside it is bare
  search: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingRight: space.md,
  },
  buttonRow: { flexDirection: "row", gap: space.sm },
  consoleLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingBottom: space.sm,
  },
  clearRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    marginTop: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.sm + 2,
    marginBottom: space.sm,
  },
  rowBody: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, marginTop: 5 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  fab: {
    position: "absolute",
    right: space.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
});
