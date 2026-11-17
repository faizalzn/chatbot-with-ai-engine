import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // PORT server dibaca dari .env di akar proyek, supaya dashboard saat pengembangan tahu ke mana meneruskan panggilan API.
  const rootEnv = loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), "");
  const server = `http://localhost:${rootEnv.PORT || 3000}`;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: { "/api": server, "/widget.js": server, "/demo": server },
    },
    build: { outDir: "dist", emptyOutDir: true },
  };
});
