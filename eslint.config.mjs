import { getConfig } from '@nitra/eslint-config'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: ['**/auto-imports.d.ts']
  },
  ...getConfig({
    node: ['backend'],
    vue: ['frontend']
  }),
  ...tseslint.config({
    files: ['backend/**/*.ts', 'frontend/**/*.ts'],
    extends: [tseslint.configs.base]
  }),
  {
    files: ['backend/**/*.test.ts', 'backend/**/*.test.js'],
    rules: {
      'jsdoc/require-jsdoc': 'off'
    }
  }
]
