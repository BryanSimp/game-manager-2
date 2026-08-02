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
import { colors, radius, space, type } from "@/lib/theme";
import {
  Badge,
  Chevron,
  Cover,
  EmptyState,
  Icon,
  Screen,
  type IconName,
} from "@/components/ui";

type FormatFilter = "all" | OwnershipFormat;

const FORMAT_FILTERS: Array<{ key: FormatFilter; label: string; icon: IconName }> = [
  { key: "all", label: "Everything", icon: "albums-outline" },
  { key: "physical", label: "Physical", icon: "cube-outline" },
  { key: "digital", label: "Digital", icon: "cloud-download-outline" },
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
      <Screen center>
        <EmptyState
          icon="help-circle-outline"
          title="Console not found"
          text="It may have been removed from your consoles list."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: platform?.name ?? "Console" }} />
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={library.isRefetching} onRefresh={() => library.refetch()} />
        }
        contentContainerStyle={{ padding: space.md, paddingBottom: space.xxl + insets.bottom }}
        ListHeaderComponent={
          <View>
            <View style={styles.hero}>
              <View style={styles.logo}>
                {art ? (
                  <Image source={{ uri: art }} style={styles.logoImage} resizeMode="contain" />
                ) : (
                  <Text style={[type.label, styles.logoFallback]} numberOfLines={2}>
                    {platform?.abbreviation ?? platform?.name ?? "—"}
                  </Text>
                )}
              </View>
              <View style={styles.heroBody}>
                <Text style={type.title} numberOfLines={2}>
                  {platform?.name ?? "Console"}
                </Text>
                {platform?.parentName && (
                  <Text style={type.micro}>{platform.parentName} storefront</Text>
                )}
                {released && <Text style={type.micro}>Released {released}</Text>}
                <Text style={[type.caption, { color: colors.text, marginTop: space.xs }]}>
                  {entries.length} {entries.length === 1 ? "game" : "games"}
                </Text>
              </View>
            </View>

            {platform?.summary && (
              <Text style={[type.prose, { marginTop: space.md }]}>{platform.summary}</Text>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, marginTop: space.md }}
              contentContainerStyle={{ gap: space.sm, paddingVertical: 2 }}
            >
              {FORMAT_FILTERS.map((f) => {
                const active = format === f.key;
                const fg = active ? colors.accentText : colors.textMuted;
                return (
                  <Pressable
                    key={f.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setFormat(f.key)}
                  >
                    <Icon name={f.icon} size={14} color={fg} />
                    <Text style={[type.caption, { color: fg }]}>{f.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.accentBorder} />
          ) : (
            <EmptyState
              icon="file-tray-outline"
              title="Nothing filed here yet"
              text={
                format === "all"
                  ? "Set a game's platform on its page and it'll show up here."
                  : "No games in that format on this console."
              }
            />
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
    </Screen>
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
  const ttb = formatHours(entry.game.ttbMain);
  // on PC's page, say which store each game came from
  const here = entry.platforms.filter(
    (p) => p.platformId === platformId || p.parentPlatformId === platformId,
  );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <Cover src={resolveImage(entry.game.coverSrc)} width={46} height={62} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type.bodyStrong} numberOfLines={2}>
          {entry.game.title}
        </Text>
        <View style={styles.metaRow}>
          <Badge label={status.label} bg={status.bg} fg={status.text} />
          {entry.rating != null && showRating && (
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
        <View style={styles.metaRow}>
          {here.map((p) => (
            <View key={`${p.platformId}-${p.format}`} style={styles.metaItem}>
              <Icon
                name={p.format === "physical" ? "cube-outline" : "cloud-download-outline"}
                size={12}
                color={colors.textFaint}
              />
              <Text style={type.micro}>{p.parentPlatformId ? (p.abbreviation ?? p.name) : p.format}</Text>
            </View>
          ))}
        </View>
      </View>
      <Chevron />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  heroBody: { flex: 1, minWidth: 0, gap: 2 },
  logo: {
    width: 88,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  logoImage: { width: "100%", height: "100%" },
  logoFallback: { color: colors.textGhost, textAlign: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.md,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.sm + 2,
    marginTop: space.sm,
  },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, marginTop: 5 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
});
