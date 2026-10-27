import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: {
    allowedHosts: ["localhost"],
    fs: {
      deny: [
        "**/.env*",
        "**/*.{crt,pem}",
        "**/.git/**",
        "**/server/**",
        "**/scripts/**",
        "**/supabase/**",
        "**/tests/**",
        "**/tmp/**",
        "**/test-results/**",
        "**/output/**",
        "**/docs/**",
      ],
    },
  },
});
