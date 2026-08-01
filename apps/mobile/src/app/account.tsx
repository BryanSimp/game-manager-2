import { useRouter, type Href } from "expo-router";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth";

const LINKS: Array<{ href: Href; icon: string; label: string; note: string }> = [
  { href: "/dashboard", icon: "📊", label: "Dashboard", note: "Stats, backlog hours, recent finishes" },
  { href: "/consoles", icon: "🕹️", label: "Consoles", note: "What you own, and your games on each" },
  { href: "/collections", icon: "🗂️", label: "Collections", note: "Series and play-order lists" },
  { href: "/tags", icon: "🏷️", label: "Tags", note: "Create, recolor, delete" },
  { href: "/import", icon: "📷", label: "Import", note: "Screenshot / shelf photo OCR" },
];

export default function AccountScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  return (
    <View style={styles.screen}>
      <View style={styles.userCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(session?.user.name ?? session?.user.email ?? "?").slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>
            {session?.user.name ?? "—"}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {session?.user.email ?? ""}
          </Text>
        </View>
      </View>

      {LINKS.map((link) => (
        <TouchableOpacity key={link.label} style={styles.row} onPress={() => router.push(link.href)}>
          <Text style={styles.icon}>{link.icon}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.label}>{link.label}</Text>
            <Text style={styles.note}>{link.note}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity
        style={styles.signOut}
        onPress={() =>
          Alert.alert("Sign out", "Sign out of this device?", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Sign out",
              style: "destructive",
              onPress: async () => {
                await authClient.signOut();
                queryClient.clear();
                router.replace("/login");
              },
            },
          ])
        }
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101014", padding: 16 },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#18181b",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 14,
    marginBottom: 16,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#312e81",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#c7d2fe", fontSize: 18, fontWeight: "800" },
  name: { color: "#fafafa", fontSize: 16, fontWeight: "700" },
  email: { color: "#71717a", fontSize: 12, marginTop: 2 },
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
  icon: { fontSize: 18 },
  label: { color: "#fafafa", fontSize: 14, fontWeight: "600" },
  note: { color: "#71717a", fontSize: 11, marginTop: 2 },
  chevron: { color: "#52525b", fontSize: 22 },
  signOut: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#7f1d1d",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  signOutText: { color: "#f87171", fontWeight: "600" },
});
