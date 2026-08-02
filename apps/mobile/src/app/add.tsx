import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SearchResult } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage } from "@/lib/ui";

export default function AddGameScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  const search = useQuery({
    queryKey: ["game-search", query],
    queryFn: () => api.searchGames(query),
    enabled: query.length >= 2,
  });

  const add = useMutation({
    mutationFn: (r: SearchResult) =>
      api.addToLibrary(
        r.igdbId ? { igdbId: r.igdbId } : r.gameId ? { gameId: r.gameId } : { title: r.title },
      ),
    onSuccess: (d, r) => {
      setAdded((prev) => new Set(prev).add(r.title));
      queryClient.invalidateQueries({ queryKey: ["library"] });
      // straight to the new entry so status/platforms can be set right away
      router.push(`/game/${d.id}`);
    },
  });

  return (
    <View style={styles.screen}>
      <TextInput
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder="Search for a game…"
        placeholderTextColor="#71717a"
        autoFocus
        autoCapitalize="none"
      />
      <TouchableOpacity style={styles.scanBtn} onPress={() => router.replace("/scan")}>
        <Text style={styles.scanText}>🏷️  Scan barcodes instead</Text>
      </TouchableOpacity>
      {search.isLoading && <ActivityIndicator style={{ marginTop: 24 }} />}
      {search.data && !search.data.igdb && (
        <Text style={styles.warning}>
          IGDB isn't configured — ask the admin to add credentials in web Settings.
        </Text>
      )}
      <FlatList
        data={search.data?.results ?? []}
        keyExtractor={(item) => String(item.igdbId ?? item.gameId ?? item.title)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 12, paddingBottom: 24 + insets.bottom }}
        renderItem={({ item }) => {
          const isAdded = item.inLibrary || added.has(item.title);
          const cover = resolveImage(item.coverSrc);
          return (
            <View style={styles.row}>
              <View style={styles.cover}>
                {cover && (
                  <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title} numberOfLines={2}>
                  {item.title} {item.releaseYear ? `(${item.releaseYear})` : ""}
                </Text>
                <Text style={styles.platforms} numberOfLines={1}>
                  {item.platforms.join(" · ")}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.addBtn, isAdded && styles.addedBtn]}
                disabled={isAdded || add.isPending}
                onPress={() => add.mutate(item)}
              >
                <Text style={[styles.addText, isAdded && styles.addedText]}>
                  {isAdded ? "✓" : "Add"}
                </Text>
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
  input: {
    margin: 12,
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fafafa",
    fontSize: 16,
  },
  warning: { color: "#fcd34d", fontSize: 12, marginHorizontal: 16, marginBottom: 4 },
  scanBtn: {
    marginHorizontal: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  scanText: { color: "#a1a1aa", fontSize: 13, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 10,
    marginBottom: 8,
  },
  cover: { width: 42, height: 56, borderRadius: 6, backgroundColor: "#27272a", overflow: "hidden" },
  title: { color: "#fafafa", fontSize: 14, fontWeight: "600" },
  platforms: { color: "#71717a", fontSize: 11, marginTop: 3 },
  addBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addedBtn: { backgroundColor: "#022c22", borderWidth: 1, borderColor: "#065f46" },
  addText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  addedText: { color: "#6ee7b7" },
});
