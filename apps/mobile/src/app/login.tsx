import { useState } from "react";
import { Alert, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { loginSchema, requestPasswordResetSchema } from "@gm/shared";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { AuthButton, AuthError, AuthInput, AuthScreen } from "@/components/auth-form";
import { colors, space, type } from "@/lib/theme";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Second factor. Only reached by accounts that turned two-factor on in the
  // web app — setup is web-only, but signing in has to work everywhere or
  // enabling it would lock the phone out.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);

  async function onSubmit() {
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const { data, error: authError } = await authClient.signIn.email(parsed.data);
    setBusy(false);
    if (authError) {
      setError(authError.message ?? "Sign in failed");
      return;
    }
    // Password accepted, but no session yet — the verify call below issues it.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setNeedsCode(true);
      return;
    }
    router.replace("/");
  }

  async function onVerify() {
    const entered = code.trim();
    if (!entered) {
      setError("Enter the code from your authenticator app");
      return;
    }
    setError(null);
    setBusy(true);
    // trustDevice: a phone is a personal device, and being asked every time
    // you open the app would be the kind of friction that gets 2FA turned off
    const { error: verifyError } = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code: entered, trustDevice: true })
      : await authClient.twoFactor.verifyTotp({ code: entered, trustDevice: true });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message ?? "That code didn't work");
      setCode("");
      return;
    }
    router.replace("/");
  }

  if (needsCode) {
    return (
      <AuthScreen subtitle="One more step">
        <AuthError message={error} />
        <Text style={[type.caption, styles.blurb]}>
          {useBackupCode
            ? "Enter one of the backup codes you saved. Each one works once."
            : "This device hasn't signed in before, so we need the six-digit code from your authenticator app."}
        </Text>
        <AuthInput
          label={useBackupCode ? "Backup code" : "Authentication code"}
          value={code}
          onChangeText={setCode}
          keyboardType={useBackupCode ? "default" : "number-pad"}
          autoComplete={useBackupCode ? "off" : "one-time-code"}
          placeholder={useBackupCode ? "xxxxx-xxxxx" : "123456"}
          autoFocus
          maxLength={useBackupCode ? 24 : 8}
        />
        <AuthButton label="Verify" onPress={onVerify} busy={busy} />
        <TouchableOpacity
          onPress={() => {
            setUseBackupCode(!useBackupCode);
            setCode("");
            setError(null);
          }}
          style={styles.linkRow}
        >
          <Text style={[type.label, styles.link]}>
            {useBackupCode ? "Use my authenticator app instead" : "Lost your phone? Use a backup code"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setNeedsCode(false);
            setCode("");
            setPassword("");
            setError(null);
          }}
          style={styles.linkRow}
        >
          <Text style={[type.label, styles.linkMuted]}>Sign in as someone else</Text>
        </TouchableOpacity>
      </AuthScreen>
    );
  }

  // No separate screen: uses the email already typed above, and the emailed
  // link opens the web app's reset form.
  async function onForgotPassword() {
    const parsed = requestPasswordResetSchema.safeParse({ email });
    if (!parsed.success) {
      Alert.alert("Forgot password", "Enter your email above first, then tap this again.");
      return;
    }
    try {
      const res = await api.requestPasswordReset(parsed.data.email);
      Alert.alert("Check your email", res.message);
    } catch (err) {
      Alert.alert(
        "Forgot password",
        err instanceof Error ? err.message : "Couldn't request a reset — try again later.",
      );
    }
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
      <TouchableOpacity onPress={onForgotPassword} style={styles.linkRow}>
        <Text style={[type.label, styles.link]}>Forgot your password?</Text>
      </TouchableOpacity>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  linkRow: { minHeight: 40, justifyContent: "center", marginTop: space.sm },
  link: { color: colors.accentBorder, textAlign: "center" },
  linkMuted: { color: colors.textFaint, textAlign: "center" },
  blurb: { marginBottom: space.md },
});
