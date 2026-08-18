import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { API_URL } from "./config";

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    // Not optional on this surface: an account that turns two-factor on in
    // the web app must still be able to sign in on the phone, and without
    // this plugin the sign-in call would come back "successful" with no
    // session and no way to answer the challenge.
    twoFactorClient(),
    expoClient({
      scheme: "gamemanager",
      storagePrefix: "gm",
      storage: SecureStore,
    }),
  ],
});
