import { useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectionSummary, PublicCollection } from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage } from "@/lib/ui";
import { colors, radius, space, type } from "@/lib/theme";
import {
  Button,
  Card,
  Chevron,
  Chip,
  ChipBar,
  Cover,
  EmptyState,
  Field,
  Icon,
  ProgressBar,
  Screen,
} from "@/components/ui";

type Tab = "mine" | "public";

export default function CollectionsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("mine");
  const [name, setName] = useState("");

  const collections = useQuery({ queryKey: ["collections"], queryFn: () => api.getCollections() });
  const publicOnes = useQuery({
    queryKey: ["public-collections"],
    queryFn: () => api.getPublicCollections(),
    enabled: tab === "public",
  });

  const create = useMutation({
    mutationFn: (n: string) => api.createCollection({ name: n }),
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const adopt = useMutation({
    mutationFn: (id: string) => api.adoptCollection(id),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["public-collections"] });
      router.push(`/collection/${created.id}`);
    },
  });

  return (
    <Screen>
      <ChipBar style={{ marginTop: space.sm }}>
        <Chip label="Yours" active={tab === "mine"} onPress={() => setTab("mine")} />
        <Chip
          label="Public"
          icon="star-outline"
          active={tab === "public"}
          onPress={() => setTab("public")}
        />
      </ChipBar>

      {tab === "mine" ? (
        <>
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
            renderItem={({ item }) => (
              <MineCard
                collection={item}
                onPress={() => router.push(`/collection/${item.id}`)}
              />
            )}
          />
        </>
      ) : (
        <FlatList
          data={publicOnes.data ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: space.md, paddingBottom: space.xxl + insets.bottom }}
          refreshControl={
            <RefreshControl
              refreshing={publicOnes.isRefetching}
              onRefresh={() => publicOnes.refetch()}
            />
          }
          ListEmptyComponent={
            publicOnes.isLoading ? (
              <ActivityIndicator style={{ marginTop: 48 }} color={colors.accentBorder} />
            ) : (
              <EmptyState
                icon="star-outline"
                title="Nothing published yet"
                text="Open one of your collections and publish it to share it."
              />
            )
          }
          renderItem={({ item }) => (
            <PublicCard
              collection={item}
              busy={adopt.isPending}
              onAdopt={() => adopt.mutate(item.id)}
              onOpen={() => router.push(`/collection/${item.id}`)}
            />
          )}
        />
      )}
    </Screen>
  );
}

/** Cover strip shared by both card kinds. */
function Covers({ preview }: { preview: Array<{ gameId: string; title: string; coverSrc: string | null }> }) {
  if (preview.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6, paddingTop: space.sm }}
    >
      {preview.map((g) => (
        <Cover key={g.gameId} src={resolveImage(g.coverSrc)} width={38} height={51} title={g.title} />
      ))}
    </ScrollView>
  );
}

function MineCard({
  collection: c,
  onPress,
}: {
  collection: CollectionSummary;
  onPress: () => void;
}) {
  const accent = c.accentColor ?? colors.accent;
  const pct = c.total > 0 ? Math.round((c.finished / c.total) * 100) : 0;
  return (
    <Card style={styles.card} onPress={onPress} accessibilityLabel={c.name}>
      <View style={styles.cardTop}>
        <View style={[styles.accent, { backgroundColor: accent }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.titleRow}>
            {c.isPublic && <Icon name="star" size={14} color={colors.star} />}
            <Text style={[type.bodyStrong, { flex: 1 }]} numberOfLines={1}>
              {c.name}
            </Text>
            {c.adoptedFromId && (
              <View style={styles.copiedTag}>
                <Text style={type.micro}>copy</Text>
              </View>
            )}
          </View>
          {c.description ? (
            <Text style={[type.caption, { marginTop: 2 }]} numberOfLines={1}>
              {c.description}
            </Text>
          ) : null}
          <View style={{ marginTop: space.sm }}>
            <ProgressBar percent={pct} color={accent} />
          </View>
          <Text style={[type.micro, { marginTop: space.xs }]}>
            {c.finished}/{c.total} finished
          </Text>
        </View>
        <Chevron />
      </View>
      <Covers preview={c.preview} />
    </Card>
  );
}

function PublicCard({
  collection: c,
  busy,
  onAdopt,
  onOpen,
}: {
  collection: PublicCollection;
  busy: boolean;
  onAdopt: () => void;
  onOpen: () => void;
}) {
  const accent = c.accentColor ?? colors.accent;
  return (
    <Card style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.accent, { backgroundColor: accent }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.titleRow}>
            <Icon name="star" size={14} color={colors.star} />
            <Text style={[type.bodyStrong, { flex: 1 }]} numberOfLines={1}>
              {c.name}
            </Text>
          </View>
          <Text style={[type.micro, { marginTop: 2 }]} numberOfLines={1}>
            by {c.mine ? "you" : c.authorName} · {c.total} games
          </Text>
          {c.description ? (
            <Text style={[type.caption, { marginTop: 2 }]} numberOfLines={2}>
              {c.description}
            </Text>
          ) : null}
        </View>
      </View>
      <Covers preview={c.preview} />
      <Button
        label={c.mine ? "Open yours" : c.adopted ? "Save another copy" : "Save a copy"}
        icon={c.mine ? "open-outline" : "download-outline"}
        tone="ghost"
        fill
        busy={busy}
        style={{ marginTop: space.md }}
        onPress={c.mine ? onOpen : onAdopt}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  card: { marginBottom: space.sm },
  cardTop: { flexDirection: "row", alignItems: "center", gap: space.md },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  accent: { width: 4, alignSelf: "stretch", borderRadius: radius.sm },
  copiedTag: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
});
