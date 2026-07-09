import { Redirect, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth";
import { api } from "@/lib/api";

export default function HomeScreen() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const health = useQuery({ queryKey: ["health"], queryFn: () => api.health() });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    enabled: !!session,
  });

  if (isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/login" />;
  }

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.heading}>Welcome, {session.user.name} 👋</Text>
        <Row label="Email" value={session.user.email} />
        <Row label="Role" value={me.data?.role ?? "…"} />
        <Row
          label="API status"
          value={health.isError ? "unreachable" : (health.data?.status ?? "checking…")}
        />
        <Row label="API version" value={health.data?.version ?? "…"} />
        <TouchableOpacity style={styles.signOut} onPress={signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.note}>
        Phase 0 shell — library, shelf, and import features arrive in the next phases.
      </Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, backgroundColor: "#101014" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#101014" },
  card: {
    backgroundColor: "#18181b",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 20,
  },
  heading: { color: "#fafafa", fontSize: 18, fontWeight: "700", marginBottom: 16 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#27272a",
  },
  rowLabel: { color: "#71717a", fontSize: 14 },
  rowValue: { color: "#e4e4e7", fontSize: 14, textTransform: "capitalize" },
  signOut: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 10,
    paddingVertical: 10,
  },
  signOutText: { color: "#d4d4d8", textAlign: "center", fontWeight: "600" },
  note: { color: "#52525b", fontSize: 13, marginTop: 16, textAlign: "center" },
});
