import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { GAME_STATUSES } from "@gm/shared";
import { api } from "@/lib/api";
import { formatHours, resolveImage, STATUS_COLORS } from "@/lib/ui";

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api.getDashboard() });

  if (dashboard.isLoading || !dashboard.data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const d = dashboard.data;
  const backlogHours = formatHours(d.backlogSeconds);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}
    >
      <View style={styles.tileRow}>
        <View style={styles.tile}>
          <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
            {d.total}
          </Text>
          <Text style={styles.tileLabel}>games</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
            {backlogHours ?? "—"}
          </Text>
          <Text style={styles.tileLabel}>backlog time</Text>
        </View>
      </View>

      {/* seven categories at a fifth of the width each clipped "Uncategorized"
          to "Uncateg…" — three per row, and the label shrinks rather than cuts */}
      <View style={styles.statusGrid}>
        {GAME_STATUSES.map((s) => {
          const meta = STATUS_COLORS[s];
          return (
            <View key={s} style={[styles.statusTile, { backgroundColor: meta.bg }]}>
              <Text style={[styles.statusValue, { color: meta.text }]}>
                {d.statusCounts[s] ?? 0}
              </Text>
              <Text
                style={[styles.statusLabel, { color: meta.text }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {meta.label}
              </Text>
            </View>
          );
        })}
      </View>

      {d.platformCounts.length > 0 && (
        <>
          <Text style={styles.section}>By platform</Text>
          {d.platformCounts.map((p) => (
            <View key={p.name} style={styles.platformRow}>
              <Text style={styles.platformName} numberOfLines={1}>
                {p.abbreviation ?? p.name}
              </Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.max(
                        4,
                        (p.count / Math.max(...d.platformCounts.map((x) => x.count))) * 100,
                      )}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.platformCount}>{p.count}</Text>
            </View>
          ))}
        </>
      )}

      {d.recentlyFinished.length > 0 && (
        <>
          <Text style={styles.section}>Recently finished</Text>
          {d.recentlyFinished.map((g) => {
            const cover = resolveImage(g.coverSrc);
            return (
              <View key={g.id} style={styles.recentRow}>
                <View style={styles.cover}>
                  {cover && (
                    <Image
                      source={{ uri: cover }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                    />
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.recentTitle} numberOfLines={1}>
                    {g.title}
                  </Text>
                  <Text style={styles.recentMeta}>
                    {g.finishedAt ? g.finishedAt.slice(0, 10) : ""}
                    {g.rating != null ? `  ·  ★ ${g.rating}` : ""}
                  </Text>
                </View>
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#101014" },
  tileRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  tile: {
    flex: 1,
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
  },
  tileValue: { color: "#fafafa", fontSize: 24, fontWeight: "800" },
  tileLabel: { color: "#71717a", fontSize: 12, marginTop: 2 },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  statusTile: {
    flexGrow: 1,
    flexBasis: "28%",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  statusValue: { fontSize: 17, fontWeight: "800" },
  statusLabel: { fontSize: 11, fontWeight: "600", marginTop: 1, textAlign: "center" },
  section: { color: "#d4d4d8", fontSize: 14, fontWeight: "600", marginTop: 20, marginBottom: 10 },
  platformRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  platformName: { color: "#a1a1aa", fontSize: 12, width: 72 },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#27272a",
    overflow: "hidden",
  },
  barFill: { height: 8, borderRadius: 4, backgroundColor: "#4f46e5" },
  platformCount: { color: "#fafafa", fontSize: 12, fontWeight: "700", width: 28, textAlign: "right" },
  recentRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  cover: { width: 38, height: 50, borderRadius: 5, backgroundColor: "#27272a", overflow: "hidden" },
  recentTitle: { color: "#fafafa", fontSize: 14, fontWeight: "600" },
  recentMeta: { color: "#71717a", fontSize: 11, marginTop: 2 },
});
