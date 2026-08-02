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
  Chip,
  ChipBar,
  Cover,
  EmptyState,
  Field,
  Icon,
  Loading,
  Screen,
} from "@/components/ui";

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
        ...group.storefronts.map((s) => ({ id: s.platform.id, label: s.platform.name, child: true })),
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

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/login" />;

  const filtered = statusFilter !== "all" || platformFilter !== "all" || needle.length > 0;

  return (
    <Screen>
      <View style={styles.searchRow}>
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
        {/* four sort buttons used to share this row with the search box and
            squeezed it to a sliver — one button that cycles instead. A picker
            would be an Alert, and Android only renders three of its buttons */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sorted by ${SORTS[sortIndex]!.label}, tap to change`}
          onPress={() => setSort(SORTS[(sortIndex + 1) % SORTS.length]!.key)}
          style={({ pressed }) => [styles.sortBtn, pressed && { opacity: 0.7 }]}
        >
          <Icon name="swap-vertical" size={15} color={colors.accentText} />
          <Text style={[type.caption, { color: colors.accentText }]} numberOfLines={1}>
            {SORTS[sortIndex]!.label}
          </Text>
        </Pressable>
      </View>

      <ChipBar style={{ marginTop: space.sm }}>
        <Chip
          label={`All ${all.length}`}
          active={statusFilter === "all"}
          onPress={() => setStatusFilter("all")}
        />
        {GAME_STATUSES.map((s) => {
          const n = all.filter((e) => e.status === s).length;
          // empty categories only clutter the bar — except the one you're in,
          // so you can always tap back out of it
          if (n === 0 && statusFilter !== s) return null;
          const meta = STATUS_COLORS[s];
          return (
            <Chip
              key={s}
              label={`${meta.label} ${n}`}
              active={statusFilter === s}
              activeColor={meta.text}
              activeBg={meta.bg}
              onPress={() => setStatusFilter(statusFilter === s ? "all" : s)}
            />
          );
        })}
      </ChipBar>

      {platformChips.length > 0 && (
        <ChipBar style={{ marginTop: 6 }}>
          <Chip
            label="Any console"
            icon="game-controller-outline"
            active={platformFilter === "all"}
            onPress={() => setPlatformFilter("all")}
          />
          {platformChips.map((p) => {
            const n = all.filter((e) => onPlatform(e.platforms, p.id)).length;
            if (n === 0 && platformFilter !== p.id) return null;
            return (
              <Chip
                key={p.id}
                label={`${p.label} ${n}`}
                icon={p.child ? "storefront-outline" : undefined}
                active={platformFilter === p.id}
                onPress={() => setPlatformFilter(platformFilter === p.id ? "all" : p.id)}
              />
            );
          })}
        </ChipBar>
      )}

      {platformFilter !== "all" && (
        <Pressable
          accessibilityRole="link"
          style={styles.consoleLink}
          onPress={() => router.push(`/console/${platformFilter}`)}
        >
          <Text style={[type.caption, { color: colors.accentBorder }]}>
            Open the {platformChips.find((p) => p.id === platformFilter)?.label ?? "console"} page
          </Text>
          <Icon name="arrow-forward" size={13} color={colors.accentBorder} />
        </Pressable>
      )}

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={library.isRefetching} onRefresh={() => library.refetch()} />
        }
        contentContainerStyle={{ padding: space.md, paddingBottom: 96 + insets.bottom }}
        ListEmptyComponent={
          library.isLoading ? (
            <ActivityIndicator style={{ marginTop: 48 }} color={colors.accentBorder} />
          ) : filtered ? (
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
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  searchWrap: {
    flex: 1,
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
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
  },
  consoleLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space.md,
    paddingTop: space.md,
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
