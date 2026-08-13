import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/**
 * @param {string} dir
 * @param files
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

const EMPTY_BLOCK = /\n\s*\/\*\*\n\s*\*\n\s*\*\//g
const emptyWithLineCommentRe = /\/\/ ([^\n]+)\n\s*\/\*\*\n\s*\*\n\s*\*\//g

/** @param {string} text */
function stripEmptyJsdoc(text) {
  return text.replaceAll(emptyWithLineCommentRe, '// $1').replaceAll(EMPTY_BLOCK, '\n')
}

let changed = 0
for (const file of [...walk(join(ROOT, 'backend'), []), ...walk(join(ROOT, 'frontend'), []), ...walk(join(ROOT, 'scripts'), [])]) {
  const text = readFileSync(file, 'utf8')
  const next = stripEmptyJsdoc(text)
  if (next !== text) {
    writeFileSync(file, next)
    changed++
  }
}

console.log(`fixed ${changed} files`)
