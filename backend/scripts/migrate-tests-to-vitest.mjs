import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'src')

function collectTestFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectTestFiles(path))
      continue
    }
    if (/\.test\.(ts|js)$/.test(entry.name)) out.push(path)
  }
  return out
}

for (const file of collectTestFiles(ROOT)) {
  let content = readFileSync(file, 'utf8')
  if (!content.includes('node:test')) continue

  const needsBeforeAll = content.includes('test.before(')
  const needsAfterAll = content.includes('test.after(')
  const needsAfterEach = content.includes('test.afterEach(')

  const vitestImports = ['test']
  if (needsBeforeAll) vitestImports.push('beforeAll')
  if (needsAfterAll) vitestImports.push('afterAll')
  if (needsAfterEach) vitestImports.push('afterEach')

  content = content.replace(/^import test from 'node:test'\n/gm, '')
  content = content.replace(/^import \{ test \} from 'node:test'\n/gm, '')

  if (!content.includes("from 'vitest'")) {
    const vitestLine = `import { ${vitestImports.join(', ')} } from 'vitest'\n`
    const assertMatch = content.match(/^import assert from 'node:assert\/strict'\n/m)
    if (assertMatch) {
      content = content.replace(assertMatch[0], assertMatch[0] + vitestLine)
    } else {
      content = vitestLine + content
    }
  }

  content = content.replace(/\btest\.before\(/g, 'beforeAll(')
  content = content.replace(/\btest\.afterEach\(/g, 'afterEach(')
  content = content.replace(/\btest\.after\(/g, 'afterAll(')

  writeFileSync(file, content)
}
