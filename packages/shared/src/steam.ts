/**
 * A Steam app id typed or pasted into a game search.
 *
 * `explicit` is true when the input can only be an app id — a store link, a
 * `steam://` URL, "app 1091500" — so the raw text is worth nothing as a
 * title. A bare number is *not* explicit: "1942" and "2048" are games too, so
 * a number gets searched as a title as well as looked up as an app.
 */
export interface SteamAppQuery {
  appId: number;
  explicit: boolean;
}

/**
 * Nine digits at most: real app ids are seven, and anything longer than nine
 * could overflow the int column `games.steam_app_id` is compared against.
 */
const ID = String.raw`(\d{1,9})(?!\d)`;

const EXPLICIT_PATTERNS = [
  // store / community / SteamDB pages, with or without scheme, slug or query
  new RegExp(
    String.raw`(?:store\.steampowered\.com|steamcommunity\.com|steamdb\.info)(?:/agecheck)?/app/${ID}`,
    "i",
  ),
  // Steam's short links
  new RegExp(String.raw`\bs\.team/a/${ID}`, "i"),
  // steam://store/123, steam://run/123, steam://rungameid/123 …
  new RegExp(String.raw`^steam://(?:store|run|rungameid|install|launch|nav/games/details)/${ID}`, "i"),
  // "app 123", "appid: 123", "app id #123", "app/123"
  new RegExp(String.raw`^app\s*(?:id)?\s*[:#/]?\s*${ID}$`, "i"),
];

const BARE = /^\d{1,9}$/;

export function parseSteamAppQuery(input: string): SteamAppQuery | null {
  const text = input.trim();
  if (!text) return null;
  for (const pattern of EXPLICIT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return toQuery(match[1]!, true);
  }
  return BARE.test(text) ? toQuery(text, false) : null;
}

function toQuery(digits: string, explicit: boolean): SteamAppQuery | null {
  const appId = Number(digits);
  // app ids start at 10 (Counter-Strike); 0 and single digits aren't apps
  return Number.isSafeInteger(appId) && appId >= 10 ? { appId, explicit } : null;
}
