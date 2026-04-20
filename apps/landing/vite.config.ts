import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import vike from "vike/plugin";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [tailwindcss(), react(), vike()],
  server: {
    port: 5173,
  },
});
