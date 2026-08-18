/**
 * Turns the built SPA into real HTML pages for every public URL.
 *
 * Runs after `vite build`, over `dist/`. For each public route it renders the
 * React tree to markup, writes that inside `<div id="root">`, and replaces the
 * template's `<head>` tags with the ones that route's `useSeo` asked for. The
 * result is a static page a crawler can read without executing anything, which
 * the SPA then replaces on mount.
 *
 * Two files matter in the output:
 *   dist/index.html            the prerendered landing page, served for `/`
 *   dist/app.html              the untouched shell, nginx's SPA fallback
 *
 * The split is why `nginx.conf` falls back to `/app.html` rather than
 * `/index.html`: signed-in routes like `/dashboard` are not prerendered, and
 * falling back to a landing page baked with content would flash that content
 * before the app mounted. `app.html` is the empty shell that used to be
 * `index.html`, so those routes behave exactly as they did before.
 *
 * Modules are loaded through a Vite SSR server rather than a second build
 * config so TSX, path resolution and CSS imports all behave like the real app.
 * `better-auth/react` is aliased to a signed-out stub — see
 * `src/prerender/stub-auth.ts`.
 */

import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const stub = join(root, "src/prerender/stub-auth.ts");

/** Escapes a string for use inside a double-quoted HTML attribute. */
function attr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `</script>` inside JSON-LD would close the block early. */
function jsonLdSafe(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Replaces a whole tag matched by one of its attributes.
 *
 * `[^>]*` spans newlines, which matters because the tags in index.html are
 * formatted across several lines.
 */
function replaceTag(html, tag, attrName, attrValue, replacement) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attrName}="${attrValue}"[^>]*>`, "i");
  return re.test(html) ? html.replace(re, replacement) : html.replace("</head>", `  ${replacement}\n  </head>`);
}

/** Writes a route's SEO into the template's head. */
function applySeo(html, seo) {
  let out = html;

  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${attr(seo.title)}</title>`);
  out = replaceTag(out, "meta", "name", "description", `<meta name="description" content="${attr(seo.description)}" />`);
  out = replaceTag(out, "meta", "name", "robots", `<meta name="robots" content="${attr(seo.robots)}" />`);
  out = replaceTag(out, "link", "rel", "canonical", `<link rel="canonical" href="${attr(seo.url)}" />`);
  out = replaceTag(out, "meta", "property", "og:title", `<meta property="og:title" content="${attr(seo.title)}" />`);
  out = replaceTag(out, "meta", "property", "og:description", `<meta property="og:description" content="${attr(seo.description)}" />`);
  out = replaceTag(out, "meta", "property", "og:url", `<meta property="og:url" content="${attr(seo.url)}" />`);

  if (seo.jsonLd) {
    const block = `<script type="application/ld+json" data-seo="route">${jsonLdSafe(seo.jsonLd)}</script>`;
    out = out.replace("</head>", `  ${block}\n  </head>`);
  }

  return out;
}

/** `/guides/x` → `dist/guides/x/index.html`; `/` → `dist/index.html`. */
function outputPath(routePath) {
  if (routePath === "/") return join(dist, "index.html");
  return join(dist, routePath.replace(/^\//, ""), "index.html");
}

async function main() {
  const template = await readFile(join(dist, "index.html"), "utf8");

  if (!template.includes('<div id="root"></div>')) {
    throw new Error("dist/index.html has no empty #root to fill — did the build change?");
  }

  // The SPA fallback keeps the original empty shell.
  await writeFile(join(dist, "app.html"), template, "utf8");

  const server = await createServer({
    root,
    logLevel: "warn",
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    resolve: {
      alias: [
        { find: /^better-auth\/react$/, replacement: stub },
        { find: /^better-auth\/client\/plugins$/, replacement: stub },
      ],
    },
  });

  let written = 0;
  try {
    const { routePaths, renderRoute } = await server.ssrLoadModule("/src/prerender/entry.tsx");

    for (const routePath of routePaths()) {
      const { html, seo } = await renderRoute(routePath);

      if (!html.trim()) throw new Error(`${routePath} rendered nothing`);
      if (!seo) throw new Error(`${routePath} never called useSeo — its head would be the landing page's`);

      const page = applySeo(template, seo).replace(
        '<div id="root"></div>',
        `<div id="root">${html}</div>`,
      );

      const file = outputPath(routePath);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, page, "utf8");

      written += 1;
      const kb = (Buffer.byteLength(page, "utf8") / 1024).toFixed(1);
      console.log(`  prerendered ${routePath.padEnd(42)} ${kb.padStart(7)} kB`);
    }
  } finally {
    await server.close();
  }

  console.log(`\nprerender: ${written} pages written to dist/`);
}

await main();
