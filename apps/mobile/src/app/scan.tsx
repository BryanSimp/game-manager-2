import { useCallback, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BarcodeLookupResult, ImportCandidate } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage } from "@/lib/ui";

type Phase =
  | { name: "scanning" }
  | { name: "looking-up"; code: string }
  | { name: "result"; code: string; result: BarcodeLookupResult }
  | { name: "error"; code: string; message: string };

export default function ScanScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>({ name: "scanning" });
  const [addedTitle, setAddedTitle] = useState<string | null>(null);
  // guards against the camera firing multiple scan events per frame
  const busy = useRef(false);

  const lookup = useCallback(async (code: string) => {
    setPhase({ name: "looking-up", code });
    try {
      const result = await api.lookupBarcode(code);
      setPhase({ name: "result", code, result });
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
      void lookup(scan.data);
    },
    [lookup],
  );

  const add = useMutation({
    mutationFn: async ({
      candidate,
      platformId,
    }: {
      candidate: ImportCandidate;
      platformId: string | null;
    }) => {
      const created = await api.addToLibrary(
        candidate.igdbId
          ? { igdbId: candidate.igdbId }
          : candidate.gameId
            ? { gameId: candidate.gameId }
            : { title: candidate.title },
      );
      if (platformId) {
        await api.setEntryPlatforms(created.id, [{ platformId, format: "physical" }]);
      }
      return candidate.title;
    },
    onSuccess: (title) => {
      setAddedTitle(title);
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["consoles"] });
    },
  });

  const scanNext = useCallback(() => {
    add.reset();
    setAddedTitle(null);
    setPhase({ name: "scanning" });
    busy.current = false;
  }, [add]);

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

  return (
    <View style={styles.screen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["upc_a", "upc_e", "ean13", "ean8"] }}
        onBarcodeScanned={phase.name === "scanning" ? onBarcodeScanned : undefined}
      />

      {phase.name === "scanning" && (
        <View style={styles.reticleWrap} pointerEvents="none">
          <View style={styles.reticle} />
          <Text style={styles.hint}>Line up the barcode on the back of the case</Text>
        </View>
      )}

      {phase.name !== "scanning" && (
        <View style={styles.sheet}>
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
                <TouchableOpacity style={styles.primaryBtn} onPress={scanNext}>
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
                <TouchableOpacity style={styles.primaryBtn} onPress={scanNext}>
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
              <Text style={styles.sheetSubtle} numberOfLines={1}>
                {phase.result.product}
              </Text>
              {phase.result.platformHint && (
                <View style={styles.platformChip}>
                  <Text style={styles.platformChipText}>
                    📦 {phase.result.platformHint.name} · physical
                  </Text>
                </View>
              )}

              {addedTitle ? (
                <View style={styles.sheetCenter}>
                  <Text style={styles.addedText}>✓ Added {addedTitle}</Text>
                  <TouchableOpacity style={styles.primaryBtn} onPress={scanNext}>
                    <Text style={styles.primaryText}>Scan next game</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {add.isError && (
                    <Text style={styles.errorText}>
                      {add.error instanceof Error ? add.error.message : "Couldn't add game"}
                    </Text>
                  )}
                  <ScrollView style={{ maxHeight: 260 }}>
                    {phase.result.candidates.length === 0 && (
                      <Text style={styles.sheetSubtle}>
                        No matches for “{phase.result.query}”.
                      </Text>
                    )}
                    {phase.result.candidates.map((c) => {
                      const cover = resolveImage(c.coverSrc);
                      return (
                        <TouchableOpacity
                          key={`${c.igdbId ?? c.gameId ?? c.title}`}
                          style={styles.candidate}
                          disabled={add.isPending}
                          onPress={() =>
                            add.mutate({
                              candidate: c,
                              platformId: phase.result.platformHint?.id ?? null,
                            })
                          }
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
                            <Text style={styles.candidateTitle} numberOfLines={1}>
                              {c.title}
                            </Text>
                            {c.releaseYear && (
                              <Text style={styles.sheetSubtle}>{c.releaseYear}</Text>
                            )}
                          </View>
                          {add.isPending ? (
                            <ActivityIndicator />
                          ) : (
                            <Text style={styles.addLabel}>Add</Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <TouchableOpacity style={styles.ghostBtn} onPress={scanNext}>
                    <Text style={styles.ghostText}>Cancel · scan again</Text>
                  </TouchableOpacity>
                </>
              )}
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
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#18181b",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 28,
    gap: 10,
  },
  sheetCenter: { alignItems: "center", gap: 10, paddingVertical: 8 },
  sheetTitle: { color: "#fafafa", fontSize: 16, fontWeight: "700" },
  sheetSubtle: { color: "#a1a1aa", fontSize: 12 },
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
  addedText: { color: "#6ee7b7", fontSize: 15, fontWeight: "700" },
  errorText: { color: "#f87171", fontSize: 12 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  primaryBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "600" },
  ghostBtn: {
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: "center",
  },
  ghostText: { color: "#a1a1aa", fontWeight: "600" },
});
