import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BUILTIN_CATEGORIES,
  type CollectionSummary,
  type OwnershipFormat,
  type PublicCollection,
} from "@gm/shared";
import { api } from "@/lib/api";
import { resolveImage } from "@/lib/ui";
import { groupConsoles } from "@/lib/platforms";
import { colors, radius, space, type } from "@/lib/theme";
import {
  Button,
  Card,
  Chevron,
  Chip,
  ChipBar,
  CollectionTimeLine,
  Cover,
  EmptyState,
  Field,
  Icon,
  OptionRow,
  ProgressBar,
  Screen,
  Sheet,
  SheetSection,
  VoteRow,
} from "@/components/ui";

type Tab = "mine" | "public";

export default function CollectionsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("mine");
  const [name, setName] = useState("");
  const [addingAll, setAddingAll] = useState<PublicCollection | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  // settle the text before it becomes a query key, so typing isn't a request each
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const collections = useQuery({ queryKey: ["collections"], queryFn: () => api.getCollections() });
  const publicOnes = useQuery({
    queryKey: ["public-collections", query],
    queryFn: () => api.getPublicCollections({ q: query || undefined }),
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

  const vote = useMutation({
    mutationFn: ({ id, value }: { id: string; value: 1 | 0 | -1 }) => api.voteCollection(id, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["public-collections"] }),
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
          data={publicOnes.data?.items ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: space.md, paddingBottom: space.xxl + insets.bottom }}
          refreshControl={
            <RefreshControl
              refreshing={publicOnes.isRefetching}
              onRefresh={() => publicOnes.refetch()}
            />
          }
          ListHeaderComponent={
            <Field
              value={search}
              onChangeText={setSearch}
              placeholder="Search by collection or game"
              autoCorrect={false}
              style={{ marginBottom: space.md }}
            />
          }
          ListEmptyComponent={
            publicOnes.isLoading ? (
              <ActivityIndicator style={{ marginTop: 48 }} color={colors.accentBorder} />
            ) : query ? (
              <EmptyState
                icon="search-outline"
                title="Nothing matches that"
                text="Try a game name — the search looks inside collections too."
              />
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
              onAddAll={() => setAddingAll(item)}
              onVote={(value) => vote.mutate({ id: item.id, value })}
            />
          )}
        />
      )}

      <AddAllSheet collection={addingAll} onClose={() => setAddingAll(null)} />
    </Screen>
  );
}

/**
 * "Add every game in this collection to my library" — the reason to browse
 * someone else's. Category and platform are chosen up front, because dropping
 * a dozen games into Uncategorized on no console is worse than no button.
 */
function AddAllSheet({
  collection,
  onClose,
}: {
  collection: PublicCollection | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("wishlist");
  const [platformId, setPlatformId] = useState<string | null>(null);
  const [format, setFormat] = useState<OwnershipFormat>("digital");

  const consoles = useQuery({
    queryKey: ["consoles"],
    queryFn: () => api.getConsoles(),
    enabled: !!collection,
  });

  const add = useMutation({
    mutationFn: () =>
      api.addCollectionToLibrary(collection!.id, {
        status,
        platforms: platformId ? [{ platformId, format }] : undefined,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["consoles"] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      Alert.alert(
        "Added to your library",
        `${res.added} added${res.skipped > 0 ? ` · ${res.skipped} already yours` : ""}`,
        [{ text: "OK", onPress: onClose }],
      );
    },
  });

  const platforms = groupConsoles(consoles.data ?? []).flatMap((group) => [
    { id: group.console.platform.id, label: group.console.platform.name, child: false },
    ...group.storefronts.map((s) => ({ id: s.platform.id, label: s.platform.name, child: true })),
  ]);

  return (
    <Sheet
      visible={!!collection}
      title={collection ? `Add ${collection.total} games` : "Add games"}
      onClose={onClose}
    >
      <Text style={type.caption}>
        Games you already own are left as they are — only the platform is applied to those.
      </Text>

      <SheetSection label="Category" />
      {BUILTIN_CATEGORIES.map((c) => (
        <OptionRow
          key={c.key}
          label={c.label}
          tint={c.color}
          selected={status === c.key}
          onPress={() => setStatus(c.key)}
        />
      ))}

      <SheetSection label="Platform · optional" />
      <OptionRow
        label="Don't set a platform"
        selected={platformId === null}
        onPress={() => setPlatformId(null)}
      />
      {platforms.map((p) => (
        <OptionRow
          key={p.id}
          label={p.label}
          icon={p.child ? "storefront-outline" : undefined}
          indent={p.child}
          selected={platformId === p.id}
          onPress={() => setPlatformId(platformId === p.id ? null : p.id)}
        />
      ))}
      {platformId && (
        <View style={styles.formatRow}>
          <Button
            label="Digital"
            icon="cloud-download-outline"
            tone={format === "digital" ? "primary" : "ghost"}
            fill
            onPress={() => setFormat("digital")}
            style={styles.formatBtn}
          />
          <Button
            label="Physical"
            icon="cube-outline"
            tone={format === "physical" ? "primary" : "ghost"}
            fill
            onPress={() => setFormat("physical")}
            style={styles.formatBtn}
          />
        </View>
      )}

      {add.isError && (
        <Text style={[type.caption, { color: colors.danger, marginTop: space.sm }]}>
          {add.error instanceof Error ? add.error.message : "Couldn't add those games"}
        </Text>
      )}
      <Button
        label={collection ? `Add ${collection.total} to library` : "Add"}
        icon="download-outline"
        fill
        busy={add.isPending}
        style={{ marginTop: space.md }}
        onPress={() => add.mutate()}
      />
    </Sheet>
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
          <CollectionTimeLine time={c.time} compact />
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
  onAddAll,
  onVote,
}: {
  collection: PublicCollection;
  busy: boolean;
  onAdopt: () => void;
  onOpen: () => void;
  onAddAll: () => void;
  onVote: (value: 1 | 0 | -1) => void;
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
          <View style={styles.byRow}>
            <Text style={[type.micro, { flex: 1 }]} numberOfLines={1}>
              by {c.mine ? "you" : c.authorName} · {c.total} games
            </Text>
            {/* no vote control on your own — the API refuses it anyway */}
            {c.mine ? null : <VoteRow votes={c.votes} onVote={onVote} />}
          </View>
          {c.description ? (
            <Text style={[type.caption, { marginTop: 2 }]} numberOfLines={2}>
              {c.description}
            </Text>
          ) : null}
          {/* how long someone else's marathon is — most of what you want to
              know before copying it */}
          <CollectionTimeLine time={c.time} compact />
        </View>
      </View>
      <Covers preview={c.preview} />
      <View style={styles.cardActions}>
        <Button
          label={c.mine ? "Open yours" : c.adopted ? "Copy again" : "Save a copy"}
          icon={c.mine ? "open-outline" : "duplicate-outline"}
          tone="ghost"
          fill
          busy={busy}
          onPress={c.mine ? onOpen : onAdopt}
          style={styles.cardBtn}
        />
        <Button
          label="Add all"
          icon="library-outline"
          fill
          disabled={c.total === 0}
          onPress={onAddAll}
          style={styles.cardBtn}
        />
      </View>
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
  byRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 2 },
  accent: { width: 4, alignSelf: "stretch", borderRadius: radius.sm },
  copiedTag: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  cardActions: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  cardBtn: { minHeight: 40 },
  formatRow: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  formatBtn: { minHeight: 40 },
});
