import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GAME_STATUSES, type ChecklistSummary, type UpdateEntryInput } from "@gm/shared";
import { api } from "@/lib/api";
import { formatHours, resolveImage, STATUS_COLORS } from "@/lib/ui";
import { colors, radius, space, type } from "@/lib/theme";
import {
  Button,
  Cover,
  Icon,
  Loading,
  ProgressBar,
  Screen,
  SectionTitle,
} from "@/components/ui";

const RATINGS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const entry = useQuery({ queryKey: ["entry", id], queryFn: () => api.getEntry(id) });
  const allTags = useQuery({ queryKey: ["tags"], queryFn: () => api.getTags() });

  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  useEffect(() => {
    if (entry.data && !notesDirty) setNotes(entry.data.notes ?? "");
  }, [entry.data, notesDirty]);

  const update = useMutation({
    mutationFn: (input: UpdateEntryInput) => api.updateEntry(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entry", id] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.removeEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      router.back();
    },
  });

  const setTags = useMutation({
    mutationFn: (tagIds: string[]) => api.setEntryTags(id, tagIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entry", id] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });

  if (entry.isLoading || !entry.data) return <Loading />;

  const e = entry.data;
  const cover = resolveImage(e.game.coverSrc);
  const ttbMain = formatHours(e.game.ttbMain);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl + insets.bottom }}>
        <View style={styles.header}>
          <View style={styles.cover}>
            {cover ? (
              <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <Icon name="game-controller-outline" size={28} color={colors.textGhost} />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
            <Text style={type.title}>{e.game.title}</Text>
            {e.game.releaseDate && (
              <View style={styles.metaItem}>
                <Icon name="calendar-outline" size={13} color={colors.textFaint} />
                <Text style={type.micro}>{e.game.releaseDate}</Text>
              </View>
            )}
            {ttbMain && (
              <View style={styles.metaItem}>
                <Icon name="time-outline" size={13} color={colors.textFaint} />
                <Text style={type.micro}>{ttbMain} main story</Text>
              </View>
            )}
            {e.platforms.length > 0 && (
              <View style={styles.platformWrap}>
                {e.platforms.map((p) => (
                  <View key={`${p.platformId}-${p.format}`} style={styles.platformTag}>
                    <Icon
                      name={p.format === "physical" ? "cube-outline" : "cloud-download-outline"}
                      size={11}
                      color={colors.textMuted}
                    />
                    <Text style={type.micro} numberOfLines={1}>
                      {p.abbreviation ?? p.name}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        <SectionTitle>Status</SectionTitle>
        <View style={styles.chips}>
          {GAME_STATUSES.map((s) => {
            const meta = STATUS_COLORS[s];
            const active = e.status === s;
            return (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && { backgroundColor: meta.bg, borderColor: meta.text }]}
                onPress={() => update.mutate({ status: s })}
              >
                <Text style={[type.caption, active && { color: meta.text }]}>{meta.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <SectionTitle>Rating</SectionTitle>
        <View style={styles.chips}>
          {RATINGS.map((r) => {
            const active = e.rating === r;
            return (
              <Pressable
                key={r}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.ratingChip, active && styles.ratingActive]}
                onPress={() => update.mutate({ rating: active ? null : r })}
              >
                <Icon name="star" size={12} color={active ? colors.star : colors.textGhost} />
                <Text style={[type.caption, active && { color: colors.star }]}>{r}</Text>
              </Pressable>
            );
          })}
        </View>

        {(allTags.data?.length ?? 0) > 0 && (
          <>
            <SectionTitle>Tags</SectionTitle>
            <View style={styles.chips}>
              {(allTags.data ?? []).map((t) => {
                const active = e.tags.some((et) => et.id === t.id);
                const color = t.color ?? colors.textFaint;
                return (
                  <Pressable
                    key={t.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.chip, active && { backgroundColor: `${color}26`, borderColor: color }]}
                    onPress={() => {
                      const current = e.tags.map((et) => et.id);
                      setTags.mutate(
                        active ? current.filter((tid) => tid !== t.id) : [...current, t.id],
                      );
                    }}
                  >
                    <Text style={[type.caption, active && { color }]}>{t.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {e.game.summary && (
          <>
            <SectionTitle>About</SectionTitle>
            <Text style={type.prose}>{e.game.summary}</Text>
          </>
        )}

        <SectionTitle>Notes</SectionTitle>
        <TextInput
          style={[styles.notes, type.body]}
          value={notes}
          onChangeText={(v) => {
            setNotes(v);
            setNotesDirty(true);
          }}
          multiline
          placeholder="Your notes…"
          placeholderTextColor={colors.textFaint}
        />
        {notesDirty && (
          <Button
            label="Save notes"
            icon="save-outline"
            fill
            style={{ marginTop: space.sm }}
            busy={update.isPending}
            onPress={() => {
              update.mutate({ notes });
              setNotesDirty(false);
            }}
          />
        )}

        <ProgressSection entryId={id} gameId={e.game.id} />
        <AchievementsSection entryId={id} />
        <ChecklistsSection gameId={e.game.id} />

        <Button
          label="Remove from library"
          tone="danger"
          icon="trash-outline"
          fill
          style={{ marginTop: space.xxl }}
          onPress={() =>
            Alert.alert("Remove game", `Remove "${e.game.title}" from your library?`, [
              { text: "Cancel", style: "cancel" },
              { text: "Remove", style: "destructive", onPress: () => remove.mutate() },
            ])
          }
        />
      </ScrollView>
    </Screen>
  );
}

/**
 * Mission progress + estimated time left. Read-only apart from ticking
 * missions off — building the list is web-first, like checklist authoring.
 */
function ProgressSection({ entryId, gameId }: { entryId: string; gameId: string }) {
  const progress = useQuery({
    queryKey: ["progress", entryId],
    queryFn: () => api.getEntryProgress(entryId),
  });
  const lists = useQuery({
    queryKey: ["checklists", gameId],
    queryFn: () => api.getGameChecklists(gameId),
  });

  const p = progress.data;
  const missionList = lists.data?.mine.find((c) => c.kind === "missions");
  // side quests are tracked but untimed, so they show up even with no estimate
  const sideList = lists.data?.mine.find((c) => c.kind === "side_quests");
  if (!missionList && !sideList) return null;
  const remaining = p ? formatHours(p.remainingSeconds) : null;

  return (
    <>
      <SectionTitle>Progress</SectionTitle>
      {p && p.total > 0 && (
        <View style={{ marginBottom: space.md }}>
          <Text style={[type.caption, { marginBottom: 6 }]}>
            {remaining ? `${remaining} left · ` : ""}
            {p.done}/{p.total} missions ({p.percent}%)
          </Text>
          <ProgressBar percent={p.percent} />
        </View>
      )}
      {missionList && <ChecklistCard summary={missionList} gameId={gameId} />}
      {sideList && <ChecklistCard summary={sideList} gameId={gameId} />}
    </>
  );
}

function AchievementsSection({ entryId }: { entryId: string }) {
  const achievements = useQuery({
    queryKey: ["achievements", entryId],
    queryFn: () => api.getEntryAchievements(entryId),
  });
  const data = achievements.data;
  if (!data || (data.total === 0 && data.steamPlaytimeMinutes == null)) return null;
  const pct = data.total > 0 ? Math.round((data.unlocked / data.total) * 100) : 0;

  return (
    <>
      <SectionTitle>
        Steam
        {data.steamPlaytimeMinutes != null && data.steamPlaytimeMinutes > 0
          ? ` · ${Math.round((data.steamPlaytimeMinutes / 60) * 10) / 10}h played`
          : ""}
      </SectionTitle>
      {data.total > 0 && (
        <>
          <Text style={[type.caption, { marginBottom: 6 }]}>
            {data.unlocked}/{data.total} achievements ({pct}%)
          </Text>
          <ProgressBar percent={pct} />
          <View style={styles.achievementGrid}>
            {data.achievements.map((a) => {
              const icon = a.unlocked ? a.iconUrl : (a.iconGrayUrl ?? a.iconUrl);
              return (
                <View key={a.id} style={[styles.achievementIcon, !a.unlocked && { opacity: 0.35 }]}>
                  {icon && (
                    <Image source={{ uri: icon }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  )}
                </View>
              );
            })}
          </View>
        </>
      )}
    </>
  );
}

function ChecklistsSection({ gameId }: { gameId: string }) {
  const queryClient = useQueryClient();
  const lists = useQuery({
    queryKey: ["checklists", gameId],
    queryFn: () => api.getGameChecklists(gameId),
  });
  const adopt = useMutation({
    mutationFn: (id: string) => api.adoptChecklist(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["checklists", gameId] }),
  });

  const data = lists.data;
  // mission lists render in ProgressSection alongside their time estimate
  const mine = data?.mine.filter((c) => c.kind === "completion") ?? [];
  const shared = data?.public.filter((c) => c.kind === "completion") ?? [];
  if (mine.length === 0 && shared.length === 0) return null;

  return (
    <>
      <SectionTitle>Checklists</SectionTitle>
      {mine.map((c) => (
        <ChecklistCard key={c.id} summary={c} gameId={gameId} />
      ))}
      {shared.map((c) => (
        <View key={c.id} style={styles.checklistCard}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={type.bodyStrong} numberOfLines={2}>
              {c.title}
            </Text>
            <Text style={type.micro}>
              {c.itemCount} items{c.authorName ? ` · by ${c.authorName}` : ""}
            </Text>
          </View>
          <Button
            label="Adopt"
            tone="ghost"
            busy={adopt.isPending}
            onPress={() => adopt.mutate(c.id)}
            style={styles.adoptBtn}
          />
        </View>
      ))}
    </>
  );
}

function ChecklistCard({ summary, gameId }: { summary: ChecklistSummary; gameId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["checklist", summary.id],
    queryFn: () => api.getChecklist(summary.id),
    enabled: open,
  });
  // same rule as web: on a sequential list, ticking an entry fills in the ones
  // before it; unticking only clears the one you tapped
  const check = useMutation({
    mutationFn: async ({
      itemId,
      completed,
      index,
    }: {
      itemId: string;
      completed: boolean;
      index: number;
    }) => {
      const items = detail.data?.items ?? [];
      if (summary.sequential && completed) {
        const through = items.slice(0, index + 1).filter((it) => !it.completedAt);
        if (through.length > 1) {
          await api.checkChecklistItems(
            summary.id,
            through.map((it) => it.id),
            true,
          );
          return;
        }
      }
      await api.checkChecklistItem(itemId, completed);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist", summary.id] });
      queryClient.invalidateQueries({ queryKey: ["checklists", gameId] });
      // ticking a mission moves the time-remaining estimate
      queryClient.invalidateQueries({ queryKey: ["progress"] });
    },
  });
  const pct = summary.itemCount > 0 ? Math.round((summary.doneCount / summary.itemCount) * 100) : 0;

  return (
    <View style={styles.checklistCardCol}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.checklistHeader}
        onPress={() => setOpen(!open)}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.bodyStrong} numberOfLines={2}>
            {summary.title}
          </Text>
          <Text style={type.micro}>
            {summary.doneCount}/{summary.itemCount}
          </Text>
        </View>
        <ProgressBar percent={pct} width={72} />
        <Icon name={open ? "chevron-down" : "chevron-forward"} size={16} color={colors.textGhost} />
      </Pressable>
      {open &&
        (detail.data?.items ?? []).map((item, i) => (
          <Pressable
            key={item.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!item.completedAt }}
            style={styles.checkRow}
            onPress={() => check.mutate({ itemId: item.id, completed: !item.completedAt, index: i })}
          >
            <Icon
              name={item.completedAt ? "checkbox" : "square-outline"}
              size={18}
              color={item.completedAt ? colors.accentBorder : colors.textGhost}
            />
            <Text
              style={[type.caption, { flex: 1 }, item.completedAt && styles.checkTextDone]}
              numberOfLines={2}
            >
              {item.category ? `${item.category} · ` : ""}
              {item.text}
            </Text>
          </Pressable>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: space.lg },
  cover: {
    width: 100,
    height: 133,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  platformWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  platformTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 3,
    maxWidth: 150,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    justifyContent: "center",
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.md,
  },
  ratingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minHeight: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.sm + 2,
  },
  ratingActive: { backgroundColor: "#451a03", borderColor: colors.star },
  notes: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: space.md,
    color: colors.text,
    minHeight: 96,
    textAlignVertical: "top",
  },
  achievementGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.md },
  achievementIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  checklistCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginBottom: space.sm,
  },
  checklistCardCol: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginBottom: space.sm,
  },
  checklistHeader: { flexDirection: "row", alignItems: "center", gap: space.md },
  adoptBtn: { minHeight: 36, paddingHorizontal: space.md },
  checkRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 7 },
  checkTextDone: { color: colors.textGhost, textDecorationLine: "line-through" },
});
