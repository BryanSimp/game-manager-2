import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
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
import * as ImagePicker from "expo-image-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GAME_STATUSES,
  type ChecklistSummary,
  type LibraryEntry,
  type UpdateEntryInput,
} from "@gm/shared";
import { api } from "@/lib/api";
import { formatHours, resolveImage, STATUS_COLORS } from "@/lib/ui";
import { colors, radius, space, type } from "@/lib/theme";
import {
  Button,
  Icon,
  Loading,
  ProgressBar,
  Screen,
  SectionTitle,
  Sheet,
  SheetSection,
  StarRating,
  VoteRow,
} from "@/components/ui";

/** seconds → the hours string the play-time editor shows, e.g. 5400 → "1.5" */
function toHours(seconds: number | null): string {
  if (!seconds) return "";
  return String(Math.round((seconds / 3600) * 10) / 10);
}

/** "" clears the figure; anything unparseable counts as cleared too. */
function toSeconds(hours: string): number | null {
  const value = Number(hours.trim());
  if (!hours.trim() || Number.isNaN(value) || value <= 0) return null;
  return Math.round(value * 3600);
}

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const entry = useQuery({ queryKey: ["entry", id], queryFn: () => api.getEntry(id) });
  const allTags = useQuery({ queryKey: ["tags"], queryFn: () => api.getTags() });

  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change cover art"
            style={styles.cover}
            onPress={() => setCoverOpen(true)}
          >
            {cover ? (
              <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <Icon name="game-controller-outline" size={28} color={colors.textGhost} />
            )}
            <View style={styles.coverEdit}>
              <Icon name="image-outline" size={13} color={colors.text} />
              <Text style={[type.micro, { color: colors.text }]}>Cover</Text>
            </View>
          </Pressable>
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
        <View style={styles.ratingRow}>
          <StarRating value={e.rating} onChange={(rating) => update.mutate({ rating })} />
          {e.rating != null && (
            <Text style={[type.caption, { color: colors.star }]}>{e.rating.toFixed(1)}</Text>
          )}
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

        <TimeToBeatSection entry={e} />
        <ProgressSection entryId={id} gameId={e.game.id} />
        <AchievementsSection entryId={id} />

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

      <CoverSheet
        entryId={id}
        gameTitle={e.game.title}
        hasCustomCover={e.hasCustomCover}
        visible={coverOpen}
        onClose={() => setCoverOpen(false)}
      />
    </Screen>
  );
}

/**
 * How long to beat, editable. IGDB doesn't have times for everything and isn't
 * always right; the figures belong to the game rather than to your copy of it,
 * so saving writes the shared catalog row (see the API route).
 */
function TimeToBeatSection({ entry }: { entry: LibraryEntry }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [main, setMain] = useState("");
  const [extra, setExtra] = useState("");
  const [full, setFull] = useState("");

  const g = entry.game;
  const hasAny = g.ttbMain != null || g.ttbMainExtra != null || g.ttbCompletionist != null;

  function startEditing() {
    setMain(toHours(g.ttbMain));
    setExtra(toHours(g.ttbMainExtra));
    setFull(toHours(g.ttbCompletionist));
    setEditing(true);
  }

  const save = useMutation({
    mutationFn: () =>
      api.saveTimeToBeat(entry.id, {
        ttbMain: toSeconds(main),
        ttbMainExtra: toSeconds(extra),
        ttbCompletionist: toSeconds(full),
      }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["entry", entry.id] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["progress"] });
    },
  });

  if (!hasAny && !editing) {
    return (
      <>
        <SectionTitle>Play time</SectionTitle>
        <View style={styles.ttbCard}>
          <Text style={type.caption}>IGDB has no play time for this game.</Text>
          <Button
            label="Add play time"
            icon="add"
            tone="ghost"
            fill
            style={{ marginTop: space.md }}
            onPress={startEditing}
          />
        </View>
      </>
    );
  }

  return (
    <>
      <SectionTitle>Play time</SectionTitle>
      <View style={styles.ttbCard}>
        {editing ? (
          <>
            <HoursField label="Main story" value={main} onChange={setMain} />
            <HoursField label="Main + extras" value={extra} onChange={setExtra} />
            <HoursField label="Completionist" value={full} onChange={setFull} />
            <Text style={[type.micro, { marginTop: space.sm }]}>
              Hours. Leave a field empty to clear it — these are shared, so the correction applies
              wherever the game appears.
            </Text>
            {save.isError && (
              <Text style={[type.caption, { color: colors.danger, marginTop: space.xs }]}>
                {save.error instanceof Error ? save.error.message : "Couldn't save"}
              </Text>
            )}
            <View style={styles.ttbButtons}>
              <Button
                label="Save"
                icon="checkmark"
                fill
                busy={save.isPending}
                onPress={() => save.mutate()}
              />
              <Button label="Cancel" tone="ghost" onPress={() => setEditing(false)} />
            </View>
          </>
        ) : (
          <>
            <TtbRow label="Main story" value={formatHours(g.ttbMain)} />
            <TtbRow label="Main + extras" value={formatHours(g.ttbMainExtra)} />
            <TtbRow label="Completionist" value={formatHours(g.ttbCompletionist)} />
            <View style={styles.ttbFooter}>
              <Text style={type.micro}>
                {g.ttbSource === "manual" ? "Set by hand" : "From IGDB"}
              </Text>
              <Button
                label="Edit"
                icon="create-outline"
                tone="ghost"
                onPress={startEditing}
                style={styles.ttbEditBtn}
              />
            </View>
          </>
        )}
      </View>
    </>
  );
}

function TtbRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.ttbRow}>
      <Text style={type.caption}>{label}</Text>
      <Text style={type.bodyStrong}>{value}</Text>
    </View>
  );
}

function HoursField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.ttbRow}>
      <Text style={type.caption}>{label}</Text>
      <View style={styles.hoursWrap}>
        <TextInput
          style={[styles.hoursInput, type.body]}
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder="—"
          placeholderTextColor={colors.textFaint}
          textAlign="right"
        />
        <Text style={type.caption}>h</Text>
      </View>
    </View>
  );
}

/**
 * Cover art: browse SteamGridDB, or upload your own. Both already existed on
 * the web app and in the shared API client — mobile just had no way in.
 */
function CoverSheet({
  entryId,
  gameTitle,
  hasCustomCover,
  visible,
  onClose,
}: {
  entryId: string;
  gameTitle: string;
  hasCustomCover: boolean;
  visible: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const options = useQuery({
    queryKey: ["cover-options", entryId],
    queryFn: () => api.getCoverOptions(entryId),
    enabled: visible,
  });

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ["entry", entryId] });
    queryClient.invalidateQueries({ queryKey: ["library"] });
    onClose();
  };

  const pickFromUrl = useMutation({
    mutationFn: (url: string) => api.setCoverFromUrl(entryId, url),
    onSuccess: done,
  });
  const removeCover = useMutation({ mutationFn: () => api.removeCover(entryId), onSuccess: done });
  const upload = useMutation({
    mutationFn: async () => {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (picked.canceled || !picked.assets[0]) return null;
      const asset = picked.assets[0];
      const blob = await (await fetch(asset.uri)).blob();
      return api.uploadCover(entryId, blob, asset.fileName ?? "cover.jpg");
    },
    onSuccess: (res) => {
      if (res) done();
    },
  });

  const busy = pickFromUrl.isPending || upload.isPending || removeCover.isPending;

  return (
    <Sheet visible={visible} title="Cover art" onClose={onClose}>
      <Button
        label="Upload from my photos"
        icon="cloud-upload-outline"
        fill
        busy={upload.isPending}
        onPress={() => upload.mutate()}
      />
      {hasCustomCover && (
        <Button
          label="Reset to the original"
          icon="refresh-outline"
          tone="ghost"
          fill
          style={{ marginTop: space.sm }}
          busy={removeCover.isPending}
          onPress={() => removeCover.mutate()}
        />
      )}

      <SheetSection label="Browse SteamGridDB" />
      {options.isLoading && <ActivityIndicator color={colors.accentBorder} />}
      {options.data && !options.data.configured && (
        <Text style={type.caption}>
          No SteamGridDB key configured — an admin can add one in web Settings.
        </Text>
      )}
      {options.data?.configured && options.data.covers.length === 0 && (
        <Text style={type.caption}>No covers found for “{gameTitle}”.</Text>
      )}
      <View style={styles.coverGrid}>
        {(options.data?.covers ?? []).map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityLabel="Use this cover"
            disabled={busy}
            style={({ pressed }) => [styles.coverOption, pressed && { opacity: 0.6 }]}
            onPress={() => pickFromUrl.mutate(c.url)}
          >
            <Image source={{ uri: c.thumbUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          </Pressable>
        ))}
      </View>
      {(pickFromUrl.isError || upload.isError) && (
        <Text style={[type.caption, { color: colors.danger, marginTop: space.sm }]}>
          Couldn't set that cover.
        </Text>
      )}
    </Sheet>
  );
}

/**
 * Every list you keep for this game, plus the time estimate the main story
 * one drives, plus other people's published lists to copy.
 *
 * Read-only apart from ticking entries off, voting and copying — building and
 * editing a list stays web-first.
 */
function ProgressSection({ entryId, gameId }: { entryId: string; gameId: string }) {
  const queryClient = useQueryClient();
  const progress = useQuery({
    queryKey: ["progress", entryId],
    queryFn: () => api.getEntryProgress(entryId),
  });
  const lists = useQuery({
    queryKey: ["checklists", gameId],
    queryFn: () => api.getGameChecklists(gameId),
  });

  const adopt = useMutation({
    mutationFn: (id: string) => api.adoptChecklist(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["checklists", gameId] }),
    onError: (err: Error) => Alert.alert("Couldn't save a copy", err.message),
  });
  const vote = useMutation({
    mutationFn: ({ id, value }: { id: string; value: 1 | 0 | -1 }) => api.voteChecklist(id, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["checklists", gameId] }),
  });

  const p = progress.data;
  // already ordered by position, main story first
  const mine = lists.data?.mine ?? [];
  const shared = lists.data?.public ?? [];
  if (mine.length === 0 && shared.length === 0) return null;
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
      {mine.map((c) => (
        <ChecklistCard key={c.id} summary={c} gameId={gameId} />
      ))}

      {shared.length > 0 && (
        <>
          <SectionTitle>Shared by other players</SectionTitle>
          {shared.map((c) => (
            <View key={c.id} style={styles.checklistCard}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={type.bodyStrong} numberOfLines={2}>
                  {c.title}
                </Text>
                <Text style={type.micro}>
                  {c.itemCount} entries{c.authorName ? ` · by ${c.authorName}` : ""}
                </Text>
                <VoteRow
                  votes={c.votes}
                  disabled={vote.isPending}
                  onVote={(value) => vote.mutate({ id: c.id, value })}
                />
              </View>
              <Button
                label="Save a copy"
                tone="ghost"
                busy={adopt.isPending}
                onPress={() => adopt.mutate(c.id)}
                style={styles.adoptBtn}
              />
            </View>
          ))}
        </>
      )}
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
  ratingRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  coverEdit: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 4,
    backgroundColor: "rgba(9,9,11,0.78)",
  },
  ttbCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  ttbRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    minHeight: 36,
  },
  ttbFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ttbEditBtn: { minHeight: 36, paddingHorizontal: space.md },
  ttbButtons: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  hoursWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
  hoursInput: {
    width: 74,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    color: colors.text,
  },
  coverGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  coverOption: {
    width: 84,
    height: 112,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
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
