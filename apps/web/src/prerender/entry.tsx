/**
 * Build-time static render of the public pages.
 *
 * Loaded by `scripts/prerender.mjs` through Vite's SSR module runner, never by
 * the browser — nothing in `index.html` imports it, so it stays out of the
 * client bundle.
 *
 * Why this exists: the app is a client-rendered SPA, so every URL on the
 * domain served `<div id="root"></div>` and the landing page's `<head>`,
 * including a canonical pointing at `/`. Googlebot runs JavaScript and saw the
 * real pages; AdSense's review crawler does not, and rejected the site as low
 * value content on the strength of eleven URLs that each declared themselves a
 * copy of the homepage and contained nothing.
 *
 * This is prerendering, not SSR: the emitted markup is a static snapshot and
 * `main.tsx` still mounts with `createRoot`, which replaces the container's
 * children outright. There is no hydration, so there is no hydration mismatch
 * to keep in step — the snapshot only has to say the same *things* as the live
 * page, not render identical markup forever.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { LandingPage } from "../pages/Landing.js";
import { GuidesPage } from "../pages/Guides.js";
import { GuideArticlePage } from "../pages/GuideArticle.js";
import { ContactPage } from "../pages/Contact.js";
import { PrivacyPolicyPage } from "../pages/PrivacyPolicy.js";
import { TermsOfServicePage } from "../pages/TermsOfService.js";
import { GUIDES } from "../lib/guides.js";
import { resolveSeo, takeSeo, type ResolvedSeo } from "../lib/seo.js";

/**
 * A public-only route tree, deliberately not the one in `main.tsx`.
 *
 * Paths match the real router exactly — `useParams({ from: "/guides/$slug" })`
 * in GuideArticle resolves against this tree — but importing `main.tsx` would
 * pull in every signed-in page (and run its `createRoot` at module scope), so
 * the twenty-odd routes a crawler can never reach are left out.
 *
 * `/` renders the landing page directly rather than `Home`, which branches on
 * a session and returns "Loading…" until one resolves. Signed out is what a
 * crawler is, so the landing page is what `/` has to snapshot.
 */
const rootRoute = createRootRoute({ component: () => <Outlet /> });

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: LandingPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/welcome", component: LandingPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/guides", component: GuidesPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/guides/$slug",
    component: GuideArticlePage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/contact", component: ContactPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/privacy", component: PrivacyPolicyPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/terms", component: TermsOfServicePage }),
];

const routeTree = rootRoute.addChildren(routes);

/**
 * Every URL to snapshot.
 *
 * Guide URLs come from `GUIDES`, the same list the sitemap and the pages read,
 * so publishing a guide can't leave a prerendered page behind.
 */
export function routePaths(): string[] {
  return [
    "/",
    "/welcome",
    "/guides",
    ...GUIDES.map((guide) => `/guides/${guide.slug}`),
    "/contact",
    "/privacy",
    "/terms",
  ];
}

export interface RenderedRoute {
  html: string;
  /** Null when a page doesn't call `useSeo` — the caller then keeps the
   *  template's own tags rather than inventing any. */
  seo: ResolvedSeo | null;
}

/** Renders one route to markup plus whatever `useSeo` recorded for it. */
export async function renderRoute(path: string): Promise<RenderedRoute> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();

  // Queries never fire here — TanStack Query fetches from effects, which don't
  // run server-side — so components depending on one render their loading or
  // empty state. That is the correct snapshot: it's what a visitor sees on
  // first paint too.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  // Read after rendering: `useSeo` records during the render pass.
  const seo = takeSeo();
  return { html, seo: seo ? resolveSeo(seo) : null };
}
