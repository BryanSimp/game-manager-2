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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GAME_STATUSES, type UpdateEntryInput } from "@gm/shared";
import { api } from "@/lib/api";
import { formatHours, resolveImage, STATUS_COLORS } from "@/lib/ui";

const RATINGS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const entry = useQuery({ queryKey: ["entry", id], queryFn: () => api.getEntry(id) });

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
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
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
});
