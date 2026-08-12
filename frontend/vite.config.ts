import Vue from '@vitejs/plugin-vue'
import VueMacros from 'vue-macros/vite'
import { defineConfig, type PluginOption } from 'vite'
import AutoImport from 'unplugin-auto-import/vite'
import Layouts from 'vite-plugin-vue-layouts-next'

export default defineConfig({
  css: {
    transformer: 'lightningcss'
  },
  plugins: [
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      dts: 'src/auto-imports.d.ts'
    }) as PluginOption,
    VueMacros({
      plugins: {
        vue: Vue()
      }
    }) as PluginOption,
    Layouts() as PluginOption
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
