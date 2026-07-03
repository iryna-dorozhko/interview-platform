import { defineConfig, type PluginOption } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue() as PluginOption],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
