import { useCallback, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@gm/api-client";
import type { BarcodeLookupResult, ImportCandidate } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage } from "@/lib/ui";
import { colors, radius, space, type } from "@/lib/theme";
import { Button, Cover, Icon, IconButton, Screen } from "@/components/ui";

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

  const lookup = useCallback(async (code: string) => {
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
  }, []);

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
      <Screen center>
        <ActivityIndicator color={colors.accentBorder} />
      </Screen>
    );
  }
  if (!permission.granted) {
    return (
      <Screen center>
        <View style={styles.permissionIcon}>
          <Icon name="camera-outline" size={28} color={colors.textGhost} />
        </View>
        <Text style={[type.heading, styles.center]}>Camera access needed</Text>
        <Text style={[type.caption, styles.center, { marginTop: space.xs, marginBottom: space.lg }]}>
          Point the camera at a game's barcode to add it to your library.
        </Text>
        <Button label="Allow camera" icon="camera" onPress={() => requestPermission()} />
      </Screen>
    );
  }

  const sheetPad = { paddingBottom: space.lg + insets.bottom };
  const scanning = phase.name === "scanning" && !reviewing && !result;

  return (
    <View style={styles.screen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["upc_a", "upc_e", "ean13", "ean8"] }}
        onBarcodeScanned={scanning && !confirm.isPending ? onBarcodeScanned : undefined}
      />

      {scanning && (
        <View style={styles.reticleWrap}>
          <View style={styles.reticle}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <View style={styles.hint}>
            <Icon name="barcode-outline" size={15} color={colors.text} />
            <Text style={[type.caption, { color: colors.text }]}>
              {queue.length === 0
                ? "Line up the barcode on the back of the case"
                : "Next case — the batch is kept until you add it"}
            </Text>
          </View>
        </View>
      )}

      {/* the batch bar is always there once something's queued, so the count
          and the way out are visible without leaving the camera */}
      {queue.length > 0 && scanning && (
        <View style={[styles.batchBar, { paddingBottom: space.md + insets.bottom }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Review ${queue.length} queued games`}
            style={styles.batchCount}
            onPress={() => setReviewing(true)}
          >
            <View style={styles.batchPill}>
              <Text style={[type.label, { color: "#ffffff" }]}>{queue.length}</Text>
            </View>
            <Text style={[type.label, { color: colors.accentText }]}>queued · review</Text>
            <Icon name="chevron-forward" size={15} color={colors.accentText} />
          </Pressable>
          <Button
            label={`Add ${queue.length}`}
            icon="checkmark"
            busy={confirm.isPending}
            onPress={() => confirm.mutate()}
          />
        </View>
      )}

      {reviewing && (
        <View style={[styles.sheet, sheetPad]}>
          <View style={styles.sheetHeader}>
            <Text style={type.heading}>Batch ({queue.length})</Text>
            <IconButton
              name="close"
              accessibilityLabel="Back to scanning"
              onPress={() => setReviewing(false)}
            />
          </View>
          {confirm.isError && (
            <Text style={[type.caption, { color: colors.danger }]}>
              {confirm.error instanceof Error ? confirm.error.message : "Couldn't add the batch"}
            </Text>
          )}
          <ScrollView style={{ maxHeight: 300 }}>
            {queue.length === 0 && (
              <Text style={type.caption}>Nothing queued yet — scan a case.</Text>
            )}
            {queue.map((game) => (
              <View key={game.code} style={styles.queueRow}>
                <Cover src={resolveImage(game.coverSrc)} width={38} height={50} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={type.label} numberOfLines={2}>
                    {game.title}
                  </Text>
                  <Text style={type.micro} numberOfLines={1}>
                    {game.releaseYear ? `${game.releaseYear} · ` : ""}
                    {game.platform ? game.platform.name : "no platform"}
                  </Text>
                </View>
                <IconButton
                  name="trash-outline"
                  accessibilityLabel={`Remove ${game.title} from the batch`}
                  onPress={() => setQueue((prev) => prev.filter((q) => q.code !== game.code))}
                />
              </View>
            ))}
          </ScrollView>
          <View style={styles.btnRow}>
            <Button
              label={`Add ${queue.length} games`}
              icon="checkmark"
              fill
              disabled={queue.length === 0}
              busy={confirm.isPending}
              onPress={() => confirm.mutate()}
            />
            <Button
              label="Discard"
              tone="ghost"
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
            />
          </View>
        </View>
      )}

      {result && (
        <View style={[styles.sheet, sheetPad]}>
          <View style={styles.sheetCenter}>
            <View style={styles.successIcon}>
              <Icon name="checkmark" size={26} color={colors.success} />
            </View>
            <Text style={type.heading}>{result.added} added</Text>
            {result.duplicates > 0 && (
              <Text style={[type.caption, styles.center]}>
                {result.duplicates} were already in your library
              </Text>
            )}
            {result.failed.length > 0 && (
              <Text style={[type.caption, styles.center, { color: colors.danger }]} numberOfLines={3}>
                Couldn't add: {result.failed.join(", ")}
              </Text>
            )}
            <View style={styles.btnRow}>
              <Button
                label="Keep scanning"
                icon="barcode-outline"
                onPress={() => {
                  setResult(null);
                  resumeScanning();
                }}
              />
              <Button label="Done" tone="ghost" onPress={() => router.back()} />
            </View>
          </View>
        </View>
      )}

      {!reviewing && !result && phase.name !== "scanning" && (
        <View style={[styles.sheet, sheetPad]}>
          {phase.name === "looking-up" && (
            <View style={styles.sheetCenter}>
              <ActivityIndicator color={colors.accentBorder} />
              <Text style={type.caption}>Looking up {phase.code}…</Text>
            </View>
          )}

          {phase.name === "error" && (
            <View style={styles.sheetCenter}>
              <Text style={type.heading}>Lookup failed</Text>
              <Text style={[type.caption, styles.center]}>{phase.message}</Text>
              <View style={styles.btnRow}>
                <Button label="Scan again" icon="barcode-outline" onPress={resumeScanning} />
                <Button label="Search instead" tone="ghost" onPress={() => router.replace("/add")} />
              </View>
            </View>
          )}

          {phase.name === "result" && !phase.result.found && (
            <View style={styles.sheetCenter}>
              <Text style={type.heading}>Barcode not recognized</Text>
              <Text style={[type.caption, styles.center]}>
                {phase.code} isn't in the UPC database. Try searching by title.
              </Text>
              <View style={styles.btnRow}>
                <Button label="Scan again" icon="barcode-outline" onPress={resumeScanning} />
                <Button label="Search instead" tone="ghost" onPress={() => router.replace("/add")} />
              </View>
            </View>
          )}

          {phase.name === "result" && phase.result.found && (
            <>
              {/* the query is the cleaned-up title the server actually
                  searched; the raw shelf listing is the small print */}
              <Text style={type.heading} numberOfLines={2}>
                {phase.result.query ?? phase.result.product}
              </Text>
              <Text style={type.micro} numberOfLines={2}>
                {phase.result.product}
              </Text>
              {phase.result.platformHint && (
                <View style={styles.platformChip}>
                  <Icon name="cube-outline" size={13} color={colors.accentText} />
                  <Text style={[type.micro, { color: colors.accentText }]}>
                    {phase.result.platformHint.name} · physical
                  </Text>
                </View>
              )}

              <ScrollView style={{ maxHeight: 240 }}>
                {phase.result.candidates.length === 0 && (
                  <Text style={type.caption}>No matches for “{phase.result.query}”.</Text>
                )}
                {phase.result.candidates.map((c) => {
                  const found = phase.result;
                  return (
                    <Pressable
                      key={`${c.igdbId ?? c.gameId ?? c.title}`}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.candidate, pressed && { opacity: 0.7 }]}
                      onPress={() => enqueue(phase.code, c, found)}
                    >
                      <Cover src={resolveImage(c.coverSrc)} width={38} height={50} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={type.label} numberOfLines={2}>
                          {c.title}
                        </Text>
                        {c.releaseYear && <Text style={type.micro}>{c.releaseYear}</Text>}
                      </View>
                      <View style={styles.queueTag}>
                        <Icon name="add" size={14} color={colors.accentBorder} />
                        <Text style={[type.micro, { color: colors.accentBorder }]}>Queue</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Button label="Skip this one" tone="ghost" fill onPress={resumeScanning} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  center: { textAlign: "center" },
  permissionIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.md,
  },
  reticleWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    // the overlay must never swallow a tap meant for the camera below it
    pointerEvents: "none",
  },
  reticle: { width: "78%", height: 140 },
  // corner brackets read as a scanner frame without boxing in the whole shot
  corner: { position: "absolute", width: 28, height: 28, borderColor: colors.accentBorder },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: space.lg,
    maxWidth: "84%",
    backgroundColor: "rgba(0,0,0,0.62)",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  batchBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: "rgba(24,24,27,0.95)",
  },
  batchCount: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  batchPill: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 6,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetCenter: { alignItems: "center", gap: space.sm, paddingVertical: space.sm },
  successIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#022c22",
    alignItems: "center",
    justifyContent: "center",
  },
  platformChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  candidate: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  queueTag: { flexDirection: "row", alignItems: "center", gap: 2 },
  btnRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
});
