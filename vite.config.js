import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Proxy for the Wisdom dictionary API.
//
// The API sends Access-Control-Allow-Origin only for its own site, so the
// browser blocks a direct call. The page fetches same-origin "/wisdom-api/..."
// and the Vite server makes the real request server-side. Used by both
// `npm run dev` and `npm run preview`.
const wisdomProxy = {
  "/wisdom-api": {
    target: "https://new-api.wisdomedu.uz",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/wisdom-api/, "/api/v1"),
  },
};

export default defineConfig({
  server: { proxy: wisdomProxy },
  preview: { proxy: wisdomProxy },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "favicon-32.png"],
      manifest: {
        name: "Nyx Reader",
        short_name: "Nyx",
        description:
          "A calm reader for PDF, EPUB, Word and text — with dictionary lookup and vocabulary.",
        lang: "en",
        theme_color: "#15181c",
        background_color: "#15181c",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        // pdf.js worker and some chunks are large — allow up to 6 MB.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-styles" },
          },
          {
            // Google Fonts webfont files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Bundled library files (epub covers + books) — cache on first read.
            urlPattern: /\/(ebooks|book-pics)\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "nyx-library",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
