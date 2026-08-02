import { useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import type { LibraryEntry, OwnershipFormat } from "@gm/shared";
import { api } from "@/lib/api";
import { formatHours, resolveImage, statusStyle } from "@/lib/ui";
import { formatReleaseDate } from "@/lib/platforms";
import { usePreferences } from "@/lib/prefs";

type FormatFilter = "all" | OwnershipFormat;

const FORMAT_FILTERS: Array<{ key: FormatFilter; label: string }> = [
  { key: "all", label: "Everything" },
  { key: "physical", label: "📦 Physical" },
  { key: "digital", label: "💾 Digital" },
];

/**
 * One console's games. A platform's page includes anything filed under its
 * storefronts — the PC page is your whole PC library, Steam's page is just
 * the Steam part.
 */
export default function ConsoleDetailScreen() {
  const { platformId } = useLocalSearchParams<{ platformId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const prefs = usePreferences();
  const [format, setFormat] = useState<FormatFilter>("all");

  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary() });
  const consoles = useQuery({ queryKey: ["consoles"], queryFn: () => api.getConsoles() });

  const row = consoles.data?.find((c) => c.platform.id === platformId);
  const platform = row?.platform;
  const art = resolveImage(row?.customImageSrc ?? platform?.logoUrl ?? null);

  const entries = useMemo(
    () =>
      (library.data ?? []).filter((e) =>
        e.platforms.some(
          (p) =>
            (p.platformId === platformId || p.parentPlatformId === platformId) &&
            (format === "all" || p.format === format),
        ),
      ),
    [library.data, platformId, format],
  );

  const released = formatReleaseDate(platform?.releaseDate ?? null);
  const loading = library.isLoading || consoles.isLoading;

  if (!loading && !platform) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Console not found</Text>
        <Text style={styles.emptyText}>It may have been removed from your consoles list.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: platform?.name ?? "Console" }} />
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={library.isRefetching} onRefresh={() => library.refetch()} />
        }
        contentContainerStyle={{ padding: 12, paddingBottom: 32 + insets.bottom }}
        ListHeaderComponent={
          <View style={{ marginBottom: 4 }}>
            <View style={styles.card}>
              <View style={styles.logo}>
                {art ? (
                  <Image source={{ uri: art }} style={styles.logoImage} resizeMode="contain" />
                ) : (
                  <Text style={styles.logoFallback} numberOfLines={2}>
                    {platform?.abbreviation ?? platform?.name ?? "—"}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={2}>
                  {platform?.name ?? "Console"}
                </Text>
                {platform?.parentName && (
                  <Text style={styles.meta}>{platform.parentName} storefront</Text>
                )}
                {released && <Text style={styles.meta}>Released {released}</Text>}
                <Text style={styles.count}>
                  {entries.length} {entries.length === 1 ? "game" : "games"}
                </Text>
              </View>
            </View>

            {platform?.summary && <Text style={styles.summary}>{platform.summary}</Text>}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, marginTop: 12 }}
              contentContainerStyle={{ gap: 8 }}
            >
              {FORMAT_FILTERS.map((f) => (
                <Pressable
                  key={f.key}
                  style={[styles.chip, format === f.key && styles.chipActive]}
                  onPress={() => setFormat(f.key)}
                >
                  <Text style={[styles.chipText, format === f.key && styles.chipTextActive]}>
                    {f.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 32 }} />
          ) : (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>Nothing filed here yet</Text>
              <Text style={styles.emptyText}>
                {format === "all"
                  ? "Set a game's platform on its page and it'll show up here."
                  : "No games in that format on this console."}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <GameRow
            entry={item}
            platformId={platformId}
            badgeOpacity={prefs?.badgeOpacity ?? 100}
            showRating={prefs?.showRating ?? true}
            onPress={() => router.push(`/game/${item.id}`)}
          />
        )}
      />
    </View>
  );
}

function GameRow({
  entry,
  platformId,
  badgeOpacity,
  showRating,
  onPress,
}: {
  entry: LibraryEntry;
  platformId: string;
  badgeOpacity: number;
  showRating: boolean;
  onPress: () => void;
}) {
  const status = statusStyle(entry.status, badgeOpacity);
  const cover = resolveImage(entry.game.coverSrc);
  const ttb = formatHours(entry.game.ttbMain);
  // on PC's page, say which store each game came from
  const here = entry.platforms.filter(
    (p) => p.platformId === platformId || p.parentPlatformId === platformId,
  );
  const formats = here
    .map((p) => `${p.parentPlatformId ? `${p.abbreviation ?? p.name} ` : ""}${p.format === "physical" ? "📦" : "💾"}`)
    .join(" · ");

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
          {entry.rating != null && showRating && <Text style={styles.rating}>★ {entry.rating}</Text>}
          {ttb && <Text style={styles.ttb}>⏱ {ttb}</Text>}
        </View>
        {formats.length > 0 && (
          <Text style={styles.formats} numberOfLines={1}>
            {formats}
          </Text>
        )}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
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
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#18181b",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 14,
  },
  logo: {
    width: 88,
    height: 60,
    borderRadius: 10,
    backgroundColor: "#101014",
    borderWidth: 1,
    borderColor: "#27272a",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  logoImage: { width: "100%", height: "100%" },
  logoFallback: { color: "#52525b", fontSize: 11, fontWeight: "700", textAlign: "center" },
  name: { color: "#fafafa", fontSize: 18, fontWeight: "700" },
  meta: { color: "#71717a", fontSize: 11, marginTop: 2 },
  count: { color: "#a1a1aa", fontSize: 12, marginTop: 4, fontWeight: "600" },
  summary: { color: "#a1a1aa", fontSize: 13, lineHeight: 19, marginTop: 10 },
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
    marginTop: 8,
  },
  cover: { width: 46, height: 62, borderRadius: 6, backgroundColor: "#27272a", overflow: "hidden" },
  title: { color: "#fafafa", fontSize: 15, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 4 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, maxWidth: 140 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  rating: { color: "#fbbf24", fontSize: 12 },
  ttb: { color: "#a1a1aa", fontSize: 12 },
  formats: { color: "#71717a", fontSize: 11, marginTop: 3 },
  chevron: { color: "#52525b", fontSize: 24, paddingLeft: 4 },
  emptyBlock: { alignItems: "center", marginTop: 40, paddingHorizontal: 24 },
  emptyTitle: { color: "#fafafa", fontSize: 16, fontWeight: "600", textAlign: "center" },
  emptyText: { color: "#71717a", fontSize: 13, marginTop: 6, textAlign: "center" },
});
