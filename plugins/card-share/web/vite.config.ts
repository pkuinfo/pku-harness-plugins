import { fileURLToPath } from "node:url";

import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Built to dist/view.html (+ hashed assets), served by the cloud server at /w/card-share/view
// under a strict CSP (no inline scripts, connect-src 'self'). Relative base: the page works under
// any path prefix. The crypto and frame code is imported from source, the same files the app uses.
export default defineConfig({
  base: "./",
  plugins: [preact(), tailwindcss()],
  resolve: {
    alias: { "@pku-harness/cloud-protocol": here("../../../packages/cloud-protocol/src/index.ts") },
    // ../src and packages/cloud-protocol import zod and @noble/*: always use this package's copies.
    dedupe: ["zod", "@noble/ciphers", "@noble/curves", "@noble/hashes"],
  },
  server: {
    fs: { allow: [here("../../..")] },
    proxy: { "/v1": { target: "http://localhost:8787", ws: true } },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2019",
    modulePreload: { polyfill: false },
    rollupOptions: { input: { view: here("view.html") } },
  },
});
