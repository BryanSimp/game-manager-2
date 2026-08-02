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
import { colors, radius, space, type } from "@/lib/theme";
import { Card, Chevron, Cover, EmptyState, Icon, type IconName } from "@/components/ui";

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
      contentContainerStyle={{ padding: space.md, paddingBottom: space.xxl + insets.bottom }}
      ListEmptyComponent={
        consoles.isLoading ? (
          <ActivityIndicator style={{ marginTop: 48 }} color={colors.accentBorder} />
        ) : (
          <EmptyState
            icon="game-controller-outline"
            title="No consoles yet"
            text="Add the consoles you own on the web app — they become the platforms you can file games under."
          />
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

function Stat({ icon, value }: { icon: IconName; value: number }) {
  return (
    <View style={styles.stat}>
      <Icon name={icon} size={12} color={colors.textFaint} />
      <Text style={type.micro}>{value}</Text>
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
    <Card
      onPress={() => router.push(`/console/${p.id}`)}
      accessibilityLabel={`${p.name}, ${row.gameCount} games`}
    >
      <View style={styles.header}>
        <View style={[styles.logo, compact && styles.logoCompact]}>
          {logo ? (
            <Image source={{ uri: logo }} style={styles.logoImage} resizeMode="contain" />
          ) : (
            <Text style={[type.micro, styles.logoFallback]} numberOfLines={2}>
              {p.abbreviation ?? p.name}
            </Text>
          )}
        </View>
        <View style={styles.headerBody}>
          <Text style={compact ? type.bodyStrong : type.heading} numberOfLines={2}>
            {p.name}
          </Text>
          {p.parentName && <Text style={type.micro}>{p.parentName} storefront</Text>}
          {released && !compact && <Text style={type.micro}>Released {released}</Text>}
          <View style={styles.stats}>
            <Text style={[type.caption, { color: colors.text }]}>
              {row.gameCount} {row.gameCount === 1 ? "game" : "games"}
            </Text>
            {row.storefrontCount > 0 && <Stat icon="storefront-outline" value={row.storefrontCount} />}
            {row.physicalCount > 0 && <Stat icon="cube-outline" value={row.physicalCount} />}
            {row.digitalCount > 0 && <Stat icon="cloud-download-outline" value={row.digitalCount} />}
          </View>
        </View>
        <Chevron />
      </View>

      {p.summary && !compact && (
        <Text style={[type.prose, { marginTop: space.md }]} numberOfLines={4}>
          {p.summary}
        </Text>
      )}

      {row.preview.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm, paddingTop: space.md }}
        >
          {row.preview.map((game) => (
            <Pressable
              key={game.entryId}
              accessibilityRole="button"
              accessibilityLabel={game.title}
              onPress={() => router.push(`/game/${game.entryId}`)}
            >
              <Cover src={resolveImage(game.coverSrc)} width={52} height={70} title={game.title} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  group: { marginBottom: space.md },
  // storefronts sit visibly under the platform they sell for
  storefront: { marginTop: 6, marginLeft: space.lg },
  header: { flexDirection: "row", gap: space.md, alignItems: "center" },
  headerBody: { flex: 1, minWidth: 0, gap: 2 },
  logo: {
    width: 76,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  logoCompact: { width: 56, height: 40 },
  logoImage: { width: "100%", height: "100%" },
  logoFallback: { color: colors.textGhost, textAlign: "center" },
  stats: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, marginTop: 3 },
  stat: { flexDirection: "row", alignItems: "center", gap: 3 },
});
