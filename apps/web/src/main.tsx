import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { HomePage } from "./pages/Home.js";
import { LandingPage } from "./pages/Landing.js";
import { GuidesPage } from "./pages/Guides.js";
import { GuideArticlePage } from "./pages/GuideArticle.js";
import { ContactPage } from "./pages/Contact.js";
import { ConsolesPage } from "./pages/Consoles.js";
import { ConsoleDetailPage } from "./pages/ConsoleDetail.js";
import { CollectionsPage } from "./pages/Collections.js";
import { CollectionDetailPage } from "./pages/CollectionDetail.js";
import { AddGamePage } from "./pages/AddGame.js";
import { GameDetailPage } from "./pages/GameDetail.js";
import { CatalogGamePage } from "./pages/CatalogGame.js";
import { FeedbackPage } from "./pages/Feedback.js";
import { DemoPage } from "./pages/Demo.js";
import { ImportPage } from "./pages/Import.js";
import { SettingsPage } from "./pages/Settings.js";
import { AdminAnalyticsPage } from "./pages/AdminAnalytics.js";
import { AdminDemoPage } from "./pages/AdminDemo.js";
import { FriendsPage } from "./pages/Friends.js";
import { FriendLibraryPage } from "./pages/FriendLibrary.js";
import { TagsPage } from "./pages/Tags.js";
import { PreferencesPage } from "./pages/Preferences.js";
import { DashboardPage } from "./pages/Dashboard.js";
import { LoginPage } from "./pages/Login.js";
import { RegisterPage } from "./pages/Register.js";
import { ForgotPasswordPage } from "./pages/ForgotPassword.js";
import { ResetPasswordPage } from "./pages/ResetPassword.js";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicy.js";
import { TermsOfServicePage } from "./pages/TermsOfService.js";
import "./styles.css";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const routes = [
  // `/` is the public landing page when signed out and the library when
  // signed in — see pages/Home.tsx. The root of the domain has to be
  // crawlable for the site to be indexed at all.
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/consoles", component: ConsolesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/console/$platformId", component: ConsoleDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/collections", component: CollectionsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/collection/$id", component: CollectionDetailPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/add",
    component: AddGamePage,
    // ?q= seeds the search box, so a collection can link straight to "add this
    // one" for a game you don't own yet
    validateSearch: (search: Record<string, unknown>): { q?: string } => ({
      q: typeof search.q === "string" && search.q ? search.q : undefined,
    }),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/game/$id",
    component: GameDetailPage,
    // ?tab= is the tab you're on, so Back and a refresh land on it again —
    // the Linked tab especially, which you leave by opening another game
    validateSearch: (search: Record<string, unknown>): { tab?: "progress" | "linked" } => ({
      tab: search.tab === "progress" || search.tab === "linked" ? search.tab : undefined,
    }),
  }),
  // a game from the shared catalog, keyed by catalog id rather than by your
  // entry id — where a collection sends you for a game you don't own yet
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/catalog/$gameId",
    component: CatalogGamePage,
    validateSearch: (search: Record<string, unknown>): { tab?: "linked" } => ({
      tab: search.tab === "linked" ? "linked" : undefined,
    }),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/import", component: ImportPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/admin/analytics", component: AdminAnalyticsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/admin/demo", component: AdminDemoPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/tags", component: TagsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/friends", component: FriendsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/friends/$userId", component: FriendLibraryPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/preferences", component: PreferencesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/feedback", component: FeedbackPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/dashboard", component: DashboardPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/register", component: RegisterPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/forgot-password", component: ForgotPasswordPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/reset-password",
    component: ResetPasswordPage,
    validateSearch: (search: Record<string, unknown>) => ({
      token: typeof search.token === "string" ? search.token : "",
    }),
  }),
  // public — readable before signing up, so no Shell/auth around them
  createRoute({ getParentRoute: () => rootRoute, path: "/privacy", component: PrivacyPolicyPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/terms", component: TermsOfServicePage }),
  // The landing page's own URL, so it stays reachable while signed in and can
  // be linked to directly.
  createRoute({ getParentRoute: () => rootRoute, path: "/welcome", component: LandingPage }),
  // flips on read-only demo mode and hands over to the library — see pages/Demo.tsx
  createRoute({ getParentRoute: () => rootRoute, path: "/demo", component: DemoPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/guides", component: GuidesPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/guides/$slug",
    component: GuideArticlePage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/contact", component: ContactPage }),
];

const router = createRouter({ routeTree: rootRoute.addChildren(routes) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
