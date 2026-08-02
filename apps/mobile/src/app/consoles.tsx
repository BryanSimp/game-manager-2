import { useRouter } from "expo-router";
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
import type { ConsoleSummary } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage } from "@/lib/ui";
import { formatReleaseDate, groupConsoles, type ConsoleGroup } from "@/lib/platforms";

/**
 * The consoles you own, each opening a page of the games filed under it.
 * Adding and removing consoles is still web-only, same as category management.
 */
export default function ConsolesScreen() {
  const insets = useSafeAreaInsets();
  const consoles = useQuery({ queryKey: ["consoles"], queryFn: () => api.getConsoles() });
  const groups = groupConsoles(consoles.data ?? []);

  return (
    <FlatList
      style={styles.screen}
      data={groups}
      keyExtractor={(group) => group.console.platform.id}
      refreshControl={
        <RefreshControl refreshing={consoles.isRefetching} onRefresh={() => consoles.refetch()} />
      }
      contentContainerStyle={{ padding: 12, paddingBottom: 32 + insets.bottom }}
      ListEmptyComponent={
        consoles.isLoading ? (
          <ActivityIndicator style={{ marginTop: 48 }} />
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No consoles yet</Text>
            <Text style={styles.emptyText}>
              Add the consoles you own on the web app — they become the platforms you can file
              games under.
            </Text>
          </View>
        )
      }
      renderItem={({ item }) => <ConsoleGroupCard group={item} />}
    />
  );
}

function ConsoleGroupCard({ group }: { group: ConsoleGroup }) {
  return (
    <View style={styles.group}>
      <ConsoleCard row={group.console} />
      {group.storefronts.map((store) => (
        <View key={store.platform.id} style={styles.storefront}>
          <ConsoleCard row={store} compact />
        </View>
      ))}
    </View>
  );
}

function ConsoleCard({ row, compact }: { row: ConsoleSummary; compact?: boolean }) {
  const router = useRouter();
  const p = row.platform;
  const released = formatReleaseDate(p.releaseDate);
  // your own art wins over the stock logo, same as on the web app
  const logo = resolveImage(row.customImageSrc ?? p.logoUrl);

  return (
    <Pressable
      style={styles.card}
      accessibilityLabel={`${p.name}, ${row.gameCount} games`}
      onPress={() => router.push(`/console/${p.id}`)}
    >
      <View style={styles.header}>
        <View style={[styles.logo, compact && styles.logoCompact]}>
          {logo ? (
            <Image source={{ uri: logo }} style={styles.logoImage} resizeMode="contain" />
          ) : (
            <Text style={styles.logoFallback} numberOfLines={2}>
              {p.abbreviation ?? p.name}
            </Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={2}>
            {p.name}
          </Text>
          {p.parentName && <Text style={styles.released}>{p.parentName} storefront</Text>}
          {released && !compact && <Text style={styles.released}>Released {released}</Text>}
          <Text style={styles.counts} numberOfLines={2}>
            {row.gameCount} {row.gameCount === 1 ? "game" : "games"}
            {row.storefrontCount > 0 && ` · 🛒 ${row.storefrontCount}`}
            {row.physicalCount > 0 && ` · 📦 ${row.physicalCount}`}
            {row.digitalCount > 0 && ` · 💾 ${row.digitalCount}`}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>

      {p.summary && !compact && (
        <Text style={styles.summary} numberOfLines={4}>
          {p.summary}
        </Text>
      )}

      {row.preview.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingTop: 10 }}
        >
          {row.preview.map((game) => {
            const cover = resolveImage(game.coverSrc);
            return (
              <Pressable
                key={game.entryId}
                style={styles.cover}
                onPress={() => router.push(`/game/${game.entryId}`)}
              >
                {cover ? (
                  <Image
                    source={{ uri: cover }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.coverFallback} numberOfLines={3}>
                    {game.title}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  group: { marginBottom: 10 },
  // storefronts sit visibly under the platform they sell for
  storefront: { marginTop: 6, marginLeft: 16 },
  card: {
    backgroundColor: "#18181b",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 14,
  },
  header: { flexDirection: "row", gap: 12, alignItems: "center" },
  logo: {
    width: 76,
    height: 52,
    borderRadius: 10,
    backgroundColor: "#101014",
    borderWidth: 1,
    borderColor: "#27272a",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  logoCompact: { width: 56, height: 40 },
  logoImage: { width: "100%", height: "100%" },
  logoFallback: { color: "#52525b", fontSize: 10, fontWeight: "700", textAlign: "center" },
  name: { color: "#fafafa", fontSize: 16, fontWeight: "700" },
  released: { color: "#71717a", fontSize: 11, marginTop: 2 },
  counts: { color: "#a1a1aa", fontSize: 12, marginTop: 4 },
  chevron: { color: "#52525b", fontSize: 22 },
  summary: { color: "#a1a1aa", fontSize: 13, lineHeight: 19, marginTop: 10 },
  cover: {
    width: 52,
    height: 70,
    borderRadius: 6,
    backgroundColor: "#27272a",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  coverFallback: { color: "#71717a", fontSize: 9, textAlign: "center", padding: 2 },
  empty: { alignItems: "center", marginTop: 64, paddingHorizontal: 24 },
  emptyTitle: { color: "#fafafa", fontSize: 16, fontWeight: "600" },
  emptyText: { color: "#71717a", fontSize: 13, marginTop: 6, textAlign: "center" },
});
