import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, radius, space, type } from "@/lib/theme";
import { Button, Icon } from "@/components/ui";

export function AuthScreen({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.logo}>
            <Icon name="game-controller" size={26} color={colors.accentText} />
          </View>
          <Text style={[type.title, styles.center]}>Game Manager</Text>
          <Text style={[type.caption, styles.center, styles.subtitle]}>{subtitle}</Text>
          {children}
        </View>
      </ScrollView>
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
      <Text style={[type.label, { color: colors.textMuted }]}>{props.label}</Text>
      <TextInput
        style={[styles.input, type.body]}
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secureTextEntry}
        keyboardType={props.keyboardType ?? "default"}
        autoComplete={props.autoComplete}
        autoCapitalize="none"
        placeholderTextColor={colors.textFaint}
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
  return <Button label={label} fill busy={busy} onPress={onPress} style={{ marginTop: space.sm }} />;
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.error}>
      <Icon name="alert-circle" size={16} color="#fca5a5" />
      <Text style={[type.caption, { flex: 1, color: "#fca5a5" }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: "center", padding: space.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xxl,
  },
  logo: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.md,
  },
  center: { textAlign: "center" },
  subtitle: { marginTop: space.xs, marginBottom: space.xl },
  field: { marginBottom: space.md, gap: 6 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    color: colors.text,
  },
  error: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
    backgroundColor: "#450a0a",
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.md,
  },
});
