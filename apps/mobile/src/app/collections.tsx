import { useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { colors, radius, space, type } from "@/lib/theme";
import { Button, Card, Chevron, EmptyState, Field, ProgressBar, Screen } from "@/components/ui";

export default function CollectionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    <Screen>
      <View style={styles.createRow}>
        <Field
          style={{ flex: 1 }}
          value={name}
          onChangeText={setName}
          placeholder="New collection…"
          returnKeyType="done"
          onSubmitEditing={() => name.trim() && create.mutate(name.trim())}
        />
        <Button
          label="Create"
          icon="add"
          disabled={!name.trim()}
          busy={create.isPending}
          onPress={() => create.mutate(name.trim())}
        />
      </View>
      <FlatList
        data={collections.data ?? []}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.md, paddingBottom: space.xxl + insets.bottom }}
        refreshControl={
          <RefreshControl
            refreshing={collections.isRefetching}
            onRefresh={() => collections.refetch()}
          />
        }
        ListEmptyComponent={
          collections.isLoading ? (
            <ActivityIndicator style={{ marginTop: 48 }} color={colors.accentBorder} />
          ) : (
            <EmptyState
              icon="albums-outline"
              title="No collections yet"
              text="Series and franchises live here — name one above to start."
            />
          )
        }
        renderItem={({ item }) => {
          const accent = item.accentColor ?? colors.accent;
          const pct = item.total > 0 ? Math.round((item.finished / item.total) * 100) : 0;
          return (
            <Card
              style={styles.row}
              onPress={() => router.push(`/collection/${item.id}`)}
              accessibilityLabel={item.name}
            >
              <View style={[styles.accent, { backgroundColor: accent }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={type.bodyStrong} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.description ? (
                  <Text style={[type.caption, { marginTop: 2 }]} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : null}
                <View style={{ marginTop: space.sm }}>
                  <ProgressBar percent={pct} color={accent} />
                </View>
                <Text style={[type.micro, { marginTop: space.xs }]}>
                  {item.finished}/{item.total} finished
                </Text>
              </View>
              <Chevron />
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
    paddingBottom: 0,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.sm },
  accent: { width: 4, alignSelf: "stretch", borderRadius: radius.sm },
});
