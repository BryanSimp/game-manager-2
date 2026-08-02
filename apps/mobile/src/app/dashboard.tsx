import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { GAME_STATUSES } from "@gm/shared";
import { api } from "@/lib/api";
import { formatHours, resolveImage, STATUS_COLORS } from "@/lib/ui";
import { colors, radius, space, type } from "@/lib/theme";
import { Cover, Icon, Loading, ProgressBar, Screen, SectionTitle } from "@/components/ui";

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api.getDashboard() });

  if (dashboard.isLoading || !dashboard.data) return <Loading />;

  const d = dashboard.data;
  const backlogHours = formatHours(d.backlogSeconds);
  const busiest = Math.max(1, ...d.platformCounts.map((p) => p.count));

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl + insets.bottom }}>
        <View style={styles.tileRow}>
          <View style={styles.tile}>
            <Icon name="library-outline" size={18} color={colors.accentBorder} />
            <Text style={type.display} numberOfLines={1} adjustsFontSizeToFit>
              {d.total}
            </Text>
            <Text style={type.caption}>games</Text>
          </View>
          <View style={styles.tile}>
            <Icon name="time-outline" size={18} color={colors.accentBorder} />
            <Text style={type.display} numberOfLines={1} adjustsFontSizeToFit>
              {backlogHours ?? "—"}
            </Text>
            <Text style={type.caption}>backlog time</Text>
          </View>
        </View>

        {/* seven categories at a fifth of the width each clipped "Uncategorized"
            to "Uncateg…" — three per row, and the label shrinks rather than cuts */}
        <View style={styles.statusGrid}>
          {GAME_STATUSES.map((s) => {
            const meta = STATUS_COLORS[s];
            return (
              <View key={s} style={[styles.statusTile, { backgroundColor: meta.bg }]}>
                <Text style={[type.heading, { color: meta.text }]}>{d.statusCounts[s] ?? 0}</Text>
                <Text
                  style={[type.micro, { color: meta.text, textAlign: "center" }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {meta.label}
                </Text>
              </View>
            );
          })}
        </View>

        {d.platformCounts.length > 0 && (
          <>
            <SectionTitle>By platform</SectionTitle>
            {d.platformCounts.map((p) => (
              <View key={p.name} style={styles.platformRow}>
                <Text style={[type.caption, styles.platformName]} numberOfLines={1}>
                  {p.abbreviation ?? p.name}
                </Text>
                <View style={{ flex: 1 }}>
                  <ProgressBar
                    percent={Math.max(4, (p.count / busiest) * 100)}
                    color={colors.accent}
                  />
                </View>
                <Text style={[type.caption, styles.platformCount]}>{p.count}</Text>
              </View>
            ))}
          </>
        )}

        {d.recentlyFinished.length > 0 && (
          <>
            <SectionTitle>Recently finished</SectionTitle>
            {d.recentlyFinished.map((g) => (
              <View key={g.id} style={styles.recentRow}>
                <Cover src={resolveImage(g.coverSrc)} width={38} height={50} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={type.bodyStrong} numberOfLines={2}>
                    {g.title}
                  </Text>
                  <View style={styles.recentMeta}>
                    {g.finishedAt && <Text style={type.micro}>{g.finishedAt.slice(0, 10)}</Text>}
                    {g.rating != null && (
                      <View style={styles.metaItem}>
                        <Icon name="star" size={11} color={colors.star} />
                        <Text style={[type.micro, { color: colors.star }]}>{g.rating}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tileRow: { flexDirection: "row", gap: space.sm, marginBottom: space.sm },
  tile: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: space.lg,
    paddingHorizontal: space.sm,
  },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  statusTile: {
    flexGrow: 1,
    flexBasis: "28%",
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  platformRow: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.sm },
  platformName: { width: 76 },
  platformCount: { width: 30, textAlign: "right", color: colors.text, fontWeight: "700" },
  recentRow: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.md },
  recentMeta: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: 3 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
});
