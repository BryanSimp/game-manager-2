import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  boxSpecFor,
  caseColorFor,
  FAMILY_ACCENT,
  type ShelfEntry,
  type ShelfRow,
} from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage } from "@/lib/ui";

export default function ShelfScreen() {
  const shelf = useQuery({ queryKey: ["shelf"], queryFn: () => api.getShelf() });

  if (shelf.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const shelves = shelf.data ?? [];

  return (
    <FlatList
      style={styles.screen}
      data={shelves}
      keyExtractor={(row) => row.platform.id}
      contentContainerStyle={{ padding: 12, paddingBottom: 48 }}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Your shelf is empty</Text>
          <Text style={styles.emptyText}>
            Mark which platforms you own games on and they show up here.
          </Text>
        </View>
      }
      renderItem={({ item }) => <ShelfRowView row={item} />}
    />
  );
}

function ShelfRowView({ row }: { row: ShelfRow }) {
  const color = caseColorFor(row.platform.name, row.platform.family);
  const badge = FAMILY_ACCENT[row.platform.family];
  return (
    <View style={{ marginBottom: 22 }}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: badge }]}>
          <Text style={styles.badgeText}>{row.platform.abbreviation ?? row.platform.name}</Text>
        </View>
        <Text style={styles.headerTitle}>{row.platform.name}</Text>
        <Text style={styles.headerCount}>{row.entries.length}</Text>
      </View>
      <FlatList
        horizontal
        data={row.entries}
        keyExtractor={(e) => `${e.userGameId}-${e.format}`}
        showsHorizontalScrollIndicator={false}
        style={styles.rowBg}
        contentContainerStyle={{ padding: 10, gap: 10 }}
        renderItem={({ item }) => (
          <GameBox entry={item} caseColor={color} platformName={row.platform.name} />
        )}
      />
      <View style={styles.plank} />
    </View>
  );
}

const SHELF_BOX_H = 100;

function GameBox({
  entry,
  caseColor,
  platformName,
}: {
  entry: ShelfEntry;
  caseColor: string;
  platformName: string;
}) {
  const router = useRouter();
  const physical = entry.format === "physical";
  const cover = resolveImage(entry.coverSrc);
  const spec = boxSpecFor(platformName);
  const boxW = physical ? Math.round(SHELF_BOX_H * (spec.w / spec.h)) : 72;
  return (
    <TouchableOpacity
      style={{ width: boxW }}
      onPress={() => router.push(`/game/${entry.userGameId}`)}
    >
      <View
        style={[
          styles.box,
          { height: SHELF_BOX_H },
          physical
            ? {
                borderLeftWidth: Math.max(4, Math.round(SHELF_BOX_H * (spec.d / spec.h) * 0.6)),
                borderLeftColor: caseColor,
                borderRadius: 4,
              }
            : { borderRadius: 8, opacity: 0.9 },
        ]}
      >
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Text style={styles.boxFallback} numberOfLines={4}>
            {entry.title}
          </Text>
        )}
        {!physical && <Text style={styles.digitalBadge}>💾</Text>}
        {entry.status === "finished" && <Text style={styles.doneBadge}>✓</Text>}
      </View>
      <Text style={styles.boxTitle} numberOfLines={1}>
        {entry.title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#101014" },
  empty: { alignItems: "center", marginTop: 64, paddingHorizontal: 24 },
  emptyTitle: { color: "#fafafa", fontSize: 16, fontWeight: "600" },
  emptyText: { color: "#71717a", fontSize: 13, marginTop: 4, textAlign: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  headerTitle: { color: "#fafafa", fontSize: 15, fontWeight: "600", flex: 1 },
  headerCount: { color: "#71717a", fontSize: 13 },
  rowBg: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
  },
  plank: {
    height: 6,
    backgroundColor: "#3f3f46",
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    marginHorizontal: 2,
  },
  box: {
    backgroundColor: "#27272a",
    overflow: "hidden",
    justifyContent: "center",
  },
  boxFallback: {
    color: "#a1a1aa",
    fontSize: 9,
    fontWeight: "600",
    textAlign: "center",
    padding: 4,
  },
  digitalBadge: { position: "absolute", bottom: 2, right: 2, fontSize: 9 },
  doneBadge: {
    position: "absolute",
    top: 2,
    left: 2,
    color: "#34d399",
    fontSize: 10,
    fontWeight: "800",
  },
  boxTitle: { color: "#a1a1aa", fontSize: 10, marginTop: 3, textAlign: "center" },
});
