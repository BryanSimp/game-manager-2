import { Stack, useRouter, type Href } from "expo-router";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Pressable, StyleSheet } from "react-native";
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
 * A header button, centred in a fixed square.
 *
 * This deliberately doesn't use `<Link asChild>`: the link clones its child
 * and wins the `style` prop, so the sizing never landed and the glyph was
 * left baseline-positioned in a 24pt box jammed against the screen edge.
 * Pushing the route by hand keeps the box.
 */
function HeaderIcon({ href, name, label }: { href: Href; name: IconName; label: string }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.headerIcon, pressed && { opacity: 0.6 }]}
    >
      <Icon name={name} size={24} color={colors.textMuted} />
    </Pressable>
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
              // one way in, top left: the account hub already lists consoles,
              // friends, scanning and import, so a second row of header icons
              // was duplicating it
              headerLeft: () => (
                <HeaderIcon href="/account" name="person-circle-outline" label="Account" />
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
  headerIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    // the web header gives headerLeft no inset of its own
    marginLeft: 4,
  },
});
