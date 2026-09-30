import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Dev: `npm run dev` on :5173 proxies API + files to Flask on :5000 (python run.py).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
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
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\/](recharts|d3-|victory-vendor)/.test(id)) return "charts";
          if (/[\/](motion|framer-motion|motion-dom|motion-utils)[\/]/.test(id)) return "motion";
          if (/[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/.test(id)) return "react";
          return undefined;
        },
      },
    },
  },
});
