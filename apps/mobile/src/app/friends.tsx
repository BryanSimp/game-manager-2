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
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FriendRequest, FriendSummary } from "@gm/shared";
import { api } from "@/lib/api";

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
      contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}
      refreshControl={
        <RefreshControl refreshing={friends.isRefetching} onRefresh={() => friends.refetch()} />
      }
    >
      <Text style={styles.intro}>
        Share your code so people can add you. Requests need accepting before anyone sees your
        library, and your notes are never shared.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Your friend code</Text>
        <View style={styles.codeRow}>
          <Text style={styles.code} selectable numberOfLines={1} adjustsFontSizeToFit>
            {data?.friendCode ?? "…"}
          </Text>
          <TouchableOpacity
            style={[styles.ghostBtn, !data && { opacity: 0.5 }]}
            disabled={!data}
            onPress={() =>
              data &&
              Share.share({ message: `Add me on Game Manager — my friend code is ${data.friendCode}` })
            }
          >
            <Text style={styles.ghostText}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Add a friend</Text>
        <View style={styles.codeRow}>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="GM-XXXX-XXXX"
            placeholderTextColor="#71717a"
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, (!code.trim() || send.isPending) && { opacity: 0.5 }]}
            disabled={!code.trim() || send.isPending}
            onPress={() => send.mutate(code.trim())}
          >
            <Text style={styles.primaryText}>{send.isPending ? "…" : "Send"}</Text>
          </TouchableOpacity>
        </View>
        {notice && <Text style={styles.notice}>{notice}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      {friends.isLoading && <ActivityIndicator style={{ marginTop: 24 }} />}

      {(data?.incoming.length ?? 0) > 0 && (
        <>
          <Text style={styles.section}>Requests for you</Text>
          {data!.incoming.map((r) => (
            <RequestRow key={r.id} request={r}>
              <TouchableOpacity style={styles.smallPrimary} onPress={() => accept.mutate(r.id)}>
                <Text style={styles.primaryText}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallGhost} onPress={() => cancel.mutate(r.id)}>
                <Text style={styles.ghostText}>Decline</Text>
              </TouchableOpacity>
            </RequestRow>
          ))}
        </>
      )}

      {(data?.outgoing.length ?? 0) > 0 && (
        <>
          <Text style={styles.section}>Waiting on them</Text>
          {data!.outgoing.map((r) => (
            <RequestRow key={r.id} request={r}>
              <TouchableOpacity style={styles.smallGhost} onPress={() => cancel.mutate(r.id)}>
                <Text style={styles.ghostText}>Withdraw</Text>
              </TouchableOpacity>
            </RequestRow>
          ))}
        </>
      )}

      <Text style={styles.section}>Friends{data ? ` (${data.friends.length})` : ""}</Text>
      {data?.friends.length === 0 && (
        <Text style={styles.empty}>No friends yet — send someone your code and they can add you.</Text>
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
    <TouchableOpacity style={styles.row} onPress={() => router.push(`/friend/${friend.userId}`)}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{friend.name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.name} numberOfLines={1}>
          {friend.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {friend.libraryCount} games · <Text style={styles.common}>{friend.gamesInCommon}</Text> in
          common
        </Text>
      </View>
      <TouchableOpacity
        hitSlop={8}
        onPress={() =>
          Alert.alert("Remove friend", `Remove ${friend.name} from your friends?`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: onRemove },
          ])
        }
      >
        <Text style={styles.removeX}>✕</Text>
      </TouchableOpacity>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function RequestRow({
  request,
  children,
}: {
  request: FriendRequest;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
        {request.name}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014" },
  intro: { color: "#a1a1aa", fontSize: 13, lineHeight: 19, marginBottom: 14 },
  card: {
    backgroundColor: "#18181b",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 14,
    marginBottom: 10,
  },
  cardLabel: { color: "#d4d4d8", fontSize: 13, fontWeight: "600", marginBottom: 8 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  code: {
    flex: 1,
    color: "#a5b4fc",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 2,
    backgroundColor: "#27272a",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fafafa",
    fontSize: 15,
    letterSpacing: 1,
  },
  primaryBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  smallPrimary: { backgroundColor: "#4f46e5", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  ghostBtn: {
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  smallGhost: {
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  ghostText: { color: "#a1a1aa", fontWeight: "600", fontSize: 13 },
  notice: { color: "#6ee7b7", fontSize: 12, marginTop: 8, lineHeight: 17 },
  error: { color: "#fcd34d", fontSize: 12, marginTop: 8, lineHeight: 17 },
  section: { color: "#d4d4d8", fontSize: 14, fontWeight: "600", marginTop: 18, marginBottom: 8 },
  empty: { color: "#71717a", fontSize: 13, lineHeight: 19 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#312e81",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#c7d2fe", fontSize: 15, fontWeight: "800" },
  name: { color: "#fafafa", fontSize: 15, fontWeight: "600" },
  meta: { color: "#71717a", fontSize: 12, marginTop: 2 },
  common: { color: "#818cf8", fontWeight: "700" },
  removeX: { color: "#52525b", fontSize: 15, padding: 4 },
  chevron: { color: "#52525b", fontSize: 22 },
});
