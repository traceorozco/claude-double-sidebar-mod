// Patches Claude.app so its own sidebar draws the double sidebar: the code in src/sidebar.js is
// appended to the claude.ai page's loader (mainView.js), so it runs inside the real page, not over it.
//
//   node patch.mjs            install the sidebar
//   node patch.mjs --dev      for building it, never ship: open a debug port on 127.0.0.1:9339, and load
//                             dist/sidebar.js from this folder on every page load instead of baking it
//                             in, so `node build.mjs` and a reload (Cmd+R) show a change without re-patching
//   node patch.mjs --restore  put back the app.asar this patcher saved before its first change
//
// Claude checks app.asar against a hash in its signed Info.plist, so the patch rewrites that hash and
// re-signs the app with a local certificate ("Claude Local", created on first run). Claude's own updates
// then fail: download Claude again and run this again.

import { readFileSync, writeFileSync, existsSync, copyFileSync, rmSync, readdirSync, mkdirSync, renameSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'
import { build } from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const APP = process.env.CLAUDE_APP || '/Applications/Claude.app'
const ASAR = join(APP, 'Contents/Resources/app.asar')
const PLIST = join(APP, 'Contents/Info.plist')
const BACKUP = ASAR + '.original'
const MARK = '/* claude-double-sidebar */'
const dev = process.argv.includes('--dev')

const sha = b => createHash('sha256').update(b).digest('hex')

function readAsar(buf) {
  const headerSize = buf.readUInt32LE(4)
  const strLen = buf.readUInt32LE(12)
  const header = JSON.parse(buf.subarray(16, 16 + strLen).toString('utf8'))
  return { header, dataStart: 8 + headerSize }
}

function node(header, path) {
  let n = header
  for (const p of path.split('/')) n = n.files[p]
  return n
}

// Rebuilds the archive with some files' bytes replaced; every other entry keeps its flags (unpacked,
// executable, links) and its integrity, and only offsets move.
function writeAsar(buf, header, dataStart, replace) {
  const chunks = []
  let offset = 0
  const visit = n => {
    for (const v of Object.values(n.files)) {
      if (v.files) { visit(v); continue }
      if (v.link || v.unpacked) continue
      const bytes = replace.get(v) ?? buf.subarray(dataStart + Number(v.offset), dataStart + Number(v.offset) + v.size)
      if (replace.has(v)) {
        const blockSize = 4 * 1024 * 1024, blocks = []
        for (let i = 0; i < bytes.length; i += blockSize) blocks.push(sha(bytes.subarray(i, i + blockSize)))
        if (blocks.length === 0) blocks.push(sha(Buffer.alloc(0)))
        v.size = bytes.length
        v.integrity = { algorithm: 'SHA256', hash: sha(bytes), blockSize, blocks }
      }
      v.offset = String(offset)
      offset += bytes.length
      chunks.push(bytes)
    }
  }
  visit(header)
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const pad = (4 - (json.length % 4)) % 4
  const pickle = Buffer.alloc(8 + json.length + pad)
  pickle.writeUInt32LE(4 + json.length + pad, 0)
  pickle.writeUInt32LE(json.length, 4)
  json.copy(pickle, 8)
  const head = Buffer.alloc(8)
  head.writeUInt32LE(4, 0)
  head.writeUInt32LE(pickle.length, 4)
  return { out: Buffer.concat([head, pickle, ...chunks]), headerHash: sha(json) }
}

const CERT = 'Claude Local'
const SAVED = join(homedir(), 'Library/Application Support/claude-double-sidebar-mod')
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString()

// A self-signed code-signing certificate in the login keychain, made once. Signing with the same
// certificate every time keeps Claude's identity fixed, so macOS keeps its keychain and privacy grants
// across re-patches (a throwaway ad hoc signature would change it on every build).
function ensureCertificate() {
  if (run('security', ['find-identity', '-p', 'codesigning']).includes(`"${CERT}"`)) return
  console.log(`Creating the "${CERT}" signing certificate in your login keychain`)
  const dir = mkdtempSync(join(tmpdir(), 'claude-local-'))
  try {
    writeFileSync(join(dir, 'cert.cnf'), [
      '[req]', 'distinguished_name = dn', 'x509_extensions = ext', 'prompt = no',
      '[dn]', `CN = ${CERT}`,
      '[ext]', 'basicConstraints = critical, CA:false', 'keyUsage = critical, digitalSignature', 'extendedKeyUsage = critical, codeSigning',
    ].join('\n'))
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-config', join(dir, 'cert.cnf'),
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')])
    // a throwaway password: macOS will not import a .p12 without one
    const pass = createHash('sha256').update(String(Math.random()) + Date.now()).digest('hex').slice(0, 24)
    run('openssl', ['pkcs12', '-export', '-inkey', join(dir, 'key.pem'), '-in', join(dir, 'cert.pem'),
      '-out', join(dir, 'cert.p12'), '-name', CERT, '-passout', `pass:${pass}`])
    run('security', ['import', join(dir, 'cert.p12'), '-k', join(homedir(), 'Library/Keychains/login.keychain-db'),
      '-P', pass, '-T', '/usr/bin/codesign'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function resign() {
  // Claude's provisioning profile and team-bound entitlements only work under Anthropic's signature:
  // set aside, and dropped from the entitlements a local signature carries. The rest stay.
  mkdirSync(SAVED, { recursive: true })
  const profile = join(APP, 'Contents/embedded.provisionprofile')
  if (existsSync(profile)) renameSync(profile, join(SAVED, 'embedded.provisionprofile'))
  const ents = join(tmpdir(), `claude-double-sidebar-mod-${process.pid}.plist`)
  writeFileSync(ents, run('codesign', ['-d', '--entitlements', '-', '--xml', APP]))
  for (const k of ['com.apple.application-identifier', 'com.apple.developer.team-identifier',
    'com.apple.developer.associated-domains', 'keychain-access-groups']) {
    try { run('/usr/libexec/PlistBuddy', ['-c', `Delete :${k}`, ents]) } catch {}
  }
  ensureCertificate()
  execFileSync('codesign', ['--force', '--sign', CERT, '--entitlements', ents, APP], { stdio: 'inherit' })
  rmSync(ents, { force: true })
  run('codesign', ['--verify', '--strict', APP])
}

function setIntegrity(hash) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hash}`, PLIST])
}

if (process.argv.includes('--restore')) {
  if (!existsSync(BACKUP)) { console.error('No saved app.asar to restore. Reinstall Claude instead.'); process.exit(1) }
  const { header } = readAsar(readFileSync(BACKUP))
  copyFileSync(BACKUP, ASAR)
  setIntegrity(sha(Buffer.from(JSON.stringify(header), 'utf8')))
  resign()
  console.log('Restored the original app.asar. Quit and reopen Claude.')
  process.exit(0)
}

if (!existsSync(ASAR)) { console.error(`No Claude app at ${APP}. Install Claude, or set CLAUDE_APP to where it is.`); process.exit(1) }
const version = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', PLIST]).trim()
// a backup from an older Claude would roll the app back: Claude updated, so this asar is the new original
if (existsSync(BACKUP) && !readFileSync(ASAR).includes(MARK)) copyFileSync(ASAR, BACKUP)
if (!existsSync(BACKUP)) copyFileSync(ASAR, BACKUP)
const src = readFileSync(BACKUP)
const { header, dataStart } = readAsar(src)
const read = n => src.subarray(dataStart + Number(n.offset), dataStart + Number(n.offset) + n.size)

// the icon fonts Claude's sidebar draws section names with (they stand in for fonts it asks for)
const fonts = join(here, 'vendor/claude-sidebar-icons/fonts')
for (const f of readdirSync(fonts).filter(f => f.endsWith('.ttf'))) copyFileSync(join(fonts, f), join(homedir(), 'Library/Fonts', f))

const replace = new Map()
const sidebar = build()
if (dev) {
  // the app stays as signed while the sidebar changes: the main process reads dist/sidebar.js fresh
  // each time a claude.ai page loads and runs it there
  const dist = JSON.stringify(join(here, 'dist/sidebar.js'))
  const entry = node(header, '.vite/build/index.js')
  const line = `${MARK}require("electron").app.commandLine.appendSwitch("remote-debugging-port","9339");require("electron").app.commandLine.appendSwitch("remote-debugging-address","127.0.0.1");` +
    `require("electron").app.on("web-contents-created",(_,wc)=>wc.on("dom-ready",()=>{if(!/^https:\\/\\/claude\\.ai/.test(wc.getURL()))return;let s;try{s=require("fs").readFileSync(${dist},"utf8")}catch(e){return console.error("[double-sidebar]",e.message)}wc.executeJavaScript(";(() => {\\n"+s+"\\n})();").catch(e=>console.error("[double-sidebar]",e))}));\n`
  replace.set(entry, Buffer.concat([Buffer.from(line), read(entry)]))
} else {
  const view = node(header, '.vite/build/mainView.js')
  replace.set(view, Buffer.concat([read(view), Buffer.from(`\n${MARK}\n;(() => {\n${sidebar}\n})();\n`)]))
}

const { out, headerHash } = writeAsar(src, header, dataStart, replace)
writeFileSync(ASAR, out)
setIntegrity(headerHash)
resign()
console.log(`Patched Claude ${version} at ${APP}${dev ? ' (dev: debug port 127.0.0.1:9339)' : ''}. Quit and reopen Claude.`)
