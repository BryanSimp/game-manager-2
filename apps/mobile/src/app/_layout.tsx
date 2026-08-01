import { Stack, Link } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Text, useColorScheme } from "react-native";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";

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

export default function RootLayout() {
  const colorScheme = useColorScheme();
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
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen
            name="index"
            options={{
              title: "Library",
              headerLeft: () => (
                <Link href="/account" style={{ marginRight: 16 }}>
                  <Text style={{ fontSize: 18 }}>👤</Text>
                </Link>
              ),
              headerRight: () => (
                <>
                  <Link href="/consoles" style={{ marginRight: 16 }}>
                    <Text style={{ fontSize: 18 }}>🕹️</Text>
                  </Link>
                  <Link href="/scan" style={{ marginRight: 16 }}>
                    <Text style={{ fontSize: 18 }}>🏷️</Text>
                  </Link>
                  <Link href="/import">
                    <Text style={{ fontSize: 18 }}>📷</Text>
                  </Link>
                </>
              ),
            }}
          />
          <Stack.Screen name="add" options={{ title: "Add game" }} />
          <Stack.Screen name="scan" options={{ title: "Scan barcode" }} />
          <Stack.Screen name="import" options={{ title: "Import" }} />
          <Stack.Screen name="consoles" options={{ title: "Consoles" }} />
          <Stack.Screen name="collections" options={{ title: "Collections" }} />
          <Stack.Screen name="collection/[id]" options={{ title: "Collection" }} />
          <Stack.Screen name="dashboard" options={{ title: "Dashboard" }} />
          <Stack.Screen name="tags" options={{ title: "Tags" }} />
          <Stack.Screen name="account" options={{ title: "Account" }} />
          <Stack.Screen name="game/[id]" options={{ title: "Game" }} />
          <Stack.Screen name="login" options={{ title: "Sign in", headerShown: false }} />
          <Stack.Screen name="register" options={{ title: "Create account", headerShown: false }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
