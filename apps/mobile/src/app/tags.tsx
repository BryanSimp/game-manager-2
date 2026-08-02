import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// same palette the web tag manager offers
const TAG_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#10b981",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#d946ef", "#f43f5e",
];

export default function TagsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_COLORS[6]!);

  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.getTags() });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tags"] });

  const create = useMutation({
    mutationFn: () => api.createTag({ name: name.trim(), color }),
    onSuccess: () => {
      setName("");
      invalidate();
    },
  });
  const recolor = useMutation({
    mutationFn: ({ id, c }: { id: string; c: string }) => api.updateTag(id, { color: c }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: invalidate,
  });

  return (
    <View style={styles.screen}>
      <View style={styles.createBox}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="New tag…"
          placeholderTextColor="#71717a"
        />
        <View style={styles.paletteRow}>
          {TAG_COLORS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
              onPress={() => setColor(c)}
            />
          ))}
          <TouchableOpacity
            style={[styles.createBtn, (!name.trim() || create.isPending) && { opacity: 0.5 }]}
            disabled={!name.trim() || create.isPending}
            onPress={() => create.mutate()}
          >
            <Text style={styles.createText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={tags.data ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 24 + insets.bottom }}
        ListEmptyComponent={
          tags.isLoading ? (
            <ActivityIndicator style={{ marginTop: 48 }} />
          ) : (
            <Text style={styles.empty}>No tags yet — create one above.</Text>
          )
        }
        renderItem={({ item }) => {
          const tagColor = item.color ?? "#71717a";
          return (
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: tagColor }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.tagName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.groupName ? <Text style={styles.group}>{item.groupName}</Text> : null}
                <View style={styles.paletteRow}>
                  {TAG_COLORS.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.swatchSm,
                        { backgroundColor: c },
                        tagColor === c && styles.swatchActive,
                      ]}
                      onPress={() => recolor.mutate({ id: item.id, c })}
                    />
                  ))}
                </View>
              </View>
              <TouchableOpacity
                hitSlop={8}
                onPress={() =>
                  Alert.alert("Delete tag", `Delete "${item.name}"? It's removed from all games.`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => remove.mutate(item.id) },
                  ])
                }
              >
                <Text style={styles.removeX}>✕</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  createBox: { padding: 12, paddingBottom: 0, gap: 8 },
  input: {
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#fafafa",
    fontSize: 14,
  },
  paletteRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 6 },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  swatchSm: { width: 18, height: 18, borderRadius: 9 },
  swatchActive: { borderWidth: 2, borderColor: "#fafafa" },
  createBtn: {
    marginLeft: "auto",
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 6,
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
  dot: { width: 14, height: 14, borderRadius: 7 },
  tagName: { color: "#fafafa", fontSize: 15, fontWeight: "600" },
  group: { color: "#71717a", fontSize: 11, marginTop: 2 },
  removeX: { color: "#52525b", fontSize: 16, padding: 4 },
});
