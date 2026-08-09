import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SearchResult } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage } from "@/lib/ui";
import { colors, radius, space, type } from "@/lib/theme";
import { Button, Cover, EmptyState, Field, Icon, Screen } from "@/components/ui";

export default function AddGameScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  // `?q=` pre-types a title the app already knows — a friend's game you don't
  // own arrives here rather than at a game page, so the least it can do is
  // not make you type the name back in
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [input, setInput] = useState(q ?? "");
  const [query, setQuery] = useState(q?.trim() ?? "");
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
    <Screen>
      <View style={styles.head}>
        <View style={styles.searchWrap}>
          <Icon name="search" size={16} color={colors.textFaint} />
          <Field
            style={styles.search}
            value={input}
            onChangeText={setInput}
            placeholder="Search for a game…"
            autoFocus
            autoCapitalize="none"
            returnKeyType="search"
          />
        </View>
        <Button
          label="Scan barcodes instead"
          tone="ghost"
          icon="barcode-outline"
          fill
          onPress={() => router.replace("/scan")}
        />
        {search.data && !search.data.igdb && (
          <View style={styles.warning}>
            <Icon name="alert-circle-outline" size={15} color={colors.warning} />
            <Text style={[type.caption, { flex: 1, color: colors.warning }]}>
              IGDB isn't configured — ask the admin to add credentials in web Settings.
            </Text>
          </View>
        )}
      </View>

      <FlatList
        data={search.data?.results ?? []}
        keyExtractor={(item) => String(item.igdbId ?? item.gameId ?? item.title)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.md, paddingBottom: space.xxl + insets.bottom }}
        ListEmptyComponent={
          search.isLoading ? (
            <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.accentBorder} />
          ) : query.length >= 2 ? (
            <EmptyState icon="search-outline" title="No games found" text={`Nothing matches “${query}”.`} />
          ) : (
            <EmptyState
              icon="search-outline"
              title="Search the catalog"
              text="Type at least two letters, or scan a barcode."
            />
          )
        }
        renderItem={({ item }) => {
          const isAdded = item.inLibrary || added.has(item.title);
          return (
            <View style={styles.row}>
              <Cover src={resolveImage(item.coverSrc)} width={44} height={58} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={type.bodyStrong} numberOfLines={2}>
                  {item.title}
                  {item.releaseYear ? ` (${item.releaseYear})` : ""}
                </Text>
                {item.platforms.length > 0 && (
                  <Text style={[type.micro, { marginTop: 3 }]} numberOfLines={1}>
                    {item.platforms.join(" · ")}
                  </Text>
                )}
              </View>
              {isAdded ? (
                <View style={styles.addedTag}>
                  <Icon name="checkmark" size={15} color={colors.success} />
                  <Text style={[type.micro, { color: colors.success }]}>In library</Text>
                </View>
              ) : (
                <Button
                  label="Add"
                  busy={add.isPending && add.variables?.title === item.title}
                  disabled={add.isPending}
                  onPress={() => add.mutate(item)}
                  style={styles.addBtn}
                />
              )}
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { padding: space.md, gap: space.sm },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingLeft: space.md,
  },
  search: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingRight: space.md,
  },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: "#451a03",
    borderRadius: radius.sm,
    padding: space.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.sm + 2,
    marginBottom: space.sm,
  },
  addBtn: { minHeight: 38, paddingHorizontal: space.lg },
  addedTag: { flexDirection: "row", alignItems: "center", gap: 3 },
});
