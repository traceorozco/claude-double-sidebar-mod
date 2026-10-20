// Patches Claude.app so its own sidebar draws the double sidebar: a loader in Claude runs the sidebar
// file (built from src/sidebar.js) inside the real claude.ai page on every page load, not over it.
//
//   node patch.mjs               install or update the sidebar; re-signs Claude only when its loader needs it
//   node patch.mjs --dev         for working on it, never ship: the same, plus a debug port on 127.0.0.1:9339
//   node patch.mjs --state       prints needs-patch or installed; exits 2, saying why, if it can't read Claude
//   node patch.mjs --plan        list every change an install would make, and change nothing
//   node patch.mjs --restore     put back the app.asar this patcher saved before its first change
//
// Claude checks app.asar against a hash in its signed Info.plist, so the patch rewrites that hash and
// re-signs the app with a local certificate ("Claude Local", created on first run). Every change is made
// to a copy of Claude.app beside it, which is signed and checked before it takes Claude's place: if any
// step fails, Claude is left as it was.
//
// Exit codes: 0 done, 1 a step failed (Claude unchanged), 2 refused before changing anything.

import { readFileSync, writeFileSync, existsSync, copyFileSync, rmSync, readdirSync, mkdirSync, renameSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'
import { build, SIDEBAR_FILE, USER_HOME } from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const APP = (process.env.CLAUDE_APP || '/Applications/Claude.app').replace(/\/+$/, '')
// the copy that's changed and signed, and where Claude waits during the swap; both beside Claude, on its volume
const NAME = basename(APP, '.app')
const STAGE = join(dirname(APP), `.${NAME}.double-sidebar-new.app`)
const OLD = join(dirname(APP), `.${NAME}.double-sidebar-old.app`)
const ASAR = 'Contents/Resources/app.asar'
const PLIST = 'Contents/Info.plist'
const BACKUP = ASAR + '.original'
const ENTRY = '.vite/build/index.js'
const dev = process.argv.includes('--dev')
const LOADER = `/* claude-double-sidebar loader 1${dev ? ' dev' : ''} */`

const sha = b => createHash('sha256').update(b).digest('hex')
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString()
const plistBuddy = (cmd, plist) => run('/usr/libexec/PlistBuddy', ['-c', cmd, plist]).trim()

// a refusal: something was wrong before anything changed
class Refusal extends Error {}
const refuse = msg => { throw new Refusal(msg) }

// for test/patch.test.mjs: fail on purpose at one step, to check Claude is left as it was
const failAt = step => { if (process.env.DOUBLE_SIDEBAR_FAIL_AT === step) throw new Error(`test failure at ${step}`) }

function readAsar(buf) {
  const headerSize = buf.readUInt32LE(4)
  const strLen = buf.readUInt32LE(12)
  const raw = buf.subarray(16, 16 + strLen)
  return { header: JSON.parse(raw.toString('utf8')), dataStart: 8 + headerSize, headerHash: sha(raw) }
}

function node(header, path) {
  let n = header
  for (const p of path.split('/')) n = n.files[p]
  return n
}

const bytes = (buf, dataStart, n) => buf.subarray(dataStart + Number(n.offset), dataStart + Number(n.offset) + n.size)

// Rebuilds the archive with some files' bytes replaced; every other entry keeps its flags (unpacked,
// executable, links) and its integrity, and only offsets move.
function writeAsar(buf, header, dataStart, replace) {
  const chunks = []
  let offset = 0
  const visit = n => {
    for (const v of Object.values(n.files)) {
      if (v.files) { visit(v); continue }
      if (v.link || v.unpacked) continue
      const b = replace.get(v) ?? bytes(buf, dataStart, v)
      if (replace.has(v)) {
        const blockSize = 4 * 1024 * 1024, blocks = []
        for (let i = 0; i < b.length; i += blockSize) blocks.push(sha(b.subarray(i, i + blockSize)))
        if (blocks.length === 0) blocks.push(sha(Buffer.alloc(0)))
        v.size = b.length
        v.integrity = { algorithm: 'SHA256', hash: sha(b), blockSize, blocks }
      }
      v.offset = String(offset)
      offset += b.length
      chunks.push(b)
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

// What the patch relies on in Claude, checked before anything changes: an app.asar with the main process
// entry inside it, and a fingerprint in Info.plist that matches the archive. A Claude laid out any other
// way stops here.
function inspect(app) {
  if (!existsSync(join(app, ASAR))) refuse(`No Claude app at ${app}. Install Claude, or set CLAUDE_APP to where it is.`)
  let version = 'of unknown version'
  try { version = plistBuddy('Print :CFBundleShortVersionString', join(app, PLIST)) } catch {}
  const unlike = what => refuse(`Claude ${version} isn't laid out the way this mod expects: ${what}. Nothing changed.`)
  let buf, asar, entry
  try {
    buf = readFileSync(join(app, ASAR))
    asar = readAsar(buf)
    entry = node(asar.header, ENTRY)
  } catch {}
  if (!asar) unlike(`its app.asar can't be read`)
  if (!entry || entry.files || entry.link || entry.unpacked) unlike(`its app.asar has no ${ENTRY}`)
  let fingerprint = ''
  try { fingerprint = plistBuddy('Print :ElectronAsarIntegrity:Resources/app.asar:hash', join(app, PLIST)) } catch {}
  if (!fingerprint) unlike(`its Info.plist has no app.asar fingerprint`)
  if (fingerprint !== asar.headerHash) unlike(`its app.asar fingerprint doesn't match the archive`)
  return { version, patched: bytes(buf, asar.dataStart, entry).toString().startsWith(LOADER) }
}

// Claude, or any of its helpers, running from this copy of the app
const running = app => run('ps', ['-axo', 'comm=']).split('\n').some(l => l.startsWith(app + '/'))

const CERT = 'Claude Local'
const SAVED = join(USER_HOME, 'Library/Application Support/claude-double-sidebar-mod')

// A self-signed code-signing certificate in the login keychain, made once. Signing with the same
// certificate every time keeps Claude's identity fixed, so macOS keeps its keychain and privacy grants
// across re-patches (a throwaway ad hoc signature would change it on every build).
const hasCertificate = () => run('security', ['find-identity', '-p', 'codesigning']).includes(`"${CERT}"`)
function ensureCertificate() {
  if (hasCertificate()) return
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
  } catch (e) {
    refuse(`Couldn't create the "${CERT}" signing certificate: ${String(e.stderr || e.message).trim()}. Claude wasn't changed.`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (!hasCertificate()) refuse(`The "${CERT}" certificate isn't usable for signing. Claude wasn't changed.`)
}

function resign(app) {
  // Claude's provisioning profile and team-bound entitlements only work under Anthropic's signature:
  // set aside, and dropped from the entitlements a local signature carries. The rest stay.
  mkdirSync(SAVED, { recursive: true })
  const profile = join(app, 'Contents/embedded.provisionprofile')
  if (existsSync(profile)) { copyFileSync(profile, join(SAVED, 'embedded.provisionprofile')); rmSync(profile) }
  const ents = join(tmpdir(), `claude-double-sidebar-mod-${process.pid}.plist`)
  writeFileSync(ents, run('codesign', ['-d', '--entitlements', '-', '--xml', app]))
  for (const k of ['com.apple.application-identifier', 'com.apple.developer.team-identifier',
    'com.apple.developer.associated-domains', 'keychain-access-groups']) {
    try { plistBuddy(`Delete :${k}`, ents) } catch {}
  }
  try {
    failAt('sign')
    run('codesign', ['--force', '--sign', CERT, '--entitlements', ents, app])
  } finally {
    rmSync(ents, { force: true })
  }
  run('codesign', ['--verify', '--strict', app])
}

const setIntegrity = (app, hash) => plistBuddy(`Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hash}`, join(app, PLIST))

// a run stopped between the two renames of a swap leaves Claude in OLD: put it back, and clear leftovers
function recover() {
  if (!existsSync(APP) && existsSync(OLD)) renameSync(OLD, APP)
  rmSync(STAGE, { recursive: true, force: true })
  if (existsSync(APP)) rmSync(OLD, { recursive: true, force: true })
}

function checkSpace() {
  const need = Number(run('du', ['-sk', APP]).split('\t')[0])
  const free = Number(run('df', ['-k', dirname(APP)]).trim().split('\n').pop().trim().split(/\s+/)[3])
  if (free < need * 1.2) refuse(`Patching makes a copy of Claude beside it and needs ${Math.ceil(need / 1024)} MB free there; ${Math.floor(free / 1024)} MB is. Claude wasn't changed.`)
}

// Every change to Claude goes through a copy: copy it, change the copy, sign and check it, then swap it in.
// Claude itself is only touched by the two renames of the swap, and a failed swap renames it back.
function staged(change) {
  if (running(APP)) refuse("Claude is open. Quit it and run this again. Claude wasn't changed.")
  ensureCertificate() // may ask for the login keychain password, so it comes before any change
  checkSpace()
  recover()
  try {
    try {
      run('ditto', [APP, STAGE])
    } catch (e) {
      refuse(`Couldn't copy Claude to ${dirname(APP)}: ${String(e.stderr || e.message).trim()}. Claude wasn't changed.`)
    }
    change(STAGE)
    resign(STAGE)
    const check = inspect(STAGE)
    renameSync(APP, OLD)
    try {
      failAt('swap')
      renameSync(STAGE, APP)
    } catch (e) {
      renameSync(OLD, APP)
      throw e
    }
    rmSync(OLD, { recursive: true, force: true })
    return check
  } catch (e) {
    rmSync(STAGE, { recursive: true, force: true })
    throw e
  }
}

function install() {
  recover()
  const { version, patched } = inspect(APP)

  // the sidebar, built and put where the loader reads it
  build()
  console.log(`Sidebar installed at ${SIDEBAR_FILE}`)

  // the icon fonts Claude's sidebar draws section names with (they stand in for fonts it asks for)
  const fonts = join(here, 'vendor/claude-sidebar-icons/fonts'), userFonts = join(USER_HOME, 'Library/Fonts')
  mkdirSync(userFonts, { recursive: true })
  for (const f of readdirSync(fonts).filter(f => f.endsWith('.ttf'))) copyFileSync(join(fonts, f), join(userFonts, f))

  // Claude carries a small loader; the sidebar itself is a file outside the app, read on every page load.
  // So a sidebar update only replaces that file, and Claude is re-signed (a new build, which macOS asks
  // about for keychain access) only when the loader is missing or changed: a first install, or a new Claude.
  if (patched) {
    console.log('Claude already has the loader: nothing to re-sign. Quit and reopen Claude to see the change.')
    return
  }

  staged(app => {
    const asar = join(app, ASAR), backup = join(app, BACKUP)
    // a backup from an older Claude would roll the app back: Claude updated, so this asar is the new original
    if (existsSync(backup) && !readFileSync(asar).includes('/* claude-double-sidebar')) copyFileSync(asar, backup)
    if (!existsSync(backup)) copyFileSync(asar, backup)
    const src = readFileSync(backup)
    const { header, dataStart } = readAsar(src)

    // The loader, at the top of Claude's main process: on each claude.ai page load it reads the sidebar
    // file and runs it in the page, in a world of its own (the dev build runs it in the page's own world
    // instead, where the debug port's console can reach it, and opens that port on 127.0.0.1 only)
    const file = JSON.stringify(SIDEBAR_FILE)
    const runIt = dev
      ? 'wc.executeJavaScript(code)'
      : 'wc.executeJavaScriptInIsolatedWorld(1001,[{code}])'
    const loader = LOADER +
      (dev ? 'require("electron").app.commandLine.appendSwitch("remote-debugging-port","9339");require("electron").app.commandLine.appendSwitch("remote-debugging-address","127.0.0.1");' : '') +
      `require("electron").app.on("web-contents-created",(_,wc)=>wc.on("dom-ready",()=>{if(!/^https:\\/\\/claude\\.ai/.test(wc.getURL()))return;let s;try{s=require("fs").readFileSync(${file},"utf8")}catch(e){return console.error("[double-sidebar]",e.message)}const code=";(() => {\\n"+s+"\\n})();";${runIt}.catch(e=>console.error("[double-sidebar]",e))}));\n`
    const entry = node(header, ENTRY)
    const { out, headerHash } = writeAsar(src, header, dataStart, new Map([[entry, Buffer.concat([Buffer.from(loader), bytes(src, dataStart, entry)])]]))
    writeFileSync(asar, out)
    setIntegrity(app, headerHash)
  })
  console.log(`Patched Claude ${version} at ${APP}${dev ? ' (dev: debug port 127.0.0.1:9339)' : ''}. Quit and reopen Claude.`)
}

function restore() {
  recover()
  inspect(APP)
  if (!existsSync(join(APP, BACKUP))) refuse('No saved app.asar to restore. Download Claude again instead. Nothing changed.')
  staged(app => {
    copyFileSync(join(app, BACKUP), join(app, ASAR))
    setIntegrity(app, readAsar(readFileSync(join(app, ASAR))).headerHash)
  })
  console.log('Restored the original app.asar. Quit and reopen Claude.')
}

function plan() {
  const { patched } = inspect(APP)
  const profile = existsSync(join(APP, 'Contents/embedded.provisionprofile'))
  const lines = [`Claude Double Sidebar mod: what installing would change on this Mac`, '']
  lines.push(`Always:`)
  lines.push(`  - writes the sidebar to ${SIDEBAR_FILE}`)
  lines.push(`  - copies 4 icon fonts (CCSidebarIcons*.ttf, named Segoe UI Symbol, Segoe UI, Roboto and Consolas) to ~/Library/Fonts`)
  if (!patched) {
    lines.push('', `Claude.app needs the loader, so this run also:`)
    lines.push(`  - quits Claude while it patches`)
    lines.push(`  - copies Claude.app to ${STAGE} and makes every change below to the copy`)
    lines.push(`  - saves Claude's original app.asar in the copy as ${BACKUP}`)
    lines.push(`  - adds a loader to ${ENTRY} inside ${ASAR}: on each claude.ai page load it reads the sidebar file and runs it in the page`)
    lines.push(`  - updates the app.asar fingerprint in ${PLIST}`)
    if (profile) lines.push(`  - moves Claude's provisioning profile to ${join(SAVED, 'embedded.provisionprofile')}`)
    lines.push(`  - removes Anthropic-only entitlements (application identifier, team identifier, associated domains, keychain access groups) from Claude's signature`)
    lines.push(hasCertificate() ? `  - signs the copy with the "${CERT}" certificate already in your login keychain`
                                : `  - creates a self-signed code-signing certificate "${CERT}" in your login keychain, and signs the copy with it`)
    lines.push(`  - checks the copy's signature, then swaps it in for ${APP}. If any step fails, Claude stays as it was`)
    lines.push('', `Afterwards: Claude is signed by "${CERT}", not Anthropic. macOS asks once whether Claude may use "Claude Safe Storage".`)
  } else {
    lines.push('', `Claude.app already has the loader: it is not changed or re-signed, and macOS asks nothing.`)
  }
  lines.push('', `Never: no network requests, nothing sent anywhere, no other app changed.`, `Undo: ./uninstall.sh`)
  console.log(lines.join('\n'))
}

try {
  if (process.argv.includes('--state')) console.log(inspect(APP).patched ? 'installed' : 'needs-patch')
  else if (process.argv.includes('--plan')) plan()
  else if (process.argv.includes('--restore')) restore()
  else install()
} catch (e) {
  if (e instanceof Refusal) { console.error(e.message); process.exit(2) }
  console.error(`Stopped: ${String(e.stderr || e.message).trim()}`)
  console.error(existsSync(APP) ? 'Claude was left as it was.' : `Claude isn't at ${APP}: run this again to put it back.`)
  process.exit(1)
}
