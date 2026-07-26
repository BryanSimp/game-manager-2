import type { ProgressBasis } from "./constants.js";

/**
 * Time-to-beat maths, shared so web, mobile and the API all agree on the
 * numbers. Two separate concerns live here:
 *
 *  - `normalizeTtb` enforces the ordering invariant main ≤ main+extras ≤
 *    completionist. IGDB's three figures were mapped to the wrong columns
 *    until migration 0006, which left rows with a main story *longer* than
 *    main+extras (Metal Gear Solid V read 101h main / 49h main+extras).
 *  - `estimateProgress` pro-rates a game's length across an ordered mission
 *    list: tick off 12 of MGSV's 38 missions and 49h becomes ~33h left.
 */

export interface TtbTriple {
  ttbMain: number | null;
  ttbMainExtra: number | null;
  ttbCompletionist: number | null;
}

export const PROGRESS_BASIS_LABELS: Record<ProgressBasis, string> = {
  main: "Main story",
  main_extra: "Main + extras",
  completionist: "Completionist",
};

/**
 * Sort the three figures so the longer playthrough is never the shorter
 * number. Nulls are dropped and re-filled from the left, so a game with only
 * two known figures still lands them in the right columns.
 */
export function normalizeTtb(ttb: TtbTriple): TtbTriple {
  const known = [ttb.ttbMain, ttb.ttbMainExtra, ttb.ttbCompletionist]
    .filter((v): v is number => typeof v === "number" && v > 0)
    .sort((a, b) => a - b);

  // Keep each value in the column it belongs to: shortest is the main story,
  // longest is completionist. With only two figures we can't tell whether the
  // pair is (main, main+extras) or (main, completionist), so we assume the
  // former — that's how IGDB reports partial data.
  if (known.length === 0) return { ttbMain: null, ttbMainExtra: null, ttbCompletionist: null };
  if (known.length === 1) return { ttbMain: known[0]!, ttbMainExtra: null, ttbCompletionist: null };
  if (known.length === 2) {
    return { ttbMain: known[0]!, ttbMainExtra: known[1]!, ttbCompletionist: null };
  }
  return { ttbMain: known[0]!, ttbMainExtra: known[1]!, ttbCompletionist: known[2]! };
}

export function ttbForBasis(ttb: TtbTriple, basis: ProgressBasis): number | null {
  if (basis === "completionist") return ttb.ttbCompletionist ?? ttb.ttbMainExtra ?? ttb.ttbMain;
  if (basis === "main_extra") return ttb.ttbMainExtra ?? ttb.ttbMain;
  return ttb.ttbMain;
}

export interface ProgressEstimate {
  /** missions in the list */
  total: number;
  /** missions ticked off */
  done: number;
  percent: number;
  /** full length for the chosen basis, in seconds */
  totalSeconds: number | null;
  /** average seconds per mission */
  perItemSeconds: number | null;
  /** seconds still to play, pro-rated across the unfinished missions */
  remainingSeconds: number | null;
}

/**
 * Split `totalSeconds` evenly across `total` missions and charge the
 * unfinished ones. Even division is a deliberate simplification — real
 * missions vary wildly in length, and we have no per-mission timings.
 */
export function estimateProgress({
  total,
  done,
  totalSeconds,
}: {
  total: number;
  done: number;
  totalSeconds: number | null;
}): ProgressEstimate {
  const safeDone = Math.min(Math.max(done, 0), Math.max(total, 0));
  const percent = total > 0 ? Math.round((safeDone / total) * 100) : 0;

  if (!totalSeconds || total <= 0) {
    return {
      total,
      done: safeDone,
      percent,
      totalSeconds: totalSeconds ?? null,
      perItemSeconds: null,
      remainingSeconds: null,
    };
  }

  const perItemSeconds = totalSeconds / total;
  return {
    total,
    done: safeDone,
    percent,
    totalSeconds,
    perItemSeconds: Math.round(perItemSeconds),
    remainingSeconds: Math.round(perItemSeconds * (total - safeDone)),
  };
}
