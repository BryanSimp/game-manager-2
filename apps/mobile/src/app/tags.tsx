import { useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { colors, radius, space, type } from "@/lib/theme";
import { Button, Card, EmptyState, Field, IconButton, Screen } from "@/components/ui";

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
    <Screen>
      <View style={styles.createBox}>
        <Field
          value={name}
          onChangeText={setName}
          placeholder="New tag…"
          returnKeyType="done"
          onSubmitEditing={() => name.trim() && create.mutate()}
        />
        <View style={styles.paletteRow}>
          {TAG_COLORS.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityLabel={`Use colour ${c}`}
              accessibilityState={{ selected: color === c }}
              style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
              onPress={() => setColor(c)}
            />
          ))}
          <Button
            label="Add"
            icon="add"
            disabled={!name.trim()}
            busy={create.isPending}
            onPress={() => create.mutate()}
            style={styles.addBtn}
          />
        </View>
      </View>

      <FlatList
        data={tags.data ?? []}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.md, paddingBottom: space.xxl + insets.bottom }}
        ListEmptyComponent={
          tags.isLoading ? (
            <ActivityIndicator style={{ marginTop: 48 }} color={colors.accentBorder} />
          ) : (
            <EmptyState icon="pricetags-outline" title="No tags yet" text="Create one above." />
          )
        }
        renderItem={({ item }) => {
          const tagColor = item.color ?? colors.textFaint;
          return (
            <Card style={styles.row}>
              <View style={[styles.dot, { backgroundColor: tagColor }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={type.bodyStrong} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.groupName ? <Text style={type.micro}>{item.groupName}</Text> : null}
                <View style={styles.paletteRow}>
                  {TAG_COLORS.map((c) => (
                    <Pressable
                      key={c}
                      accessibilityRole="button"
                      accessibilityLabel={`Recolour ${item.name}`}
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
              <IconButton
                name="trash-outline"
                accessibilityLabel={`Delete ${item.name}`}
                onPress={() =>
                  Alert.alert("Delete tag", `Delete "${item.name}"? It's removed from all games.`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => remove.mutate(item.id) },
                  ])
                }
              />
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  createBox: { padding: space.md, paddingBottom: 0, gap: space.sm },
  paletteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    marginTop: 6,
  },
  swatch: { width: 26, height: 26, borderRadius: 13 },
  swatchSm: { width: 20, height: 20, borderRadius: 10 },
  swatchActive: { borderWidth: 2, borderColor: colors.text },
  addBtn: { marginLeft: "auto", minHeight: 36, paddingHorizontal: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.sm },
  dot: { width: 14, height: 14, borderRadius: 7 },
});
