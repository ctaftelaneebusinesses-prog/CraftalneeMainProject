import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Dev: `npm run dev` on :5173 proxies API + files to Flask on :5000 (python run.py).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5000",
      "/files": "http://127.0.0.1:5000",
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Long-lived vendor chunks for the libraries every page needs. The chart library is deliberately
          // NOT grouped: a "charts" group pulled React into itself (groups include their dependencies), so
          // 395 KB of charts loaded on every page, even login. Left alone, it only loads on chart pages.
          // (Turning off dependency inclusion instead broke module start-up order — keep the default.)
          groups: [
            { name: "react", test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 20 },
            { name: "motion", test: /[\\/]node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});
