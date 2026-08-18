/**
 * A permanently signed-out `better-auth/react` for the static render.
 *
 * `scripts/prerender.mjs` aliases `better-auth/react` and
 * `better-auth/client/plugins` to this module, so `lib/auth.ts` is left
 * untouched and every prerendered page renders the anonymous view — which is
 * both the only view a crawler can have and the only one worth putting in the
 * index.
 *
 * The library is stubbed rather than `lib/auth.ts` itself because a bare
 * specifier aliases exactly, while `lib/auth.js` is imported by three
 * different relative paths that a single alias can't match cleanly.
 *
 * Real `useSession` is backed by a nanostore reading browser storage. Under
 * `react-dom/server` that is at best a store that can never resolve and at
 * worst a `useSyncExternalStore` without a server snapshot; either way the
 * answer we want is a settled "signed out", so it's stated directly.
 */

const session = {
  data: null,
  isPending: false,
  isRefetching: false,
  error: null,
  refetch: () => {},
};

/**
 * Any method a marketing component reaches for resolves to a no-op rather
 * than `undefined`, so a component calling something new at render time fails
 * the build with a visible error instead of a confusing crash — and anything
 * merely *held* (an event handler that never fires during a static render) is
 * harmless.
 */
function clientProxy(): unknown {
  return new Proxy(
    { useSession: () => session },
    {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop === "symbol") return undefined;
        return () => Promise.resolve({ data: null, error: null });
      },
    },
  );
}

export function createAuthClient(): unknown {
  return clientProxy();
}

/** Plugin factories are only read for their shape; nothing calls into them. */
export function twoFactorClient(): Record<string, never> {
  return {};
}
