import { Stack, Link, type Href } from "expo-router";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Text, View, StyleSheet } from "react-native";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";

const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // keep a week of offline data

const SCREEN_BG = "#101014";

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
  colors: { ...DarkTheme.colors, background: SCREEN_BG, card: "#18181b", border: "#27272a" },
};

/** Header icons need a row container of their own — a bare fragment stacks them. */
function HeaderIcon({ href, glyph, label }: { href: Href; glyph: string; label: string }) {
  return (
    <Link href={href} accessibilityLabel={label} style={styles.headerIcon}>
      <Text style={styles.headerGlyph}>{glyph}</Text>
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
            contentStyle: { backgroundColor: SCREEN_BG },
            headerTitleStyle: { fontSize: 17 },
          }}
        >
          <Stack.Screen
            name="index"
            options={{
              title: "Library",
              headerLeft: () => (
                <View style={styles.headerRow}>
                  <HeaderIcon href="/account" glyph="👤" label="Account" />
                </View>
              ),
              headerRight: () => (
                <View style={styles.headerRow}>
                  <HeaderIcon href="/friends" glyph="👥" label="Friends" />
                  <HeaderIcon href="/consoles" glyph="🕹️" label="Consoles" />
                  <HeaderIcon href="/scan" glyph="🏷️" label="Scan barcodes" />
                  <HeaderIcon href="/import" glyph="📷" label="Import" />
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
  // tall enough to tap, tight enough that four of them still leave the title room
  headerIcon: { paddingHorizontal: 5, paddingVertical: 10 },
  headerGlyph: { fontSize: 16, lineHeight: 21 },
});
