import { useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FriendRequest, FriendSummary } from "@gm/shared";
import { api } from "@/lib/api";
import { colors, radius, space, type } from "@/lib/theme";
import {
  Button,
  Card,
  Chevron,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Screen,
  SectionTitle,
} from "@/components/ui";

/**
 * Friends: your code, requests in both directions, and who you're friends
 * with. Adding someone is a request they have to accept — a code on its own
 * never exposes a library. Mirrors the web page; sharing replaces "copy"
 * because React Native dropped the clipboard from core.
 */
export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const friends = useQuery({ queryKey: ["friends"], queryFn: () => api.getFriends() });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["friends"] });

  const send = useMutation({
    mutationFn: (c: string) => api.sendFriendRequest(c),
    onSuccess: (res) => {
      setError(null);
      setCode("");
      setNotice(
        res.status === "accepted"
          ? `You and ${res.name} are now friends — they'd already sent you a request.`
          : `Request sent to ${res.name}. You'll see their library once they accept.`,
      );
      invalidate();
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const accept = useMutation({
    mutationFn: (id: string) => api.acceptFriendRequest(id),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelFriendRequest(id),
    onSuccess: invalidate,
  });
  const unfriend = useMutation({
    mutationFn: (userId: string) => api.removeFriend(userId),
    onSuccess: invalidate,
  });

  const data = friends.data;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl + insets.bottom }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={friends.isRefetching} onRefresh={() => friends.refetch()} />
      }
    >
      <Text style={type.prose}>
        Share your code so people can add you. Requests need accepting before anyone sees your
        library, and your notes are never shared.
      </Text>

      <Card style={styles.card}>
        <Text style={[type.label, { color: colors.textMuted }]}>Your friend code</Text>
        <View style={styles.codeRow}>
          <View style={styles.codeWell}>
            <Text style={styles.code} selectable numberOfLines={1} adjustsFontSizeToFit>
              {data?.friendCode ?? "…"}
            </Text>
          </View>
          <Button
            label="Share"
            tone="ghost"
            icon="share-outline"
            disabled={!data}
            onPress={() =>
              data &&
              Share.share({
                message: `Add me on Game Manager — my friend code is ${data.friendCode}`,
              })
            }
          />
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={[type.label, { color: colors.textMuted }]}>Add a friend</Text>
        <View style={styles.codeRow}>
          <Field
            style={{ flex: 1, letterSpacing: 1 }}
            value={code}
            onChangeText={setCode}
            placeholder="GM-XXXX-XXXX"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={() => code.trim() && send.mutate(code.trim())}
          />
          <Button
            label="Send"
            icon="paper-plane-outline"
            disabled={!code.trim()}
            busy={send.isPending}
            onPress={() => send.mutate(code.trim())}
          />
        </View>
        {notice && (
          <View style={styles.noticeRow}>
            <Icon name="checkmark-circle" size={14} color={colors.success} />
            <Text style={[type.caption, styles.noticeText, { color: colors.success }]}>{notice}</Text>
          </View>
        )}
        {error && (
          <View style={styles.noticeRow}>
            <Icon name="alert-circle" size={14} color={colors.warning} />
            <Text style={[type.caption, styles.noticeText, { color: colors.warning }]}>{error}</Text>
          </View>
        )}
      </Card>

      {friends.isLoading && (
        <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.accentBorder} />
      )}

      {(data?.incoming.length ?? 0) > 0 && (
        <>
          <SectionTitle>Requests for you</SectionTitle>
          {data!.incoming.map((r) => (
            <RequestRow key={r.id} request={r}>
              <Button label="Accept" onPress={() => accept.mutate(r.id)} style={styles.smallBtn} />
              <Button
                label="Decline"
                tone="ghost"
                onPress={() => cancel.mutate(r.id)}
                style={styles.smallBtn}
              />
            </RequestRow>
          ))}
        </>
      )}

      {(data?.outgoing.length ?? 0) > 0 && (
        <>
          <SectionTitle>Waiting on them</SectionTitle>
          {data!.outgoing.map((r) => (
            <RequestRow key={r.id} request={r}>
              <Button
                label="Withdraw"
                tone="ghost"
                onPress={() => cancel.mutate(r.id)}
                style={styles.smallBtn}
              />
            </RequestRow>
          ))}
        </>
      )}

      <SectionTitle>Friends{data ? ` (${data.friends.length})` : ""}</SectionTitle>
      {data?.friends.length === 0 && (
        <EmptyState
          icon="people-outline"
          title="No friends yet"
          text="Send someone your code and they can add you."
        />
      )}
      {(data?.friends ?? []).map((f) => (
        <FriendRow key={f.userId} friend={f} onRemove={() => unfriend.mutate(f.userId)} />
      ))}
    </ScrollView>
  );
}

function FriendRow({ friend, onRemove }: { friend: FriendSummary; onRemove: () => void }) {
  const router = useRouter();
  return (
    <Card
      style={styles.row}
      onPress={() => router.push(`/friend/${friend.userId}`)}
      accessibilityLabel={`${friend.name}'s library`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{friend.name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type.bodyStrong} numberOfLines={1}>
          {friend.name}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          {friend.libraryCount} games ·{" "}
          <Text style={{ color: colors.accentBorder, fontWeight: "700" }}>
            {friend.gamesInCommon}
          </Text>{" "}
          in common
        </Text>
      </View>
      <IconButton
        name="person-remove-outline"
        accessibilityLabel={`Remove ${friend.name}`}
        onPress={() =>
          Alert.alert("Remove friend", `Remove ${friend.name} from your friends?`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: onRemove },
          ])
        }
      />
      <Chevron />
    </Card>
  );
}

function RequestRow({ request, children }: { request: FriendRequest; children: React.ReactNode }) {
  return (
    <Card style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{request.name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <Text style={[type.bodyStrong, { flex: 1, minWidth: 0 }]} numberOfLines={1}>
        {request.name}
      </Text>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { marginTop: space.md, gap: space.sm },
  codeRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  codeWell: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  code: {
    color: colors.accentText,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "700",
    letterSpacing: 2,
  },
  noticeRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  noticeText: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm },
  smallBtn: { minHeight: 36, paddingHorizontal: space.md },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.accentText, fontSize: 16, lineHeight: 22, fontWeight: "800" },
});
