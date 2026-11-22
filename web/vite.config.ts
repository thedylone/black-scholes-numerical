import { defineConfig } from "vite";

// Served at https://projects.thedylone.com/black-scholes-numerical/
export default defineConfig({
  base: "/black-scholes-numerical/",
  build: { outDir: "dist", assetsInlineLimit: 0 },
  test: { include: ["tests/**/*.test.ts"] },
} as any);
