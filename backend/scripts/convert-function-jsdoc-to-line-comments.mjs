import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BACKEND_ROOT = join(import.meta.dirname, '..')
const TARGET_DIRS = [join(BACKEND_ROOT, 'src'), join(BACKEND_ROOT, 'scripts')]

const EMPTY_BLOCK = /\/\*\*\n \*\n \*\/\n/g
const FUNCTION_JSDOC =
  /\/\*\*([\s\S]*?)\*\/\n(\s*)(?=(?:export )?(?:async )?function |export (?:async )?function |export const |function |[a-zA-Z_$][\w$]*(?:\s*<[^>]*>)?\s*\()/g

function isSourceFile(name) {
  return (name.endsWith('.ts') || name.endsWith('.js') || name.endsWith('.mjs')) && !name.endsWith('.d.ts')
}

function stripJsdocLinePrefix(line) {
  const trimmed = line.trimStart()
  if (!trimmed.startsWith('*')) return line.trim()
  return trimmed.slice(1).trimStart()
}

function collectFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'docs' || entry.name === 'node_modules') continue
      out.push(...collectFiles(path))
      continue
    }
    if (isSourceFile(entry.name)) out.push(path)
  }
  return out
}

function jsdocBodyToLineComment(body, indent) {
  const text = body
    .split('\n')
    .map(line => stripJsdocLinePrefix(line))
    .filter(Boolean)
    .join(' ')
  return text ? `${indent}// ${text}\n` : ''
}

for (const dir of TARGET_DIRS) {
  for (const file of collectFiles(dir)) {
    let content = readFileSync(file, 'utf8')
    const original = content

    content = content.replace(EMPTY_BLOCK, '')
    content = content.replace(FUNCTION_JSDOC, (_match, body, indent) => jsdocBodyToLineComment(body, indent))

    if (content !== original) writeFileSync(file, content)
  }
}
