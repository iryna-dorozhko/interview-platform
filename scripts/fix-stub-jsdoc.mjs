import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/**
 * @param {string} dir
 * @param {string[]} files
 */
function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue
    const st = statSync(path)
    if (st.isDirectory()) walk(path, files)
    else if (/\.(js|mjs|cjs|ts|tsx|vue)$/.test(name) && !name.endsWith('.d.ts')) files.push(path)
  }
  return files
}

/** Stub JSDoc: empty description line + @param/@returns without types. */
const STUB_JSDOC_RE =
  /\n?\/\*\*\n\s*\*\n(?:\s*\* @(?:param|returns)(?:\s[^\n]*)?\n)+\s*\*\//g

/** @param {string} text */
function stripStubJsdoc(text) {
  return text.replaceAll(STUB_JSDOC_RE, '')
}

let changed = 0
for (const file of [
  ...walk(join(ROOT, 'backend'), []),
  ...walk(join(ROOT, 'frontend'), []),
  ...walk(join(ROOT, 'scripts'), [])
]) {
  const text = readFileSync(file, 'utf8')
  const next = stripStubJsdoc(text)
  if (next !== text) {
    writeFileSync(file, next)
    changed++
  }
}

console.log(`fixed ${changed} files`)
