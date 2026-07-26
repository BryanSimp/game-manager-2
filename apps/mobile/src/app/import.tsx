import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GAME_STATUSES, type GameStatus, type ImportCandidate, type ImportItem } from "@gm/shared";
import { api } from "@/lib/api";

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

const STATUS_CHIP: Record<GameStatus, { label: string; color: string }> = {
  wishlist: { label: "Wishlist", color: "#38bdf8" },
  backlog: { label: "Backlog", color: "#fbbf24" },
  playing: { label: "Playing", color: "#818cf8" },
  finished: { label: "Finished", color: "#34d399" },
  dropped: { label: "Dropped", color: "#fb7185" },
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Queued…",
  ocr: "Reading the image…",
  matching: "Matching titles…",
};

export default function ImportScreen() {
  const router = useRouter();
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
      const created = await api.createImageImport(
        blob,
        asset.fileName ?? "photo.jpg",
        source,
      );
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
        setItems((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, selected: c } : it)),
        );
      },
    }));
    Alert.alert("Pick the right game", item.raw, [
      ...options,
      {
        text: `Add "${item.cleaned}" manually`,
        onPress: () =>
          setItems((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, selected: null } : it)),
          ),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const active = items.filter((it) => !it.skipped);

  if (stage === "processing") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.processingText}>
          {STATUS_LABELS[job.data?.status ?? "pending"]}
        </Text>
      </View>
    );
  }

  if (stage === "review") {
    return (
      <View style={styles.screen}>
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
          renderItem={({ item }) => (
            <View style={[styles.row, item.skipped && { opacity: 0.4 }]}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: !item.selected
                      ? "#fbbf24"
                      : (item.confidence ?? 1) >= 0.8
                        ? "#34d399"
                        : (item.confidence ?? 1) >= 0.55
                          ? "#fbbf24"
                          : "#f87171",
                  },
                ]}
              />
              <View style={styles.cover}>
                {item.selected?.coverSrc && (
                  <Image
                    source={{
                      uri: item.selected.coverSrc.startsWith("http")
                        ? item.selected.coverSrc
                        : undefined,
                    }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                  />
                )}
              </View>
              <TouchableOpacity style={{ flex: 1, minWidth: 0 }} onPress={() => pickCandidate(item)}>
                <Text style={styles.raw} numberOfLines={1}>
                  {item.raw}
                </Text>
                <Text style={styles.matched} numberOfLines={1}>
                  {item.selected
                    ? `→ ${item.selected.title}${item.selected.releaseYear ? ` (${item.selected.releaseYear})` : ""}`
                    : `→ "${item.cleaned}" (manual)`}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusChip, { borderColor: `${STATUS_CHIP[item.status].color}66` }]}
                onPress={() =>
                  // tap cycles wishlist → backlog → playing → finished → dropped
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
                <Text style={[styles.statusChipText, { color: STATUS_CHIP[item.status].color }]}>
                  {STATUS_CHIP[item.status].label}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={() =>
                  setItems((prev) =>
                    prev.map((it) => (it.id === item.id ? { ...it, skipped: !it.skipped } : it)),
                  )
                }
              >
                <Text style={styles.skipText}>{item.skipped ? "＋" : "✕"}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
        <View style={styles.footer}>
          <Text style={styles.footerLabel}>Mark all as owned on:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingVertical: 6 }}
          >
            <TouchableOpacity
              style={[styles.platChip, !ownPlatformId && styles.platChipActive]}
              onPress={() => setOwnPlatformId(null)}
            >
              <Text style={[styles.platChipText, !ownPlatformId && styles.platChipTextActive]}>
                Don't set
              </Text>
            </TouchableOpacity>
            {(platforms.data ?? []).map((p) => {
              const active2 = ownPlatformId === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.platChip, active2 && styles.platChipActive]}
                  onPress={() => setOwnPlatformId(active2 ? null : p.id)}
                >
                  <Text style={[styles.platChipText, active2 && styles.platChipTextActive]}>
                    {p.abbreviation ?? p.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {ownPlatformId && (
            <View style={styles.formatRow}>
              <TouchableOpacity
                style={[styles.formatBtn, ownFormat === "digital" && styles.formatBtnActive]}
                onPress={() => setOwnFormat("digital")}
              >
                <Text style={styles.platChipText}>💾 Digital</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.formatBtn, ownFormat === "physical" && styles.formatBtnActive]}
                onPress={() => setOwnFormat("physical")}
              >
                <Text style={styles.platChipText}>📦 Physical</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity
            style={styles.confirmBtn}
            disabled={confirm.isPending || active.length === 0}
            onPress={() => confirm.mutate()}
          >
            <Text style={styles.confirmText}>
              {confirm.isPending ? "Adding…" : `Add ${active.length} games`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={{ padding: 16, gap: 12 }}>
        {error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.intro}>
          Photograph your game shelf or upload a library screenshot — titles are read and matched
          automatically, and you review everything before it's added.
        </Text>
        <ActionButton
          label="📷 Photograph my game shelf"
          onPress={() => pickImage(true, "shelf_photo")}
        />
        <ActionButton
          label="🖼 Shelf photo from gallery"
          secondary
          onPress={() => pickImage(false, "shelf_photo")}
        />
        <ActionButton
          label="🖥 Library screenshot from gallery"
          secondary
          onPress={() => pickImage(false, "screenshot")}
        />
      </View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  secondary,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <TouchableOpacity style={[styles.action, secondary && styles.actionSecondary]} onPress={onPress}>
      <Text style={[styles.actionText, secondary && { color: "#d4d4d8" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101014",
    gap: 16,
  },
  processingText: { color: "#d4d4d8", fontSize: 15, fontWeight: "600" },
  intro: { color: "#a1a1aa", fontSize: 14, lineHeight: 20, marginBottom: 4 },
  error: {
    color: "#fca5a5",
    backgroundColor: "#450a0a",
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
  },
  action: {
    backgroundColor: "#4f46e5",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  actionSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3f3f46",
  },
  actionText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 10,
    marginBottom: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cover: { width: 36, height: 48, borderRadius: 4, backgroundColor: "#27272a", overflow: "hidden" },
  raw: { color: "#71717a", fontSize: 11 },
  matched: { color: "#fafafa", fontSize: 14, fontWeight: "500", marginTop: 2 },
  statusChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusChipText: { fontSize: 11, fontWeight: "600" },
  skipBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3f3f46",
    alignItems: "center",
    justifyContent: "center",
  },
  skipText: { color: "#a1a1aa", fontSize: 14 },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingTop: 8,
    backgroundColor: "#101014ee",
  },
  footerLabel: { color: "#a1a1aa", fontSize: 12, fontWeight: "600" },
  platChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3f3f46",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  platChipActive: { backgroundColor: "#312e81", borderColor: "#818cf8" },
  platChipText: { color: "#a1a1aa", fontSize: 12, fontWeight: "500" },
  platChipTextActive: { color: "#c7d2fe" },
  formatRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  formatBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3f3f46",
    paddingVertical: 8,
    alignItems: "center",
  },
  formatBtnActive: { backgroundColor: "#312e81", borderColor: "#818cf8" },
  confirmBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  confirmText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
