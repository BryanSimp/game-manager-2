import { DarkTheme, DefaultTheme, ThemeProvider, Stack, Link } from "expo-router";
import { Text, useColorScheme } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";

const queryClient = new QueryClient();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen
            name="index"
            options={{
              title: "Library",
              headerRight: () => (
                <Link href="/import">
                  <Text style={{ fontSize: 18 }}>📷</Text>
                </Link>
              ),
            }}
          />
          <Stack.Screen name="add" options={{ title: "Add game" }} />
          <Stack.Screen name="import" options={{ title: "Import" }} />
          <Stack.Screen name="game/[id]" options={{ title: "Game" }} />
          <Stack.Screen name="login" options={{ title: "Sign in", headerShown: false }} />
          <Stack.Screen name="register" options={{ title: "Create account", headerShown: false }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
