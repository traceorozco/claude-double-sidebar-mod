// Builds the sidebar: src/sidebar.js with the icon table filled in from the vendored icons.tsv, written to
// dist/sidebar.js and to where Claude's loader reads it
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// the home folder the sidebar file, fonts and saved files go in (the tests point it at a temporary folder)
export const USER_HOME = process.env.DOUBLE_SIDEBAR_HOME || homedir()
// where Claude's loader reads the sidebar on every page load
export const SIDEBAR_FILE = join(USER_HOME, 'Library/Application Support/ClaudeDoubleSidebar/sidebar.js')

export function build() {
  const tsv = readFileSync(join(here, 'vendor/claude-sidebar-icons/icons.tsv'), 'utf8').trim().split('\n').slice(1)
  const table = tsv.map(line => {
    const [, codepoint, name, key] = line.split('\t')
    return [name, String.fromCodePoint(parseInt(codepoint.slice(2), 16)), key || '']
  })
  const src = readFileSync(join(here, 'src/sidebar.js'), 'utf8')
  if (!src.includes('__ICON_TABLE__')) throw new Error('src/sidebar.js has no __ICON_TABLE__ placeholder')
  const out = src.replace('__ICON_TABLE__', JSON.stringify(table))
  mkdirSync(join(here, 'dist'), { recursive: true })
  writeFileSync(join(here, 'dist/sidebar.js'), out)
  mkdirSync(dirname(SIDEBAR_FILE), { recursive: true })
  writeFileSync(SIDEBAR_FILE, out)
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build()
  console.log(`Built dist/sidebar.js and ${SIDEBAR_FILE}`)
}
