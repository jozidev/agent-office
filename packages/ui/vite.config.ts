import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ws/terminal": { target: "ws://127.0.0.1:4177", ws: true },
      "/ws/chat": { target: "ws://127.0.0.1:4177", ws: true },
      "/ws": { target: "ws://127.0.0.1:4177", ws: true },
      "/api": "http://127.0.0.1:4177",
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
