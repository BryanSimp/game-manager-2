import { StyleSheet, type TextStyle } from "react-native";

/**
 * Design tokens for the mobile app, matching the web app's dark zinc/indigo
 * theme.
 *
 * The important rule here is that **every text style carries a lineHeight**.
 * Without one, React Native sizes a line from the font's own metrics, which
 * clips descenders (g, y, p) inside tight rows and clips emoji outright —
 * emoji are drawn taller than Latin glyphs, so a 13pt line box cuts the top
 * and bottom off a 13pt emoji. That was the "text and emoji cut off" bug, and
 * it was in almost every screen because each one hand-rolled its own
 * StyleSheet with a bare `fontSize`.
 *
 * Icons are drawn with `@expo/vector-icons` rather than emoji (see
 * `components/ui.tsx`): a font glyph centres predictably in a box and takes a
 * colour, which emoji never did.
 */

export const colors = {
  /** page background */
  bg: "#09090b",
  /** cards and sheets */
  surface: "#18181b",
  /** inputs and wells inside a card */
  surfaceAlt: "#27272a",
  border: "#27272a",
  borderStrong: "#3f3f46",

  text: "#fafafa",
  textMuted: "#a1a1aa",
  textFaint: "#71717a",
  textGhost: "#52525b",

  accent: "#6366f1",
  accentSoft: "#312e81",
  accentText: "#c7d2fe",
  accentBorder: "#818cf8",

  success: "#34d399",
  warning: "#fbbf24",
  danger: "#f87171",
  dangerBorder: "#7f1d1d",
  star: "#fbbf24",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

/** Smallest comfortable tap target. Anything pressable should reach this. */
export const TOUCH = 44;

/**
 * Type scale. Line heights are ~1.4× the size, rounded — enough headroom for
 * descenders and for an emoji if one still sneaks into a string.
 */
export const type = StyleSheet.create({
  display: { fontSize: 26, lineHeight: 34, fontWeight: "800", color: colors.text },
  title: { fontSize: 20, lineHeight: 27, fontWeight: "700", color: colors.text },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "500", color: colors.text },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: colors.text },
  /** long-form prose: summaries, intro paragraphs */
  prose: { fontSize: 14, lineHeight: 21, fontWeight: "400", color: colors.textMuted },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: colors.text },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: "500", color: colors.textMuted },
  micro: { fontSize: 11, lineHeight: 16, fontWeight: "600", color: colors.textFaint },
});

/** Tint any type-scale entry without losing its line height. */
export function tint(base: TextStyle, color: string): TextStyle {
  return { ...base, color };
}
