import { useCallback, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@gm/api-client";
import type { BarcodeLookupResult, ImportCandidate } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage } from "@/lib/ui";

type Phase =
  | { name: "scanning" }
  | { name: "looking-up"; code: string }
  | { name: "result"; code: string; result: BarcodeLookupResult }
  | { name: "error"; code: string; message: string };

/** One game waiting in the batch — nothing is written until you confirm. */
interface QueuedGame {
  code: string;
  title: string;
  igdbId: number | null;
  gameId: string | null;
  coverSrc: string | null;
  releaseYear: number | null;
  platform: { id: string; name: string } | null;
}

interface BatchResult {
  added: number;
  duplicates: number;
  failed: string[];
}

/**
 * Barcode scanning, one case after another: each scan drops a game into a
 * batch and the camera goes straight back to scanning, so a shelf can be
 * done in one pass. The batch is only written when you confirm it — the
 * same "nothing enters the library without review" rule the OCR import has.
 */
export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>({ name: "scanning" });
  const [queue, setQueue] = useState<QueuedGame[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  // guards against the camera firing multiple scan events per frame
  const busy = useRef(false);

  const resumeScanning = useCallback(() => {
    setPhase({ name: "scanning" });
    busy.current = false;
  }, []);

  const lookup = useCallback(
    async (code: string) => {
      setPhase({ name: "looking-up", code });
      try {
        const found = await api.lookupBarcode(code);
        setPhase({ name: "result", code, result: found });
      } catch (err) {
        setPhase({
          name: "error",
          code,
          message: err instanceof Error ? err.message : "Lookup failed",
        });
      }
    },
    [],
  );

  const onBarcodeScanned = useCallback(
    (scan: BarcodeScanningResult) => {
      if (busy.current) return;
      busy.current = true;
      // re-scanning a case you already queued shouldn't add it twice
      const already = queue.find((q) => q.code === scan.data);
      if (already) {
        setPhase({
          name: "error",
          code: scan.data,
          message: `${already.title} is already in this batch.`,
        });
        return;
      }
      void lookup(scan.data);
    },
    [lookup, queue],
  );

  const enqueue = useCallback(
    (code: string, candidate: ImportCandidate, found: BarcodeLookupResult) => {
      setQueue((prev) => [
        ...prev,
        {
          code,
          title: candidate.title,
          igdbId: candidate.igdbId,
          gameId: candidate.gameId,
          coverSrc: candidate.coverSrc,
          releaseYear: candidate.releaseYear,
          platform: found.platformHint
            ? { id: found.platformHint.id, name: found.platformHint.name }
            : null,
        },
      ]);
      resumeScanning();
    },
    [resumeScanning],
  );

  const confirm = useMutation({
    mutationFn: async (): Promise<BatchResult> => {
      const tally: BatchResult = { added: 0, duplicates: 0, failed: [] };
      // one request per game: each carries its own platform hint, which a
      // single bulk call can't express
      for (const game of queue) {
        try {
          await api.addToLibrary({
            ...(game.igdbId
              ? { igdbId: game.igdbId }
              : game.gameId
                ? { gameId: game.gameId }
                : { title: game.title }),
            ...(game.platform
              ? { platforms: [{ platformId: game.platform.id, format: "physical" as const }] }
              : {}),
          });
          tally.added += 1;
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) tally.duplicates += 1;
          else tally.failed.push(game.title);
        }
      }
      return tally;
    },
    onSuccess: (tally) => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["consoles"] });
      setQueue([]);
      setReviewing(false);
      setResult(tally);
    },
  });

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionText}>
          Point the camera at a game's barcode to add it to your library.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => requestPermission()}>
          <Text style={styles.primaryText}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sheetPad = { paddingBottom: 16 + insets.bottom };

  return (
    <View style={styles.screen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["upc_a", "upc_e", "ean13", "ean8"] }}
        onBarcodeScanned={
          phase.name === "scanning" && !reviewing && !result && !confirm.isPending
            ? onBarcodeScanned
            : undefined
        }
      />

      {phase.name === "scanning" && !reviewing && !result && (
        <View style={styles.reticleWrap} pointerEvents="none">
          <View style={styles.reticle} />
          <Text style={styles.hint}>
            {queue.length === 0
              ? "Line up the barcode on the back of the case"
              : "Next case — the batch is kept until you add it"}
          </Text>
        </View>
      )}

      {/* the batch bar is always there once something's queued, so the count
          and the way out are visible without leaving the camera */}
      {queue.length > 0 && !reviewing && !result && phase.name === "scanning" && (
        <View style={[styles.batchBar, { paddingBottom: 12 + insets.bottom }]}>
          <TouchableOpacity style={styles.batchCount} onPress={() => setReviewing(true)}>
            <Text style={styles.batchCountText}>
              {queue.length} queued · review ›
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.primaryBtn}
            disabled={confirm.isPending}
            onPress={() => confirm.mutate()}
          >
            <Text style={styles.primaryText}>
              {confirm.isPending ? "Adding…" : `Add ${queue.length}`}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {reviewing && (
        <View style={[styles.sheet, sheetPad]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Batch ({queue.length})</Text>
            <TouchableOpacity onPress={() => setReviewing(false)} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          {confirm.isError && (
            <Text style={styles.errorText}>
              {confirm.error instanceof Error ? confirm.error.message : "Couldn't add the batch"}
            </Text>
          )}
          <ScrollView style={{ maxHeight: 300 }}>
            {queue.length === 0 && (
              <Text style={styles.sheetSubtle}>Nothing queued yet — scan a case.</Text>
            )}
            {queue.map((game) => {
              const cover = resolveImage(game.coverSrc);
              return (
                <View key={game.code} style={styles.candidate}>
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
                    <Text style={styles.candidateTitle} numberOfLines={2}>
                      {game.title}
                    </Text>
                    <Text style={styles.sheetSubtle} numberOfLines={1}>
                      {game.releaseYear ? `${game.releaseYear} · ` : ""}
                      {game.platform ? `📦 ${game.platform.name}` : "no platform"}
                    </Text>
                  </View>
                  <TouchableOpacity
                    hitSlop={8}
                    onPress={() => setQueue((prev) => prev.filter((q) => q.code !== game.code))}
                  >
                    <Text style={styles.close}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }]}
              disabled={confirm.isPending || queue.length === 0}
              onPress={() => confirm.mutate()}
            >
              <Text style={styles.primaryText}>
                {confirm.isPending ? "Adding…" : `Add ${queue.length} games`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ghostBtn}
              onPress={() =>
                Alert.alert("Discard batch", `Throw away all ${queue.length} scanned games?`, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Discard",
                    style: "destructive",
                    onPress: () => {
                      setQueue([]);
                      setReviewing(false);
                    },
                  },
                ])
              }
            >
              <Text style={styles.ghostText}>Discard</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {result && (
        <View style={[styles.sheet, sheetPad]}>
          <View style={styles.sheetCenter}>
            <Text style={styles.addedText}>✓ {result.added} added</Text>
            {result.duplicates > 0 && (
              <Text style={styles.sheetSubtle}>
                {result.duplicates} were already in your library
              </Text>
            )}
            {result.failed.length > 0 && (
              <Text style={styles.errorText} numberOfLines={3}>
                Couldn't add: {result.failed.join(", ")}
              </Text>
            )}
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => {
                  setResult(null);
                  resumeScanning();
                }}
              >
                <Text style={styles.primaryText}>Keep scanning</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostBtn} onPress={() => router.back()}>
                <Text style={styles.ghostText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {!reviewing && !result && phase.name !== "scanning" && (
        <View style={[styles.sheet, sheetPad]}>
          {phase.name === "looking-up" && (
            <View style={styles.sheetCenter}>
              <ActivityIndicator />
              <Text style={styles.sheetSubtle}>Looking up {phase.code}…</Text>
            </View>
          )}

          {phase.name === "error" && (
            <View style={styles.sheetCenter}>
              <Text style={styles.sheetTitle}>Lookup failed</Text>
              <Text style={styles.sheetSubtle}>{phase.message}</Text>
              <View style={styles.btnRow}>
                <TouchableOpacity style={styles.primaryBtn} onPress={resumeScanning}>
                  <Text style={styles.primaryText}>Scan again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => router.replace("/add")}>
                  <Text style={styles.ghostText}>Search instead</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {phase.name === "result" && !phase.result.found && (
            <View style={styles.sheetCenter}>
              <Text style={styles.sheetTitle}>Barcode not recognized</Text>
              <Text style={styles.sheetSubtle}>
                {phase.code} isn't in the UPC database. Try searching by title.
              </Text>
              <View style={styles.btnRow}>
                <TouchableOpacity style={styles.primaryBtn} onPress={resumeScanning}>
                  <Text style={styles.primaryText}>Scan again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => router.replace("/add")}>
                  <Text style={styles.ghostText}>Search instead</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {phase.name === "result" && phase.result.found && (
            <>
              <Text style={styles.sheetSubtle} numberOfLines={2}>
                {phase.result.product}
              </Text>
              {phase.result.platformHint && (
                <View style={styles.platformChip}>
                  <Text style={styles.platformChipText}>
                    📦 {phase.result.platformHint.name} · physical
                  </Text>
                </View>
              )}

              <ScrollView style={{ maxHeight: 240 }}>
                {phase.result.candidates.length === 0 && (
                  <Text style={styles.sheetSubtle}>No matches for “{phase.result.query}”.</Text>
                )}
                {phase.result.candidates.map((c) => {
                  const cover = resolveImage(c.coverSrc);
                  const found = phase.result;
                  return (
                    <TouchableOpacity
                      key={`${c.igdbId ?? c.gameId ?? c.title}`}
                      style={styles.candidate}
                      onPress={() => enqueue(phase.code, c, found)}
                    >
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
                        <Text style={styles.candidateTitle} numberOfLines={2}>
                          {c.title}
                        </Text>
                        {c.releaseYear && <Text style={styles.sheetSubtle}>{c.releaseYear}</Text>}
                      </View>
                      <Text style={styles.addLabel}>Queue</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TouchableOpacity style={styles.ghostBtn} onPress={resumeScanning}>
                <Text style={styles.ghostText}>Skip this one</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101014",
    padding: 24,
  },
  permissionTitle: { color: "#fafafa", fontSize: 17, fontWeight: "700" },
  permissionText: {
    color: "#a1a1aa",
    fontSize: 13,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  reticleWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  reticle: {
    width: "78%",
    height: 130,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "rgba(129,140,248,0.9)",
  },
  hint: {
    color: "#e4e4e7",
    fontSize: 13,
    marginTop: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  batchBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "rgba(24,24,27,0.94)",
  },
  batchCount: { flex: 1 },
  batchCountText: { color: "#c7d2fe", fontSize: 14, fontWeight: "700" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#18181b",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 10,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetCenter: { alignItems: "center", gap: 10, paddingVertical: 8 },
  sheetTitle: { color: "#fafafa", fontSize: 16, fontWeight: "700" },
  sheetSubtle: { color: "#a1a1aa", fontSize: 12 },
  close: { color: "#71717a", fontSize: 16, padding: 4 },
  platformChip: {
    alignSelf: "flex-start",
    backgroundColor: "#312e81",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  platformChipText: { color: "#c7d2fe", fontSize: 12, fontWeight: "600" },
  candidate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#27272a",
  },
  cover: { width: 38, height: 50, borderRadius: 5, backgroundColor: "#27272a", overflow: "hidden" },
  candidateTitle: { color: "#fafafa", fontSize: 14, fontWeight: "600" },
  addLabel: { color: "#818cf8", fontWeight: "700", fontSize: 13 },
  addedText: { color: "#6ee7b7", fontSize: 16, fontWeight: "700" },
  errorText: { color: "#f87171", fontSize: 12 },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  primaryBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "600" },
  ghostBtn: {
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
    alignItems: "center",
  },
  ghostText: { color: "#a1a1aa", fontWeight: "600" },
});
