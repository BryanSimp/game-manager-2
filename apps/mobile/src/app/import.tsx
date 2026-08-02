import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BUILTIN_CATEGORIES,
  GAME_STATUSES,
  type GameStatus,
  type ImportCandidate,
  type ImportItem,
} from "@gm/shared";
import { api } from "@/lib/api";
import { colors, radius, space, type } from "@/lib/theme";
import { Button, Cover, Icon, Screen } from "@/components/ui";

interface ReviewItem {
  id: string;
  raw: string;
  cleaned: string;
  candidates: ImportCandidate[];
  selected: ImportCandidate | null;
  confidence: number | null;
  skipped: boolean;
  status: GameStatus;
}

/** Chip styling for the import review screen, from the shared built-ins. */
const STATUS_CHIP: Record<string, { label: string; color: string }> = Object.fromEntries(
  BUILTIN_CATEGORIES.map((c) => [c.key, { label: c.label, color: c.color }]),
);

const STATUS_LABELS: Record<string, string> = {
  pending: "Queued…",
  ocr: "Reading the image…",
  matching: "Matching titles…",
};

export default function ImportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<"input" | "processing" | "review">("input");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const platforms = useQuery({ queryKey: ["platforms"], queryFn: () => api.getPlatforms() });
  const [ownPlatformId, setOwnPlatformId] = useState<string | null>(null);
  const [ownFormat, setOwnFormat] = useState<"physical" | "digital">("digital");

  const job = useQuery({
    queryKey: ["import-job", jobId],
    queryFn: () => api.getImport(jobId!),
    enabled: !!jobId && stage === "processing",
    refetchInterval: 1500,
  });

  useEffect(() => {
    if (stage !== "processing" || !job.data) return;
    if (job.data.status === "failed") {
      setError(job.data.error ?? "Import failed");
      setStage("input");
      setJobId(null);
    } else if (job.data.status === "review") {
      setItems(
        job.data.items.map((it: ImportItem) => ({
          id: it.id,
          raw: it.rawText,
          cleaned: it.cleanedTitle,
          candidates: it.candidates,
          selected: it.candidates[0] ?? null,
          confidence: it.confidence,
          skipped: false,
          status: "backlog" as const,
        })),
      );
      setStage("review");
    }
  }, [job.data, stage]);

  async function pickImage(fromCamera: boolean, source: "screenshot" | "shelf_photo") {
    const picked = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    try {
      setError(null);
      const blob = await (await fetch(asset.uri)).blob();
      const created = await api.createImageImport(blob, asset.fileName ?? "photo.jpg", source);
      setJobId(created.id);
      setStage("processing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  const confirm = useMutation({
    mutationFn: async () => {
      const res = await api.bulkAdd(
        items
          .filter((it) => !it.skipped)
          .map((it) =>
            it.selected?.igdbId
              ? { igdbId: it.selected.igdbId, status: it.status }
              : { title: it.selected?.title ?? it.cleaned, status: it.status },
          ),
        ownPlatformId ? [{ platformId: ownPlatformId, format: ownFormat }] : undefined,
      );
      if (jobId) await api.finishImport(jobId);
      return res;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      Alert.alert("Import complete", `${res.added} added · ${res.skipped} already in library`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
  });

  function pickCandidate(item: ReviewItem) {
    const options = item.candidates.slice(0, 4).map((c) => ({
      text: `${c.title}${c.releaseYear ? ` (${c.releaseYear})` : ""}`,
      onPress: () => {
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, selected: c } : it)));
      },
    }));
    Alert.alert("Pick the right game", item.raw, [
      ...options,
      {
        text: `Add "${item.cleaned}" manually`,
        onPress: () =>
          setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, selected: null } : it))),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const active = items.filter((it) => !it.skipped);

  if (stage === "processing") {
    return (
      <Screen center>
        <ActivityIndicator size="large" color={colors.accentBorder} />
        <Text style={[type.body, { marginTop: space.lg }]}>
          {STATUS_LABELS[job.data?.status ?? "pending"]}
        </Text>
      </Screen>
    );
  }

  if (stage === "review") {
    return (
      <Screen>
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          // the footer floats over the list, so leave room for all of it
          contentContainerStyle={{ padding: space.md, paddingBottom: 200 + insets.bottom }}
          renderItem={({ item }) => {
            const chip = STATUS_CHIP[item.status]!;
            const dot = !item.selected
              ? colors.warning
              : (item.confidence ?? 1) >= 0.8
                ? colors.success
                : (item.confidence ?? 1) >= 0.55
                  ? colors.warning
                  : colors.danger;
            return (
              // the match, its category chip and the skip button used to share
              // one row and clipped each other — controls get their own line
              <View style={[styles.row, item.skipped && { opacity: 0.45 }]}>
                <View style={styles.rowTop}>
                  <View style={[styles.dot, { backgroundColor: dot }]} />
                  <Cover
                    src={item.selected?.coverSrc?.startsWith("http") ? item.selected.coverSrc : null}
                    width={38}
                    height={50}
                  />
                  <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => pickCandidate(item)}>
                    <Text style={type.micro} numberOfLines={1}>
                      {item.raw}
                    </Text>
                    <Text style={[type.bodyStrong, { marginTop: 2 }]} numberOfLines={2}>
                      {item.selected
                        ? item.selected.title
                        : `"${item.cleaned}" (manual)`}
                      {item.selected?.releaseYear ? ` (${item.selected.releaseYear})` : ""}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={item.skipped ? "Include this game" : "Skip this game"}
                    style={styles.skipBtn}
                    onPress={() =>
                      setItems((prev) =>
                        prev.map((it) =>
                          it.id === item.id ? { ...it, skipped: !it.skipped } : it,
                        ),
                      )
                    }
                  >
                    <Icon
                      name={item.skipped ? "add" : "close"}
                      size={16}
                      color={colors.textMuted}
                    />
                  </Pressable>
                </View>
                <View style={styles.rowBottom}>
                  <Pressable style={styles.changeBtn} onPress={() => pickCandidate(item)}>
                    <Icon name="swap-horizontal" size={13} color={colors.textMuted} />
                    <Text style={type.micro}>Change match</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.statusChip, { borderColor: `${chip.color}66` }]}
                    onPress={() =>
                      // tap cycles through the built-in categories
                      setItems((prev) =>
                        prev.map((it) =>
                          it.id === item.id
                            ? {
                                ...it,
                                status:
                                  GAME_STATUSES[
                                    (GAME_STATUSES.indexOf(it.status) + 1) % GAME_STATUSES.length
                                  ]!,
                              }
                            : it,
                        ),
                      )
                    }
                  >
                    <Text style={[type.micro, { color: chip.color }]}>{chip.label}</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
        <View style={[styles.footer, { paddingBottom: space.md + insets.bottom }]}>
          <Text style={[type.micro, { color: colors.textMuted }]}>Mark all as owned on</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingVertical: space.sm }}
          >
            <PlatChip
              label="Don't set"
              active={!ownPlatformId}
              onPress={() => setOwnPlatformId(null)}
            />
            {(platforms.data ?? []).map((p) => (
              <PlatChip
                key={p.id}
                // storefronts share short names with nothing, but "Steam" next
                // to "PC" reads better as "PC · Steam"
                label={`${p.parentName ? `${p.parentName} · ` : ""}${p.abbreviation ?? p.name}`}
                active={ownPlatformId === p.id}
                onPress={() => setOwnPlatformId(ownPlatformId === p.id ? null : p.id)}
              />
            ))}
          </ScrollView>
          {ownPlatformId && (
            <View style={styles.formatRow}>
              <Button
                label="Digital"
                icon="cloud-download-outline"
                tone={ownFormat === "digital" ? "primary" : "ghost"}
                fill
                onPress={() => setOwnFormat("digital")}
                style={styles.formatBtn}
              />
              <Button
                label="Physical"
                icon="cube-outline"
                tone={ownFormat === "physical" ? "primary" : "ghost"}
                fill
                onPress={() => setOwnFormat("physical")}
                style={styles.formatBtn}
              />
            </View>
          )}
          <Button
            label={`Add ${active.length} ${active.length === 1 ? "game" : "games"}`}
            icon="checkmark"
            fill
            disabled={active.length === 0}
            busy={confirm.isPending}
            onPress={() => confirm.mutate()}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ padding: space.lg, gap: space.md }}>
        {error && (
          <View style={styles.error}>
            <Icon name="alert-circle" size={16} color="#fca5a5" />
            <Text style={[type.caption, { flex: 1, color: "#fca5a5" }]}>{error}</Text>
          </View>
        )}
        <Text style={type.prose}>
          Photograph your game shelf or upload a library screenshot — titles are read and matched
          automatically, and you review everything before it's added.
        </Text>
        <Button
          label="Photograph my game shelf"
          icon="camera"
          fill
          onPress={() => pickImage(true, "shelf_photo")}
        />
        <Button
          label="Shelf photo from gallery"
          icon="images-outline"
          tone="ghost"
          fill
          onPress={() => pickImage(false, "shelf_photo")}
        />
        <Button
          label="Library screenshot from gallery"
          icon="desktop-outline"
          tone="ghost"
          fill
          onPress={() => pickImage(false, "screenshot")}
        />
      </View>
    </Screen>
  );
}

function PlatChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.platChip, active && styles.platChipActive]}
      onPress={onPress}
    >
      <Text style={[type.micro, { color: active ? colors.accentText : colors.textMuted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.sm + 2,
    marginBottom: space.sm,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: space.sm + 2 },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.sm,
    // line the controls up with the title rather than the confidence dot
    paddingLeft: 60,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  changeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 30,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.md,
  },
  statusChip: {
    justifyContent: "center",
    minHeight: 30,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.md,
  },
  skipBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: "rgba(9,9,11,0.97)",
  },
  platChip: {
    justifyContent: "center",
    minHeight: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.md,
  },
  platChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  formatRow: { flexDirection: "row", gap: space.sm },
  formatBtn: { minHeight: 40 },
  error: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
    backgroundColor: "#450a0a",
    borderRadius: radius.sm,
    padding: space.md,
  },
});
