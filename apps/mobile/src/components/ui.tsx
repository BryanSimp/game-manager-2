import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, space, TOUCH, type } from "@/lib/theme";

/**
 * The shared look of the app. Every screen used to hand-roll its own
 * StyleSheet, which is how the type sizes, paddings, radii and tap targets
 * drifted apart — and how text ended up clipped, since none of those local
 * styles set a lineHeight.
 *
 * Icons come from `@expo/vector-icons` (bundled with Expo) instead of emoji:
 * a glyph from an icon font centres in its box, takes a colour, and can't be
 * cropped by a tight line box the way an emoji was.
 */

export type IconName = keyof typeof Ionicons.glyphMap;

export function Icon({
  name,
  size = 18,
  color = colors.textMuted,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

/** Full-screen background. `center` for loading and error states. */
export function Screen({
  children,
  center,
  style,
}: {
  children: ReactNode;
  center?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.screen, center && styles.centered, style]}>{children}</View>;
}

export function Loading() {
  return (
    <Screen center>
      <ActivityIndicator color={colors.accentBorder} />
    </Screen>
  );
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

export function SectionTitle({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sectionTitle, style]}>
      <Text style={[type.label, { color: colors.textMuted }]}>{children}</Text>
    </View>
  );
}

/** A horizontally scrolling row of chips. Chips never shrink or wrap. */
export function ChipBar({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.chipBar, style]}
      contentContainerStyle={styles.chipBarContent}
    >
      {children}
    </ScrollView>
  );
}

export function Chip({
  label,
  active,
  onPress,
  icon,
  /** overrides the indigo active tint — category chips use their own hue */
  activeColor,
  activeBg,
  indent,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  icon?: IconName;
  activeColor?: string;
  activeBg?: string;
  indent?: boolean;
}) {
  const fg = active ? (activeColor ?? colors.accentText) : colors.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        indent && styles.chipIndent,
        active && { backgroundColor: activeBg ?? colors.accentSoft, borderColor: activeColor ?? colors.accentBorder },
        pressed && styles.pressed,
      ]}
    >
      {icon && <Icon name={icon} size={14} color={fg} />}
      <Text style={[type.caption, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Category badge. `bg`/`fg` come from `statusStyle()` so opacity is honoured. */
export function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[type.micro, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

type ButtonTone = "primary" | "ghost" | "danger";

export function Button({
  label,
  onPress,
  tone = "primary",
  icon,
  disabled,
  busy,
  fill,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  /** stretch to the width of the row */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fg =
    tone === "primary" ? "#ffffff" : tone === "danger" ? colors.danger : colors.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "primary" && styles.buttonPrimary,
        tone === "ghost" && styles.buttonGhost,
        tone === "danger" && styles.buttonDanger,
        fill && { flex: 1 },
        (disabled || busy) && styles.buttonDisabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size={16} color={fg} />}
          <Text style={[type.label, { color: fg }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** Square, centred tap target for a lone icon — close, remove, back. */
export function IconButton({
  name,
  onPress,
  color = colors.textGhost,
  size = 18,
  accessibilityLabel,
}: {
  name: IconName;
  onPress: () => void;
  color?: string;
  size?: number;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

export function Field(props: TextInputProps & { style?: StyleProp<ViewStyle> }) {
  const { style, ...rest } = props;
  return (
    <TextInput
      {...rest}
      style={[styles.field, type.body, style]}
      placeholderTextColor={colors.textFaint}
    />
  );
}

export function EmptyState({
  icon,
  title,
  text,
}: {
  icon: IconName;
  title: string;
  text?: string;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={26} color={colors.textGhost} />
      </View>
      <Text style={[type.heading, styles.centerText]}>{title}</Text>
      {text && <Text style={[type.caption, styles.centerText, { marginTop: space.xs }]}>{text}</Text>}
    </View>
  );
}

/** Cover art with a graceful fallback — a placeholder icon, never a blank box. */
export function Cover({
  src,
  width,
  height,
  title,
}: {
  src: string | null;
  width: number;
  height: number;
  title?: string;
}) {
  return (
    <View style={[styles.cover, { width, height }]}>
      {src ? (
        <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : title ? (
        <Text style={[type.micro, styles.centerText, { fontSize: 9, lineHeight: 12 }]} numberOfLines={3}>
          {title}
        </Text>
      ) : (
        <Icon name="game-controller-outline" size={Math.min(20, width / 2)} color={colors.textGhost} />
      )}
    </View>
  );
}

export function ProgressBar({ percent, color = colors.success, width }: { percent: number; color?: string; width?: number }) {
  return (
    <View style={[styles.track, width != null && { width }]}>
      <View
        style={[styles.fill, { width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: color }]}
      />
    </View>
  );
}

/** The disclosure arrow on a tappable row. */
export function Chevron() {
  return <Icon name="chevron-forward" size={18} color={colors.textGhost} />;
}

/**
 * A bottom sheet. Filters and sort live in here rather than in rows of chips:
 * seven categories plus a console per platform made a scrolling bar that was
 * too cramped to read, and a chip row can only ever show what fits.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: space.sm + insets.bottom }]}>
        <View style={styles.grabber} />
        <View style={styles.sheetHeader}>
          <Text style={type.heading}>{title}</Text>
          <IconButton name="close" accessibilityLabel="Close" onPress={onClose} />
        </View>
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A heading inside a `Sheet`, so one sheet can hold more than one choice. */
export function SheetSection({ label }: { label: string }) {
  return (
    <Text style={[type.micro, { color: colors.textGhost, marginTop: space.md, marginBottom: 2 }]}>
      {label.toUpperCase()}
    </Text>
  );
}

/** One choice in a `Sheet`. `count` is dimmed and right-aligned next to the tick. */
export function OptionRow({
  label,
  selected,
  onPress,
  count,
  icon,
  indent,
  tint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  count?: number;
  icon?: IconName;
  indent?: boolean;
  /** category rows carry their own hue, so the sheet reads like the badges do */
  tint?: string;
}) {
  const fg = selected ? (tint ?? colors.accentText) : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        indent && { paddingLeft: space.xxl },
        selected && styles.optionRowSelected,
        pressed && styles.pressed,
      ]}
    >
      {icon && <Icon name={icon} size={16} color={selected ? fg : colors.textFaint} />}
      <Text style={[type.body, { flex: 1, color: fg }]} numberOfLines={1}>
        {label}
      </Text>
      {count != null && <Text style={type.caption}>{count}</Text>}
      <View style={styles.tick}>
        {selected && <Icon name="checkmark" size={17} color={tint ?? colors.accentBorder} />}
      </View>
    </Pressable>
  );
}

/**
 * The control that opens a `Sheet`. Shows the current value, and an accent
 * ring once it's narrowing anything, so an active filter is visible without
 * opening the sheet.
 */
export function SheetButton({
  label,
  icon,
  active,
  badge,
  onPress,
  style,
}: {
  label: string;
  icon?: IconName;
  active?: boolean;
  /** how many filters this button is applying */
  badge?: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = active ? colors.accentText : colors.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetButton,
        active && styles.sheetButtonActive,
        pressed && styles.pressed,
        style,
      ]}
    >
      {icon && <Icon name={icon} size={15} color={fg} />}
      <Text style={[type.caption, { flex: 1, color: fg }]} numberOfLines={1}>
        {label}
      </Text>
      {badge != null && badge > 0 && (
        <View style={styles.badgeCount}>
          <Text style={[type.micro, { color: "#ffffff" }]}>{badge}</Text>
        </View>
      )}
      <Icon name="chevron-down" size={14} color={fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: "center", justifyContent: "center", padding: space.xxl },
  pressed: { opacity: 0.7 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  sectionTitle: { marginTop: space.xl, marginBottom: space.sm },
  chipBar: { flexGrow: 0 },
  chipBarContent: {
    paddingHorizontal: space.md,
    gap: space.sm,
    alignItems: "center",
    // the bar is a fixed-height row; without this the chips stretch
    paddingVertical: 2,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.md,
    // vertical centring is left to minHeight + alignItems, so a longer
    // lineHeight can never push the label out of the pill
    paddingVertical: 0,
  },
  chipIndent: { marginLeft: space.md },
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    maxWidth: 160,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: TOUCH,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonGhost: { borderWidth: 1, borderColor: colors.borderStrong },
  buttonDanger: { borderWidth: 1, borderColor: colors.dangerBorder },
  buttonDisabled: { opacity: 0.45 },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  field: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    // paddingVertical + an explicit lineHeight is what keeps descenders
    // inside the box on Android
    paddingVertical: 10,
    color: colors.text,
  },
  empty: { alignItems: "center", paddingHorizontal: space.xxl, paddingTop: 56 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.md,
  },
  centerText: { textAlign: "center" },
  cover: {
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  fill: { height: 6, borderRadius: 3 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: space.sm,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: TOUCH,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  optionRowSelected: { backgroundColor: colors.surfaceAlt },
  // fixed width so the labels line up whether or not a row is ticked
  tick: { width: 20, alignItems: "center" },
  sheetButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
  },
  sheetButtonActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
  badgeCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
