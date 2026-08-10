import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        manifest: {
          name: "PHIF Tracker",
          short_name: "PHIF",
          description: "نظام تتبع صرف التأمين الصحي",
          theme_color: "#0891b2",
          background_color: "#ffffff",
          display: "standalone",
          orientation: "portrait",
          dir: "rtl",
          lang: "ar",
          icons: [
            {
              src: "https://storage.googleapis.com/gpt-engineer-file-uploads/bNO3PnFjBwcf1MnnzrYHbpvTTUl1/social-images/social-1783993175218-260709.webp",
              sizes: "512x512",
              type: "image/webp",
              purpose: "any maskable"
            }
          ]
        },
        workbox: {
          navigateFallbackDenylist: [/^\/~oauth/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-stylesheets",
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-webfonts",
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
              },
            }
          ]
        }
      })
    ]
  }
});
