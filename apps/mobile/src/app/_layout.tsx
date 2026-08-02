import { Stack, Link, type Href } from "expo-router";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Pressable, StyleSheet, View } from "react-native";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { Icon, type IconName } from "@/components/ui";
import { colors, type } from "@/lib/theme";

const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // keep a week of offline data

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // gcTime must outlive maxAge or persisted queries get dropped on restore
      gcTime: CACHE_MAX_AGE,
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
});

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "gm2-query-cache",
  throttleTime: 2000,
});

/**
 * Every screen paints its own zinc-950 background, so the navigator has to be
 * dark too — following the system scheme gave a white header and a white flash
 * between screens on a light phone. Light mode is a Phase 6 job for both apps.
 */
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    border: colors.border,
    text: colors.text,
    primary: colors.accentBorder,
  },
};

/**
 * Header icons need a row container of their own — a bare fragment stacks
 * them — and an icon-font glyph rather than an emoji, which no line height
 * could reliably centre.
 */
function HeaderIcon({ href, name, label }: { href: Href; name: IconName; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        hitSlop={6}
        style={({ pressed }) => [styles.headerIcon, pressed && { opacity: 0.6 }]}
      >
        <Icon name={name} size={21} color={colors.textMuted} />
      </Pressable>
    </Link>
  );
}

export default function RootLayout() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE,
        // one-off responses that are useless offline don't need persisting
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" &&
            !["game-search", "barcode"].includes(String(query.queryKey[0])),
        },
      }}
    >
      <ThemeProvider value={navigationTheme}>
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colors.bg },
            headerStyle: { backgroundColor: colors.bg },
            headerTitleStyle: type.heading,
            headerShadowVisible: false,
            headerTintColor: colors.textMuted,
          }}
        >
          <Stack.Screen
            name="index"
            options={{
              title: "Library",
              headerLeft: () => (
                <View style={styles.headerRow}>
                  <HeaderIcon href="/account" name="person-circle-outline" label="Account" />
                </View>
              ),
              headerRight: () => (
                <View style={styles.headerRow}>
                  <HeaderIcon href="/friends" name="people-outline" label="Friends" />
                  <HeaderIcon href="/consoles" name="game-controller-outline" label="Consoles" />
                  <HeaderIcon href="/scan" name="barcode-outline" label="Scan barcodes" />
                  <HeaderIcon href="/import" name="camera-outline" label="Import" />
                </View>
              ),
            }}
          />
          <Stack.Screen name="add" options={{ title: "Add game" }} />
          <Stack.Screen name="scan" options={{ title: "Scan barcodes" }} />
          <Stack.Screen name="import" options={{ title: "Import" }} />
          <Stack.Screen name="consoles" options={{ title: "Consoles" }} />
          <Stack.Screen name="console/[platformId]" options={{ title: "Console" }} />
          <Stack.Screen name="collections" options={{ title: "Collections" }} />
          <Stack.Screen name="collection/[id]" options={{ title: "Collection" }} />
          <Stack.Screen name="friends" options={{ title: "Friends" }} />
          <Stack.Screen name="friend/[userId]" options={{ title: "Friend" }} />
          <Stack.Screen name="dashboard" options={{ title: "Dashboard" }} />
          <Stack.Screen name="tags" options={{ title: "Tags" }} />
          <Stack.Screen name="account" options={{ title: "Account" }} />
          <Stack.Screen name="game/[id]" options={{ title: "Game" }} />
          <Stack.Screen name="login" options={{ title: "Sign in", headerShown: false }} />
          <Stack.Screen name="register" options={{ title: "Create account", headerShown: false }} />
        </Stack>
        <StatusBar style="light" />
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center" },
  headerIcon: { paddingHorizontal: 7, paddingVertical: 8 },
});
