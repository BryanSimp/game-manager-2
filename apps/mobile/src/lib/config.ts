/**
 * Where the API lives. In Expo Go on a phone, localhost is the phone —
 * set EXPO_PUBLIC_API_URL to your dev machine's LAN IP, e.g.
 * EXPO_PUBLIC_API_URL=http://192.168.1.50:3001 (apps/mobile/.env)
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";
