import { useMemo, useState } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import type { FriendLibraryEntry } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage, statusStyle } from "@/lib/ui";
import { useBadgeOpacity } from "@/lib/prefs";
import { colors, radius, space, type } from "@/lib/theme";
import {
  Badge,
  Chip,
  ChipBar,
  Cover,
  EmptyState,
  Field,
  Icon,
  Loading,
  Screen,
} from "@/components/ui";

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

  if (library.isLoading) return <Loading />;
  if (library.isError || !data) {
    return (
      <Screen center>
        <EmptyState
          icon="lock-closed-outline"
          title="You can't see this library"
          text="You may no longer be friends."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: data.friend.name }} />

      <View style={styles.searchRow}>
        <Icon name="search" size={16} color={colors.textFaint} />
        <Field
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${data.friend.name}'s games…`}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      <Text style={[type.caption, styles.summary]}>
        {data.total} games ·{" "}
        <Text style={{ color: colors.accentBorder, fontWeight: "700" }}>{data.inCommon}</Text> you
        both have
      </Text>

      <ChipBar style={{ marginTop: space.sm }}>
        {VIEWS.map((v) => (
          <Chip
            key={v.key}
            label={
              v.key === "common"
                ? `${v.label} ${data.inCommon}`
                : v.key === "theirs"
                  ? `${v.label} ${data.total - data.inCommon}`
                  : v.label
            }
            active={view === v.key}
            onPress={() => setView(v.key)}
          />
        ))}
      </ChipBar>

      <FlatList
        data={entries}
        keyExtractor={(item) => item.gameId}
        refreshControl={
          <RefreshControl refreshing={library.isRefetching} onRefresh={() => library.refetch()} />
        }
        contentContainerStyle={{ padding: space.md, paddingBottom: space.xxl + insets.bottom }}
        ListEmptyComponent={
          <EmptyState icon="filter-outline" title="Nothing matches that filter" />
        }
        renderItem={({ item }) => <FriendGameRow entry={item} badgeOpacity={badgeOpacity} />}
      />
    </Screen>
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
  const mine = entry.myStatus ? statusStyle(entry.myStatus, badgeOpacity) : null;

  return (
    <View style={styles.row}>
      <Cover src={resolveImage(entry.coverSrc)} width={46} height={62} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type.bodyStrong} numberOfLines={2}>
          {entry.title}
        </Text>
        <View style={styles.metaRow}>
          <Badge label={status.label} bg={status.bg} fg={status.text} />
          {entry.rating != null && (
            <View style={styles.metaItem}>
              <Icon name="star" size={12} color={colors.star} />
              <Text style={[type.caption, { color: colors.star }]}>{entry.rating}</Text>
            </View>
          )}
          {entry.completed100 && (
            <View style={styles.metaItem}>
              <Icon name="trophy" size={12} color={colors.success} />
              <Text style={[type.micro, { color: colors.success }]}>100%</Text>
            </View>
          )}
        </View>
        {entry.platforms.length > 0 && (
          <Text style={[type.micro, { marginTop: 3 }]} numberOfLines={1}>
            {entry.platforms.join(" · ")}
          </Text>
        )}
        {mine && (
          <Text style={[type.micro, { marginTop: 3 }]} numberOfLines={1}>
            Yours: <Text style={{ color: mine.text }}>{mine.label}</Text>
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginHorizontal: space.md,
    marginTop: space.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingLeft: space.md,
  },
  search: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingRight: space.md,
  },
  summary: { paddingHorizontal: space.md, marginTop: space.sm },
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
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, marginTop: 5 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
});
