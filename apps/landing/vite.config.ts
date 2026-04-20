import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import vike from "vike/plugin";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [tailwindcss(), react(), vike()],
  server: {
    port: 5173,
  },
});
