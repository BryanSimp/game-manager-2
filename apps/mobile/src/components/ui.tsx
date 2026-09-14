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
import type { CollectionTime, VoteCounts } from "@gm/shared";
import { colors, radius, space, TOUCH, type } from "@/lib/theme";
import { formatHours } from "@/lib/ui";

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

/**
 * How long a collection takes, and how much of it is left — the phone's
 * version of the web app's `CollectionTimePanel`.
 *
 * Two figures rather than one: the total is a fact about the list and doesn't
 * move as you play, while what's left is about you — finished games drop out
 * of it, and part-ticked mission lists are pro-rated. Lengths nobody knows are
 * named rather than folded in at zero.
 */
export function CollectionTimeLine({
  time,
  compact = false,
}: {
  time: CollectionTime;
  compact?: boolean;
}) {
  if (time.counted === 0) return null;
  const total = formatHours(time.totalSeconds);
  const left = formatHours(time.remainingSeconds);
  const done = time.remainingSeconds <= 0;
  const played =
    time.totalSeconds > 0
      ? ((time.totalSeconds - time.remainingSeconds) / time.totalSeconds) * 100
      : 0;

  if (compact) {
    return (
      <View style={styles.timeRow}>
        <Icon name="time-outline" size={11} color={colors.textFaint} />
        <Text style={type.micro}>{total}</Text>
        {done ? (
          <Text style={[type.micro, { color: colors.success }]}>· beaten</Text>
        ) : (
          left !== total && (
            <Text style={[type.micro, { color: colors.accentText }]}>· {left} left</Text>
          )
        )}
      </View>
    );
  }

  return (
    <View style={styles.timeCard}>
      <View style={styles.timeRow}>
        <Icon name="time-outline" size={13} color={colors.textFaint} />
        <Text style={type.caption}>
          <Text style={type.bodyStrong}>{total}</Text> to beat in full
        </Text>
        {done ? (
          <Text style={[type.caption, { color: colors.success }]}>· all beaten</Text>
        ) : (
          <Text style={[type.caption, { color: colors.accentText }]}>· {left} left</Text>
        )}
      </View>
      <ProgressBar percent={played} />
      {(time.unknown > 0 || time.endless > 0) && (
        <Text style={type.micro}>
          {[
            time.unknown > 0 && `${time.unknown} with no known length`,
            time.endless > 0 && `${time.endless} endless excluded`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      )}
    </View>
  );
}

/** The disclosure arrow on a tappable row. */
export function Chevron() {
  return <Icon name="chevron-forward" size={18} color={colors.textGhost} />;
}

/**
 * Thumbs up/down with the running score between them — the web app's
 * `VoteButtons`, in Ionicons.
 *
 * Tapping the vote you already cast takes it back, the same way the star
 * rating clears itself, so there's no third control to find. Render it only
 * on other people's lists: the API refuses a vote on your own, and a score
 * you can pad isn't a score.
 */
export function VoteRow({
  votes,
  disabled,
  onVote,
}: {
  votes: VoteCounts;
  disabled?: boolean;
  onVote: (value: 1 | 0 | -1) => void;
}) {
  const cast = (value: 1 | -1) => onVote(votes.mine === value ? 0 : value);
  const scoreColor =
    votes.score > 0 ? colors.success : votes.score < 0 ? colors.danger : colors.textGhost;

  return (
    <View style={styles.voteRow}>
      <Pressable
        onPress={() => cast(1)}
        disabled={disabled}
        hitSlop={8}
        accessibilityLabel={votes.mine === 1 ? "Remove your upvote" : "Upvote"}
      >
        <Icon
          name={votes.mine === 1 ? "thumbs-up" : "thumbs-up-outline"}
          size={16}
          color={votes.mine === 1 ? colors.success : colors.textGhost}
        />
      </Pressable>
      <Text style={[type.micro, { color: scoreColor, minWidth: 14, textAlign: "center" }]}>
        {votes.score}
      </Text>
      <Pressable
        onPress={() => cast(-1)}
        disabled={disabled}
        hitSlop={8}
        accessibilityLabel={votes.mine === -1 ? "Remove your downvote" : "Downvote"}
      >
        <Icon
          name={votes.mine === -1 ? "thumbs-down" : "thumbs-down-outline"}
          size={16}
          color={votes.mine === -1 ? colors.danger : colors.textGhost}
        />
      </Pressable>
    </View>
  );
}

/**
 * Half-star rating, 0.5–5.0 — the same interaction as the web app's
 * `StarRating`: tap the left half of a star for the half value, the right half
 * for the whole, and tap the current value again to clear it. Ten chips
 * labelled "0.5★ 1★ 1.5★…" said the same thing in far more space and didn't
 * look like a rating.
 */
export function StarRating({
  value,
  onChange,
  size = 30,
}: {
  value: number | null;
  onChange?: (value: number | null) => void;
  size?: number;
}) {
  const pick = (v: number) => onChange?.(v === value ? null : v);

  return (
    <View style={styles.stars} accessibilityRole={onChange ? "radiogroup" : undefined}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = value != null && value >= star;
        const half = value != null && !filled && value >= star - 0.5;
        return (
          <View key={star} style={{ width: size, height: size }}>
            <Icon
              name={filled ? "star" : half ? "star-half" : "star-outline"}
              size={size}
              color={filled || half ? colors.star : colors.borderStrong}
            />
            {onChange && (
              // two invisible halves over each star; the glyph underneath is
              // what's actually drawn
              <View style={StyleSheet.absoluteFill}>
                <View style={styles.starHalves}>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: value === star - 0.5 }}
                    accessibilityLabel={`${star - 0.5} stars`}
                    style={styles.starHalf}
                    onPress={() => pick(star - 0.5)}
                  />
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: value === star }}
                    accessibilityLabel={`${star} stars`}
                    style={styles.starHalf}
                    onPress={() => pick(star)}
                  />
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
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
  timeCard: {
    gap: space.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  timeRow: { flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" },
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
  voteRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  stars: { flexDirection: "row", gap: 6 },
  starHalves: { flex: 1, flexDirection: "row" },
  starHalf: { flex: 1 },
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
