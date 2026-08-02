import { useState } from "react";
import { Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { loginSchema } from "@gm/shared";
import { authClient } from "@/lib/auth";
import { AuthButton, AuthError, AuthInput, AuthScreen } from "@/components/auth-form";
import { colors, space, type } from "@/lib/theme";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const { error: authError } = await authClient.signIn.email(parsed.data);
    setBusy(false);
    if (authError) {
      setError(authError.message ?? "Sign in failed");
      return;
    }
    router.replace("/");
  }

  return (
    <AuthScreen subtitle="Sign in to your library">
      <AuthError message={error} />
      <AuthInput
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
      />
      <AuthInput
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
      />
      <AuthButton label="Sign in" onPress={onSubmit} busy={busy} />
      <TouchableOpacity onPress={() => router.push("/register")} style={styles.linkRow}>
        <Text style={[type.label, styles.link]}>No account? Create one</Text>
      </TouchableOpacity>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  linkRow: { minHeight: 40, justifyContent: "center", marginTop: space.sm },
  link: { color: colors.accentBorder, textAlign: "center" },
});
