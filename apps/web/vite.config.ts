import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { GUIDES } from "./src/lib/guides";

const SITE_URL = "https://gamesmanager.app";

/** Public, indexable routes and how often they're worth re-crawling. */
const STATIC_PAGES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/guides", changefreq: "weekly", priority: "0.9" },
  { path: "/contact", changefreq: "yearly", priority: "0.5" },
  { path: "/privacy", changefreq: "yearly", priority: "0.3" },
  { path: "/terms", changefreq: "yearly", priority: "0.3" },
];

/**
 * Emits sitemap.xml at build time from the same guide list the pages render,
 * so publishing a guide can't leave the sitemap behind.
 *
 * `/welcome` is deliberately absent: it renders the same landing page as `/`
 * and canonicalises to it (LandingPage hard-codes `path: "/"`), so listing
 * both would be submitting a known duplicate.
 */
function sitemapPlugin(): Plugin {
  return {
    name: "gm-sitemap",
    apply: "build",
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);

      const urls = [
        ...STATIC_PAGES.map(
          (page) =>
            `  <url>\n    <loc>${SITE_URL}${page.path}</loc>\n    <lastmod>${today}</lastmod>\n` +
            `    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority}</priority>\n  </url>`,
        ),
        ...GUIDES.map(
          (guide) =>
            `  <url>\n    <loc>${SITE_URL}/guides/${guide.slug}</loc>\n    <lastmod>${guide.updated}</lastmod>\n` +
            `    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`,
        ),
      ];

      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), sitemapPlugin()],
  server: {
    port: 5173,
    // Same-origin /api in dev, exactly like Traefik path routing in prod.
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
