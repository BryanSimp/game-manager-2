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
import { LibraryPage } from "./pages/Library.js";
import { ConsolesPage } from "./pages/Consoles.js";
import { ConsoleDetailPage } from "./pages/ConsoleDetail.js";
import { CollectionsPage } from "./pages/Collections.js";
import { CollectionDetailPage } from "./pages/CollectionDetail.js";
import { AddGamePage } from "./pages/AddGame.js";
import { GameDetailPage } from "./pages/GameDetail.js";
import { ImportPage } from "./pages/Import.js";
import { SettingsPage } from "./pages/Settings.js";
import { FriendsPage } from "./pages/Friends.js";
import { FriendLibraryPage } from "./pages/FriendLibrary.js";
import { TagsPage } from "./pages/Tags.js";
import { PreferencesPage } from "./pages/Preferences.js";
import { DashboardPage } from "./pages/Dashboard.js";
import { LoginPage } from "./pages/Login.js";
import { RegisterPage } from "./pages/Register.js";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicy.js";
import { TermsOfServicePage } from "./pages/TermsOfService.js";
import "./styles.css";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: LibraryPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/consoles", component: ConsolesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/console/$platformId", component: ConsoleDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/collections", component: CollectionsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/collection/$id", component: CollectionDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/add", component: AddGamePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/game/$id", component: GameDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/import", component: ImportPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/tags", component: TagsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/friends", component: FriendsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/friends/$userId", component: FriendLibraryPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/preferences", component: PreferencesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/dashboard", component: DashboardPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/register", component: RegisterPage }),
  // public — readable before signing up, so no Shell/auth around them
  createRoute({ getParentRoute: () => rootRoute, path: "/privacy", component: PrivacyPolicyPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/terms", component: TermsOfServicePage }),
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
