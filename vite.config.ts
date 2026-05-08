import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/.play/",
  plugins: [react()],
  build: {
    outDir: "dist/client",
    sourcemap: true,
  },
});
