import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ROUTES_DIR = join(ROOT, 'backend/src/routes')

/** @param {string} text */
function mergeExpressImports(text) {
  return text.replaceAll(
    /import\s*\{([^}]+)\}\s*from\s*'express'\s*\r?\nimport\s+type\s*\{([^}]+)\}\s*from\s*'express'/g,
    (_, values, types) => {
      const typeList = types
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => (part.startsWith('type ') ? part : `type ${part}`))
        .join(', ')
      return `import { ${values.trim()}, ${typeList} } from 'express'`
    }
  )
}

/** @param {string} text */
function wrapAsyncRouteHandlers(text) {
  const lines = text.split('\n')
  const out = []
  let inAsyncRoute = false
  let braceDepth = 0

  for (const line of lines) {
    let next = line

    if (/^\s*router\.(get|post|put|patch|delete)\(/.test(line) && line.includes('async (')) {
      next = next.replaceAll(', async (', ', asyncHandler(async (')
      if (!next.includes('asyncHandler(')) {
        next = next.replace(/async \(/, 'asyncHandler(async (')
      }
      inAsyncRoute = true
      braceDepth = 0
    }

    if (inAsyncRoute) {
      for (const ch of next) {
        if (ch === '{') braceDepth++
        if (ch === '}') braceDepth--
      }

      if (braceDepth === 0 && /^\s*\}\)\s*$/.test(next)) {
        next = next.replace(/\}\)\s*$/, '}))')
        inAsyncRoute = false
      }
    }

    out.push(next)
  }

  return out.join('\n')
}

/** @param {string} text */
function ensureAsyncHandlerImport(text) {
  if (!text.includes('asyncHandler(') || text.includes('async-handler')) return text
  const expressImport = text.match(/^import\s+.*from\s+'express'.*$/m)
  if (!expressImport) {
    return `import { asyncHandler } from '../utils/async-handler'\n${text}`
  }
  const idx = text.indexOf(expressImport[0]) + expressImport[0].length + 1
  return `${text.slice(0, idx)}import { asyncHandler } from '../utils/async-handler'\n${text.slice(idx)}`
}

/** @param {string} dir */
function collectRouteFiles(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) files.push(...collectRouteFiles(path))
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) files.push(path)
  }
  return files
}

let changed = 0
for (const file of collectRouteFiles(ROUTES_DIR)) {
  const text = readFileSync(file, 'utf8')
  let next = mergeExpressImports(text)
  next = wrapAsyncRouteHandlers(next)
  next = ensureAsyncHandlerImport(next)
  if (next !== text) {
    writeFileSync(file, next)
    changed++
    console.log('fixed', file)
  }
}

console.log(`updated ${changed} route files`)
