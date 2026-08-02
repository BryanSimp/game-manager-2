import { useRouter, type Href } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth";
import { colors, radius, space, type } from "@/lib/theme";
import { Button, Card, Chevron, Icon, Screen, type IconName } from "@/components/ui";

const LINKS: Array<{ href: Href; icon: IconName; label: string; note: string }> = [
  { href: "/dashboard", icon: "stats-chart-outline", label: "Dashboard", note: "Stats, backlog hours, recent finishes" },
  { href: "/consoles", icon: "game-controller-outline", label: "Consoles", note: "What you own, and your games on each" },
  { href: "/friends", icon: "people-outline", label: "Friends", note: "Your code, requests, their libraries" },
  { href: "/collections", icon: "albums-outline", label: "Collections", note: "Series and play-order lists" },
  { href: "/tags", icon: "pricetags-outline", label: "Tags", note: "Create, recolor, delete" },
  { href: "/scan", icon: "barcode-outline", label: "Scan barcodes", note: "Batch-scan a shelf of cases" },
  { href: "/import", icon: "camera-outline", label: "Import", note: "Screenshot / shelf photo OCR" },
];

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const name = session?.user.name ?? session?.user.email ?? "?";

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl + insets.bottom }}>
        <Card style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={type.heading} numberOfLines={1}>
              {session?.user.name ?? "—"}
            </Text>
            <Text style={type.caption} numberOfLines={1}>
              {session?.user.email ?? ""}
            </Text>
          </View>
        </Card>

        {LINKS.map((link) => (
          <Card
            key={link.label}
            style={styles.row}
            onPress={() => router.push(link.href)}
            accessibilityLabel={link.label}
          >
            <View style={styles.iconWell}>
              <Icon name={link.icon} size={18} color={colors.accentText} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={type.bodyStrong} numberOfLines={1}>
                {link.label}
              </Text>
              <Text style={type.micro} numberOfLines={2}>
                {link.note}
              </Text>
            </View>
            <Chevron />
          </Card>
        ))}

        <Button
          label="Sign out"
          tone="danger"
          icon="log-out-outline"
          style={{ marginTop: space.lg }}
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
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    marginBottom: space.lg,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.accentText, fontSize: 20, lineHeight: 27, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.sm },
  iconWell: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
});
