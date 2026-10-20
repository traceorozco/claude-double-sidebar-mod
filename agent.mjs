// The background agent. launchd runs it every minute and whenever Claude's Info.plist changes. After Claude
// updates, it puts the sidebar back the next time Claude is closed, and says what happened in a
// notification. Each build of Claude is dealt with once: one it has patched, can't patch, or failed to
// patch is left alone after that, so it never retries in a loop.
//
//   node agent.mjs            one check (what launchd runs)
//   node agent.mjs --install  set up the LaunchAgent for this folder and the node running it
//   node agent.mjs --remove   take the LaunchAgent out
//
// It reads nothing but Claude.app and its own state file, and runs nothing but patch.mjs, ps and osascript.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { USER_HOME } from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const APP = (process.env.CLAUDE_APP || '/Applications/Claude.app').replace(/\/+$/, '')
const LABEL = 'local.claude-double-sidebar'
const PLIST = join(USER_HOME, 'Library/LaunchAgents', `${LABEL}.plist`)
const LOG = join(USER_HOME, 'Library/Logs/claude-double-sidebar.log')
const STATE = join(USER_HOME, 'Library/Application Support/claude-double-sidebar-mod/agent.json')
const domain = `gui/${process.getuid()}`

const log = msg => console.log(`${new Date().toISOString()} ${msg}`)
const load = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch { return {} } }
const save = s => { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n') }
const plistValue = (key, file) => {
  try { return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' }
}
// the tests set DOUBLE_SIDEBAR_NOTIFY=print to read notifications instead of showing them
const notify = text => {
  log(`notify: ${text}`)
  if (process.env.DOUBLE_SIDEBAR_NOTIFY !== 'print')
    spawnSync('osascript', ['-e', `display notification ${JSON.stringify(text)} with title "Claude Double Sidebar"`])
}
const running = () => process.env.DOUBLE_SIDEBAR_FAKE_RUNNING === '1' ||
  execFileSync('ps', ['-axo', 'comm=']).toString().split('\n').some(l => l.startsWith(APP + '/'))
const patch = args => spawnSync(process.execPath, [join(here, 'patch.mjs'), ...args], { encoding: 'utf8' })

function check() {
  const fingerprint = plistValue('ElectronAsarIntegrity:Resources/app.asar:hash', join(APP, 'Contents/Info.plist'))
  if (!fingerprint) return // no Claude here, or mid-update
  let s = load()
  if (fingerprint === s.done) return // the build patched last: nothing to do

  const version = plistValue('CFBundleShortVersionString', join(APP, 'Contents/Info.plist')) || 'of unknown version'
  // a new build: what it needs, worked out once
  if (s.build?.fingerprint !== fingerprint) {
    const r = patch(['--state'])
    s.build = { fingerprint, version, state: r.status === 0 ? r.stdout.trim() : 'refused', reason: r.stderr.trim(), told: '' }
    save(s)
    log(`Claude ${version}: ${s.build.state}${s.build.reason ? ` (${s.build.reason})` : ''}`)
  }
  const tell = (kind, text) => {
    if (s.build.told === kind) return
    notify(text)
    s.build.told = kind
    save(s)
  }

  if (s.build.state === 'installed') { s.done = fingerprint; save(s); return }
  if (s.build.state === 'refused')
    return tell('refused', `Claude ${version} is laid out in a way this version of the sidebar mod doesn't know, so the sidebar is off. Claude works as normal. Update the mod to bring the sidebar back.`)
  if (s.build.state === 'failed') return
  if (running()) return tell('waiting', `Claude updated to ${version}. Your sidebar comes back the next time you quit Claude.`)

  log(`Patching Claude ${version}`)
  const r = patch([])
  s = { ...load(), build: s.build } // patch.mjs records the patched build in the same file
  if (r.status === 0) {
    // the patched build has a fingerprint of its own, recorded by patch.mjs: this one's notes are done with
    delete s.build
    save(s)
    log(r.stdout.trim())
    return notify(`Sidebar restored for Claude ${version}. It's there the next time you open Claude.`)
  }
  // opened again before the swap: Claude is unchanged, and the next check tries again
  if (running()) { save(s); return log('Claude was opened during the patch: trying again once it is closed') }
  s.build.state = 'failed'
  s.build.reason = (r.stderr || r.stdout).trim().split('\n').filter(Boolean).slice(-2).join(' ')
  save(s)
  log(`Patch failed: ${s.build.reason}`)
  tell('failed', `Couldn't put the sidebar back for Claude ${version}. Claude works as normal. Run ./install.sh in ${here} to see why.`)
}

function install() {
  mkdirSync(dirname(PLIST), { recursive: true })
  mkdirSync(dirname(LOG), { recursive: true })
  const agent = {
    Label: LABEL,
    ProgramArguments: [process.execPath, join(here, 'agent.mjs')],
    WatchPaths: [join(APP, 'Contents/Info.plist')],
    StartInterval: 60,
    RunAtLoad: true,
    ProcessType: 'Background',
    StandardOutPath: LOG,
    StandardErrorPath: LOG,
    ...(process.env.CLAUDE_APP ? { EnvironmentVariables: { CLAUDE_APP: APP } } : {}),
  }
  // written as JSON and converted, so paths with any characters in them come out as valid XML
  const json = join(tmpdir(), `${LABEL}-${process.pid}.json`)
  writeFileSync(json, JSON.stringify(agent))
  execFileSync('plutil', ['-convert', 'xml1', '-o', PLIST, json])
  rmSync(json, { force: true })
  spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' })
  execFileSync('launchctl', ['bootstrap', domain, PLIST])
  console.log(`Background agent set up: ${PLIST}`)
}

function remove() {
  spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' })
  rmSync(PLIST, { force: true })
  rmSync(STATE, { force: true })
  console.log('Background agent removed.')
}

if (process.argv.includes('--install')) install()
else if (process.argv.includes('--remove')) remove()
else check()
