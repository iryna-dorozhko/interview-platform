import { createRequire } from 'node:module'
import * as pinia from 'pinia'
import * as vueRouter from 'vue-router'

const require = createRequire(import.meta.url)
const vue = require('vue') as typeof import('vue')

/** Bun test preload: mirror Vite auto-import globals for composables under test. */
for (const [name, value] of Object.entries({ ...vue, ...pinia, ...vueRouter })) {
  if (name.startsWith('__') || name === 'default') continue
  if (typeof value === 'function' || (typeof value === 'object' && value !== null)) {
    Object.assign(globalThis, { [name]: value })
  }
}
