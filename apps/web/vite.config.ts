import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The dev proxy can point at another sync instance, e.g. a test server on :1236.
 *
 * The config runs in Node but the web project deliberately has no Node types, so the
 * one environment variable it needs is read through a narrow cast instead of adding a
 * dependency for it.
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;
const syncTarget = env?.REMO_SYNC_TARGET ?? "http://localhost:1234";
const syncWsTarget = syncTarget.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /**
     * The read API lives on the sync service (another origin), so it is proxied
     * through the dev server: the browser talks to its own origin and CORS never
     * enters the picture.
     */
    proxy: {
      // Both the read API and the live websocket go through the dev server, so a
      // teammate on another machine only needs this one port to reach everything.
      "/api": {
        target: syncTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/sync": {
        target: syncWsTarget,
        ws: true,
        rewrite: (path) => path.replace(/^\/sync/, ""),
      },
    },
  },
});
