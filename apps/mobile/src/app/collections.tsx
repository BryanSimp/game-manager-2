import { useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function CollectionsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const collections = useQuery({ queryKey: ["collections"], queryFn: () => api.getCollections() });

  const create = useMutation({
    mutationFn: (n: string) => api.createCollection({ name: n }),
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  return (
    <View style={styles.screen}>
      <View style={styles.createRow}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="New collection…"
          placeholderTextColor="#71717a"
        />
        <TouchableOpacity
          style={[styles.createBtn, (!name.trim() || create.isPending) && { opacity: 0.5 }]}
          disabled={!name.trim() || create.isPending}
          onPress={() => create.mutate(name.trim())}
        >
          <Text style={styles.createText}>Create</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={collections.data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={collections.isRefetching}
            onRefresh={() => collections.refetch()}
          />
        }
        ListEmptyComponent={
          collections.isLoading ? (
            <ActivityIndicator style={{ marginTop: 48 }} />
          ) : (
            <Text style={styles.empty}>No collections yet — series and franchises live here.</Text>
          )
        }
        renderItem={({ item }) => {
          const accent = item.accentColor ?? "#4f46e5";
          const pct = item.total > 0 ? Math.round((item.finished / item.total) * 100) : 0;
          return (
            <Pressable style={styles.row} onPress={() => router.push(`/collection/${item.id}`)}>
              <View style={[styles.accent, { backgroundColor: accent }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.description ? (
                  <Text style={styles.desc} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : null}
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: accent }]} />
                </View>
                <Text style={styles.progressText}>
                  {item.finished}/{item.total} finished
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  createRow: { flexDirection: "row", gap: 8, padding: 12, paddingBottom: 0 },
  input: {
    flex: 1,
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#fafafa",
    fontSize: 14,
  },
  createBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  createText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  empty: { color: "#71717a", fontSize: 13, textAlign: "center", marginTop: 48 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 12,
    marginBottom: 8,
  },
  accent: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  title: { color: "#fafafa", fontSize: 15, fontWeight: "600" },
  desc: { color: "#71717a", fontSize: 12, marginTop: 2 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#27272a",
    overflow: "hidden",
    marginTop: 8,
  },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { color: "#71717a", fontSize: 11, marginTop: 4 },
  chevron: { color: "#52525b", fontSize: 24, paddingLeft: 4 },
});
