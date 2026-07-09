import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export function AuthScreen({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>🎮 Game Manager</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {children}
      </View>
    </KeyboardAvoidingView>
  );
}

export function AuthInput(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address";
  autoComplete?: "email" | "password" | "new-password" | "name";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secureTextEntry}
        keyboardType={props.keyboardType ?? "default"}
        autoComplete={props.autoComplete}
        autoCapitalize="none"
        placeholderTextColor="#71717a"
      />
    </View>
  );
}

export function AuthButton({
  label,
  onPress,
  busy,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
}) {
  return (
    <TouchableOpacity style={[styles.button, busy && styles.buttonBusy]} onPress={onPress} disabled={busy}>
      <Text style={styles.buttonText}>{busy ? "…" : label}</Text>
    </TouchableOpacity>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    padding: 16,
    backgroundColor: "#101014",
  },
  card: {
    backgroundColor: "#18181b",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    color: "#fafafa",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    color: "#a1a1aa",
    marginTop: 4,
    marginBottom: 20,
  },
  field: { marginBottom: 14 },
  label: { color: "#d4d4d8", fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: {
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fafafa",
    fontSize: 16,
  },
  button: {
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 8,
  },
  buttonBusy: { opacity: 0.5 },
  buttonText: {
    color: "#ffffff",
    textAlign: "center",
    fontWeight: "600",
    fontSize: 16,
  },
  error: {
    color: "#fca5a5",
    backgroundColor: "#450a0a",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    fontSize: 13,
  },
});
