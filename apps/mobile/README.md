# Game Manager — Mobile (Expo)

The mobile client. Runs in **Expo Go** during development.

## Running on your phone

1. Install **Expo Go** from the App Store / Play Store.
2. Make sure the API is running (`pnpm dev:api` from the repo root) and your
   phone is on the same Wi-Fi network as your dev machine.
3. Point the app at your dev machine's LAN IP — create `apps/mobile/.env`:

   ```
   EXPO_PUBLIC_API_URL=http://192.168.68.67:8081
   ```

   (Find your IP with `ipconfig` — use the IPv4 address of your Wi-Fi adapter.
   `localhost` will NOT work from the phone.)

4. Start the dev server and scan the QR code with Expo Go:

   ```bash
   pnpm dev:mobile
   ```

Auth sessions are stored in the device keychain via `expo-secure-store`.
