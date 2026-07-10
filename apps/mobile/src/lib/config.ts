/**
 * Where the API lives. In Expo Go on a phone, localhost is the phone —
 * set EXPO_PUBLIC_API_URL to your dev machine's LAN IP, e.g.
 * EXPO_PUBLIC_API_URL=http://192.168.1.50:3001 (apps/mobile/.env)
 */
// NOTE: the API listens on port 3001 — 8081 is Expo's own dev server.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://192.168.68.67:3001";
