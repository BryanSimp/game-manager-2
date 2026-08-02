import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GAME_STATUSES, type ChecklistSummary, type UpdateEntryInput } from "@gm/shared";
import { api } from "@/lib/api";
import { formatHours, resolveImage, STATUS_COLORS } from "@/lib/ui";

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

  if (entry.isLoading || !entry.data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const e = entry.data;
  const cover = resolveImage(e.game.coverSrc);
  const ttbMain = formatHours(e.game.ttbMain);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
    >
      <View style={styles.header}>
        <View style={styles.cover}>
          {cover && <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{e.game.title}</Text>
          {e.game.releaseDate && <Text style={styles.subtle}>Released {e.game.releaseDate}</Text>}
          {ttbMain && <Text style={styles.subtle}>⏱ {ttbMain} main story</Text>}
          {e.platforms.length > 0 && (
            <Text style={styles.subtle}>
              {e.platforms
                .map((p) => `${p.abbreviation ?? p.name} ${p.format === "physical" ? "📦" : "💾"}`)
                .join(" · ")}
            </Text>
          )}
        </View>
      </View>

      <Text style={styles.section}>Status</Text>
      <View style={styles.chips}>
        {GAME_STATUSES.map((s) => {
          const meta = STATUS_COLORS[s];
          const active = e.status === s;
          return (
            <TouchableOpacity
              key={s}
              style={[styles.chip, active && { backgroundColor: meta.bg, borderColor: meta.text }]}
              onPress={() => update.mutate({ status: s })}
            >
              <Text style={[styles.chipText, active && { color: meta.text }]}>{meta.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.section}>Rating</Text>
      <View style={styles.chips}>
        {RATINGS.map((r) => {
          const active = e.rating === r;
          return (
            <TouchableOpacity
              key={r}
              style={[styles.ratingChip, active && styles.ratingActive]}
              onPress={() => update.mutate({ rating: active ? null : r })}
            >
              <Text style={[styles.chipText, active && { color: "#fbbf24" }]}>{r}★</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {(allTags.data?.length ?? 0) > 0 && (
        <>
          <Text style={styles.section}>Tags</Text>
          <View style={styles.chips}>
            {(allTags.data ?? []).map((t) => {
              const active = e.tags.some((et) => et.id === t.id);
              const color = t.color ?? "#71717a";
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    styles.chip,
                    active && { backgroundColor: `${color}26`, borderColor: color },
                  ]}
                  onPress={() => {
                    const current = e.tags.map((et) => et.id);
                    setTags.mutate(
                      active ? current.filter((tid) => tid !== t.id) : [...current, t.id],
                    );
                  }}
                >
                  <Text style={[styles.chipText, active && { color }]}>{t.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {e.game.summary && (
        <>
          <Text style={styles.section}>About</Text>
          <Text style={styles.summary}>{e.game.summary}</Text>
        </>
      )}

      <Text style={styles.section}>Notes</Text>
      <TextInput
        style={styles.notes}
        value={notes}
        onChangeText={(v) => {
          setNotes(v);
          setNotesDirty(true);
        }}
        multiline
        placeholder="Your notes…"
        placeholderTextColor="#71717a"
      />
      {notesDirty && (
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => {
            update.mutate({ notes });
            setNotesDirty(false);
          }}
        >
          <Text style={styles.saveText}>Save notes</Text>
        </TouchableOpacity>
      )}

      <ProgressSection entryId={id} gameId={e.game.id} />
      <AchievementsSection entryId={id} />
      <ChecklistsSection gameId={e.game.id} />

      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={() =>
          Alert.alert("Remove game", `Remove "${e.game.title}" from your library?`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => remove.mutate() },
          ])
        }
      >
        <Text style={styles.deleteText}>Remove from library</Text>
      </TouchableOpacity>
    </ScrollView>
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
      <Text style={styles.section}>Progress</Text>
      {p && p.total > 0 && (
        <>
          <Text style={styles.achievementCount}>
            {remaining ? `${remaining} left · ` : ""}
            {p.done}/{p.total} missions ({p.percent}%)
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${p.percent}%` }]} />
          </View>
        </>
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
      <Text style={styles.section}>
        Steam{" "}
        {data.steamPlaytimeMinutes != null && data.steamPlaytimeMinutes > 0
          ? `· ${Math.round((data.steamPlaytimeMinutes / 60) * 10) / 10}h played`
          : ""}
      </Text>
      {data.total > 0 && (
        <>
          <Text style={styles.achievementCount}>
            {data.unlocked}/{data.total} achievements ({pct}%)
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <View style={styles.achievementGrid}>
            {data.achievements.map((a) => {
              const icon = a.unlocked ? a.iconUrl : (a.iconGrayUrl ?? a.iconUrl);
              return (
                <View
                  key={a.id}
                  style={[styles.achievementIcon, !a.unlocked && { opacity: 0.35 }]}
                >
                  {icon && (
                    <Image
                      source={{ uri: icon }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                    />
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
      <Text style={styles.section}>Checklists</Text>
      {mine.map((c) => (
        <ChecklistCard key={c.id} summary={c} gameId={gameId} />
      ))}
      {shared.map((c) => (
        <View key={c.id} style={styles.checklistCard}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.checklistTitle} numberOfLines={1}>
              {c.title}
            </Text>
            <Text style={styles.checklistMeta}>
              {c.itemCount} items{c.authorName ? ` · by ${c.authorName}` : ""}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.adoptBtn}
            disabled={adopt.isPending}
            onPress={() => adopt.mutate(c.id)}
          >
            <Text style={styles.adoptText}>Adopt</Text>
          </TouchableOpacity>
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
      <TouchableOpacity style={styles.checklistHeader} onPress={() => setOpen(!open)}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.checklistTitle} numberOfLines={1}>
            {summary.title}
          </Text>
          <Text style={styles.checklistMeta}>
            {summary.doneCount}/{summary.itemCount}
          </Text>
        </View>
        <View style={[styles.progressTrack, { width: 72, marginTop: 0 }]}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.chevron}>{open ? "▾" : "▸"}</Text>
      </TouchableOpacity>
      {open &&
        (detail.data?.items ?? []).map((item, i) => (
          <TouchableOpacity
            key={item.id}
            style={styles.checkRow}
            onPress={() =>
              check.mutate({ itemId: item.id, completed: !item.completedAt, index: i })
            }
          >
            <Text style={styles.checkBox}>{item.completedAt ? "☑" : "☐"}</Text>
            <Text
              style={[styles.checkText, item.completedAt ? styles.checkTextDone : null]}
              numberOfLines={2}
            >
              {item.category ? `${item.category} · ` : ""}
              {item.text}
            </Text>
          </TouchableOpacity>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#101014" },
  header: { flexDirection: "row", gap: 14 },
  cover: { width: 96, height: 128, borderRadius: 10, backgroundColor: "#27272a", overflow: "hidden" },
  title: { color: "#fafafa", fontSize: 20, fontWeight: "700" },
  subtle: { color: "#71717a", fontSize: 12, marginTop: 4 },
  section: { color: "#d4d4d8", fontSize: 14, fontWeight: "600", marginTop: 20, marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3f3f46",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { color: "#a1a1aa", fontSize: 13, fontWeight: "500" },
  ratingChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3f3f46",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ratingActive: { backgroundColor: "#451a03", borderColor: "#fbbf24" },
  summary: { color: "#a1a1aa", fontSize: 13, lineHeight: 20 },
  notes: {
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 10,
    padding: 12,
    color: "#fafafa",
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: "top",
  },
  saveBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 10,
  },
  saveText: { color: "#fff", fontWeight: "600" },
  deleteBtn: {
    borderWidth: 1,
    borderColor: "#7f1d1d",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 28,
  },
  deleteText: { color: "#f87171", fontWeight: "600" },
  achievementCount: { color: "#a1a1aa", fontSize: 12, marginBottom: 6 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#27272a",
    overflow: "hidden",
    marginTop: 2,
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: "#10b981" },
  achievementGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  achievementIcon: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: "#27272a",
    overflow: "hidden",
  },
  checklistCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 12,
    marginBottom: 8,
  },
  checklistCardCol: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 12,
    marginBottom: 8,
  },
  checklistHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  checklistTitle: { color: "#fafafa", fontSize: 14, fontWeight: "600" },
  checklistMeta: { color: "#71717a", fontSize: 11, marginTop: 2 },
  adoptBtn: {
    borderWidth: 1,
    borderColor: "#818cf8",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  adoptText: { color: "#a5b4fc", fontSize: 12, fontWeight: "600" },
  chevron: { color: "#52525b", fontSize: 16 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  checkBox: { color: "#818cf8", fontSize: 16 },
  checkText: { color: "#d4d4d8", fontSize: 13, flex: 1 },
  checkTextDone: { color: "#52525b", textDecorationLine: "line-through" },
});
