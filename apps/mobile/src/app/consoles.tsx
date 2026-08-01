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
import { useQuery } from "@tanstack/react-query";
import type { ConsoleSummary } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage } from "@/lib/ui";

/** "1996-06-23" → "23 June 1996". */
function formatReleaseDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Read-only view of the consoles you own. Adding and removing consoles is
 * web-only for now, same as category management.
 */
export default function ConsolesScreen() {
  const consoles = useQuery({ queryKey: ["consoles"], queryFn: () => api.getConsoles() });

  return (
    <FlatList
      style={styles.screen}
      data={consoles.data ?? []}
      keyExtractor={(item) => item.platform.id}
      refreshControl={
        <RefreshControl refreshing={consoles.isRefetching} onRefresh={() => consoles.refetch()} />
      }
      contentContainerStyle={{ padding: 12, paddingBottom: 48 }}
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
      renderItem={({ item }) => <ConsoleCard row={item} />}
    />
  );
}

function ConsoleCard({ row }: { row: ConsoleSummary }) {
  const router = useRouter();
  const p = row.platform;
  const released = formatReleaseDate(p.releaseDate);
  const logo = resolveImage(p.logoUrl);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.logo}>
          {logo ? (
            <Image source={{ uri: logo }} style={styles.logoImage} resizeMode="contain" />
          ) : (
            <Text style={styles.logoFallback}>{p.abbreviation ?? p.name}</Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name}>{p.name}</Text>
          {released && <Text style={styles.released}>Released {released}</Text>}
          <Text style={styles.counts}>
            {row.gameCount} {row.gameCount === 1 ? "game" : "games"}
            {row.physicalCount > 0 && ` · 📦 ${row.physicalCount}`}
            {row.digitalCount > 0 && ` · 💾 ${row.digitalCount}`}
          </Text>
        </View>
      </View>

      {p.summary && <Text style={styles.summary}>{p.summary}</Text>}

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
                  <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  card: {
    backgroundColor: "#18181b",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 14,
    marginBottom: 10,
  },
  header: { flexDirection: "row", gap: 12, alignItems: "center" },
  logo: {
    width: 84,
    height: 56,
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
  name: { color: "#fafafa", fontSize: 16, fontWeight: "700" },
  released: { color: "#71717a", fontSize: 11, marginTop: 2 },
  counts: { color: "#a1a1aa", fontSize: 12, marginTop: 4 },
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
