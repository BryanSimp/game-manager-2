import { useState } from "react";
import { Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { registerSchema } from "@gm/shared";
import { authClient } from "@/lib/auth";
import { AuthButton, AuthError, AuthInput, AuthScreen } from "@/components/auth-form";
import { colors, space, type } from "@/lib/theme";

export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);
    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const { error: authError } = await authClient.signUp.email(parsed.data);
    setBusy(false);
    if (authError) {
      setError(authError.message ?? "Registration failed");
      return;
    }
    router.replace("/");
  }

  return (
    <AuthScreen subtitle="Create your account">
      <AuthError message={error} />
      <AuthInput label="Display name" value={name} onChangeText={setName} autoComplete="name" />
      <AuthInput
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
      />
      <AuthInput
        label="Password (8+ characters)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
      />
      <AuthButton label="Create account" onPress={onSubmit} busy={busy} />
      <TouchableOpacity onPress={() => router.push("/login")} style={styles.linkRow}>
        <Text style={[type.label, styles.link]}>Already have an account? Sign in</Text>
      </TouchableOpacity>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  linkRow: { minHeight: 40, justifyContent: "center", marginTop: space.sm },
  link: { color: colors.accentBorder, textAlign: "center" },
});
