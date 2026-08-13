import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'src')
const TEST_FILE_RE = /\.test\.(ts|js)$/
const ASSERT_IMPORT_RE = /^import assert from 'node:assert\/strict'\n/m


function collectTestFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectTestFiles(path))
      continue
    }
    if (TEST_FILE_RE.test(entry.name)) out.push(path)
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

  content = content.replaceAll(/^import test from 'node:test'\n/gm, '')
  content = content.replaceAll(/^import \{ test \} from 'node:test'\n/gm, '')

  if (!content.includes("from 'vitest'")) {
    const vitestLine = `import { ${vitestImports.join(', ')} } from 'vitest'\n`
    const assertMatch = content.match(ASSERT_IMPORT_RE)
    if (assertMatch) {
      content = content.replace(assertMatch[0], assertMatch[0] + vitestLine)
    } else {
      content = vitestLine + content
    }
  }

  content = content.replaceAll(/\btest\.before\(/g, 'beforeAll(')
  content = content.replaceAll(/\btest\.afterEach\(/g, 'afterEach(')
  content = content.replaceAll(/\btest\.after\(/g, 'afterAll(')

  writeFileSync(file, content)
}
