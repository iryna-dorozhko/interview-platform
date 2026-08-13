import { getConfig } from '@nitra/eslint-config'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

export default [
  {
    ignores: [
      '**/auto-imports.d.ts',
      'scripts/**',
      'backend/scripts/**',
      'backend/prisma/**',
      'frontend/reports/**',
      '**/.playwright-mcp/**'
    ]
  },
  ...getConfig({
    node: ['backend'],
    vue: ['frontend']
  }),
  ...tseslint.config({
    files: ['backend/**/*.ts', 'frontend/**/*.ts'],
    extends: [tseslint.configs.base]
  }),
  ...tseslint.config({
    files: ['frontend/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser
      }
    },
    extends: [tseslint.configs.base]
  }),
  {
    files: ['frontend/**/*.vue'],
    rules: {
      // TypeScript у <script lang="ts">; no-undef з eslint:recommended gap не розуміє TS-синтаксис.
      'no-undef': 'off'
    }
  },
  {
    files: ['backend/**/*.test.ts', 'backend/**/*.test.js'],
    rules: {
      'jsdoc/require-jsdoc': 'off'
    }
  }
]
