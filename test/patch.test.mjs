// Tests patch.mjs and agent.mjs against a copy of Claude.app in a temporary folder: install, install
// again, failures at signing and at the swap, a run stopped mid-swap, restore, the signing rules, the
// background agent after a simulated update, and a Claude it doesn't recognise. The
// sidebar file and fonts go to a temporary home too, so the Claude in /Applications and your own
// files are never touched. Signing uses the "Claude Local" certificate, so run it on a Mac that has it.
//
//   node --test test/patch.test.mjs
//   CLAUDE_SOURCE=/path/to/Claude.app node --test test/patch.test.mjs    copy a different Claude

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync, cpSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PATCH = join(dirname(fileURLToPath(import.meta.url)), '..', 'patch.mjs')
const AGENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent.mjs')
const SOURCE = process.env.CLAUDE_SOURCE || '/Applications/Claude.app'
const dir = mkdtempSync(join(tmpdir(), 'double-sidebar-test-'))
const APP = join(dir, 'Claude.app')
const HOME = join(dir, 'home')
const STAGE = join(dir, '.Claude.double-sidebar-new.app')
const OLD = join(dir, '.Claude.double-sidebar-old.app')

const patch = (args = [], env = {}) => {
  const r = spawnSync('node', [PATCH, ...args], {
    env: { ...process.env, CLAUDE_APP: APP, DOUBLE_SIDEBAR_HOME: HOME, DOUBLE_SIDEBAR_FAIL_AT: '', ...env },
    encoding: 'utf8',
  })
  return { status: r.status, out: r.stdout + r.stderr }
}
const state = () => patch(['--state'])
// one check by the background agent, with notifications printed instead of shown
const agent = (env = {}) => {
  const r = spawnSync('node', [AGENT], {
    env: { ...process.env, CLAUDE_APP: APP, DOUBLE_SIDEBAR_HOME: HOME, DOUBLE_SIDEBAR_NOTIFY: 'print', DOUBLE_SIDEBAR_FAIL_AT: '', DOUBLE_SIDEBAR_FAKE_RUNNING: '', ...env },
    encoding: 'utf8',
  })
  return { status: r.status, out: r.stdout + r.stderr, notes: (r.stdout.match(/notify: .*/g) || []).map(l => l.slice(8)) }
}
const requirement = () => spawnSync('codesign', ['-d', '-r-', APP], { encoding: 'utf8' }).stdout.trim().replace(/^designated => /, '')
const LEAF = execFileSync('security', ['find-certificate', '-c', 'Claude Local', '-Z']).toString().match(/SHA-1 hash: (\w+)/)[1].toLowerCase()
const ELECTRON = () => join(APP, 'Contents/Frameworks/Electron Framework.framework')
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex')
const fingerprint = () => execFileSync('/usr/libexec/PlistBuddy',
  ['-c', 'Print :ElectronAsarIntegrity:Resources/app.asar:hash', join(APP, 'Contents/Info.plist')]).toString().trim()
const cdhash = () => spawnSync('codesign', ['-dvvv', APP], { encoding: 'utf8' }).stderr.match(/CDHash=(\w+)/)?.[1]
const verified = () => spawnSync('codesign', ['--verify', '--strict', APP]).status === 0
// what a change to Claude would alter: its archive, its fingerprint and its signature
const snapshot = () => ({ asar: sha(join(APP, 'Contents/Resources/app.asar')), fingerprint: fingerprint(), cdhash: cdhash() })
const leftovers = () => [STAGE, OLD].filter(existsSync)

before(() => {
  execFileSync('ditto', [SOURCE, APP])
})
after(() => rmSync(dir, { recursive: true, force: true }))

test('a copy of Claude without the loader to start from', () => {
  // the source may be patched already: put its own app.asar back, if it has one saved
  if (existsSync(join(APP, 'Contents/Resources/app.asar.original'))) assert.equal(patch(['--restore']).status, 0)
  assert.equal(state().out.trim(), 'needs-patch')
  assert.ok(verified())
})

test('install patches Claude, signs it and leaves nothing behind', () => {
  const r = patch()
  assert.equal(r.status, 0, r.out)
  assert.equal(state().out.trim(), 'installed')
  assert.ok(verified())
  assert.deepEqual(leftovers(), [])
  assert.ok(existsSync(join(HOME, 'Library/Application Support/ClaudeDoubleSidebar/sidebar.js')))
  assert.equal(readdirSync(join(HOME, 'Library/Fonts')).filter(f => f.endsWith('.ttf')).length, 4)
})

// the loader patch.mjs put at the top of Claude's main process entry, read back out of the copy's app.asar
const loaderLine = () => {
  const buf = readFileSync(join(APP, 'Contents/Resources/app.asar'))
  const header = JSON.parse(buf.subarray(16, 16 + buf.readUInt32LE(12)).toString())
  let n = header
  for (const p of '.vite/build/index.js'.split('/')) n = n.files[p]
  const start = 8 + buf.readUInt32LE(4) + Number(n.offset)
  return buf.subarray(start, start + n.size).toString().split('\n')[0]
}
const DEBUG_FILE = join(HOME, 'Library/Application Support/ClaudeDoubleSidebar/debug-port')

test('the loader is valid JavaScript and reads the debug port setting at launch', () => {
  const line = loaderLine()
  assert.match(line, /^\/\* claude-double-sidebar loader 2 \*\//)
  assert.doesNotThrow(() => new vm.Script(line))
  assert.ok(line.includes(JSON.stringify(DEBUG_FILE)))
  assert.match(line, /remote-debugging-address","127\.0\.0\.1"/)
})

test('a first install leaves the debug port off, and a choice to switch it on or off stays', () => {
  assert.equal(readFileSync(DEBUG_FILE, 'utf8').trim(), 'off')
  assert.equal(patch(['--debug-port', 'on']).status, 0)
  assert.equal(patch().status, 0)
  assert.equal(readFileSync(DEBUG_FILE, 'utf8').trim(), 'on')
  const off = patch(['--debug-port', 'off'])
  assert.equal(off.status, 0, off.out)
  assert.match(off.out, /Debug port: off/)
  assert.equal(patch().status, 0)
  assert.equal(readFileSync(DEBUG_FILE, 'utf8').trim(), 'off')
  assert.equal(patch(['--debug-port', 'on']).status, 0)
  assert.equal(readFileSync(DEBUG_FILE, 'utf8').trim(), 'on')
  assert.equal(patch(['--debug-port', 'maybe']).status, 2)
})

test('the loader opens the debug port only when the setting is on', () => {
  // runs the loader against a stand-in for Electron, as Claude's main process would at launch
  const launch = () => {
    const switches = [], pages = []
    const app = { commandLine: { appendSwitch: (k, v) => switches.push([k, v]) }, on: (_, f) => pages.push(f) }
    const require = m => (m === 'electron' ? { app } : m === 'fs' ? { readFileSync } : null)
    new vm.Script(loaderLine()).runInNewContext({ require, console })
    // a claude.ai page loading: which world the sidebar runs in
    const ran = []
    const wc = { getURL: () => 'https://claude.ai/new', on: (_, f) => f(),
      executeJavaScript: () => (ran.push('page'), Promise.resolve()),
      executeJavaScriptInIsolatedWorld: () => (ran.push('isolated'), Promise.resolve()) }
    pages.forEach(f => f(null, wc))
    return { switches, ran }
  }
  assert.equal(patch(['--debug-port', 'on']).status, 0)
  assert.deepEqual(launch(), { switches: [['remote-debugging-port', '9339'], ['remote-debugging-address', '127.0.0.1']], ran: ['page'] })
  assert.equal(patch(['--debug-port', 'off']).status, 0)
  assert.deepEqual(launch(), { switches: [], ran: ['isolated'] })
  assert.equal(patch(['--debug-port', 'on']).status, 0)
})

test('installing again only replaces the sidebar file', () => {
  const was = snapshot()
  const r = patch()
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /nothing to re-sign/)
  assert.deepEqual(snapshot(), was)
})

test('restore puts back Claude\'s own app.asar', () => {
  const r = patch(['--restore'])
  assert.equal(r.status, 0, r.out)
  assert.equal(state().out.trim(), 'needs-patch')
  assert.equal(sha(join(APP, 'Contents/Resources/app.asar')), sha(join(APP, 'Contents/Resources/app.asar.original')))
  assert.ok(verified())
  assert.deepEqual(leftovers(), [])
})

for (const step of ['sign', 'swap']) {
  test(`a failure at ${step} leaves Claude as it was`, () => {
    const was = snapshot()
    const r = patch([], { DOUBLE_SIDEBAR_FAIL_AT: step })
    assert.equal(r.status, 1, r.out)
    assert.match(r.out, /Claude was left as it was/)
    assert.deepEqual(snapshot(), was)
    assert.equal(state().out.trim(), 'needs-patch')
    assert.ok(verified())
    assert.deepEqual(leftovers(), [])
  })
}

test('a run stopped mid-swap is put back on the next run', () => {
  renameSync(APP, OLD)
  assert.equal(state().status, 2)
  const r = patch()
  assert.equal(r.status, 0, r.out)
  assert.equal(state().out.trim(), 'installed')
  assert.ok(verified())
  assert.deepEqual(leftovers(), [])
})

test('the Claude in Chrome helper running from Claude does not count as Claude being open', async () => {
  assert.equal(patch(['--restore']).status, 0)
  // Chrome starts this host from inside Claude.app and keeps it running after Claude quits
  const host = spawn(join(APP, 'Contents/Helpers/chrome-native-host'), [], { stdio: 'pipe' })
  try {
    await new Promise(r => setTimeout(r, 500))
    assert.equal(host.exitCode, null, 'the helper should still be running')
    const r = patch()
    assert.equal(r.status, 0, r.out)
    assert.equal(state().out.trim(), 'installed')
    assert.deepEqual(agent().notes, [])
  } finally {
    host.kill()
  }
})

test('Claude is signed so either the local certificate or Anthropic satisfies it', () => {
  const req = requirement()
  assert.match(req, new RegExp(`certificate leaf = H"${LEAF}"`))
  assert.match(req, /Q6L2SF6YDW/)
  // Electron's framework inside Claude still carries Anthropic's signature: it passes the same rules,
  // with its own identifier in place of Claude's, the way an update from Anthropic would
  const forElectron = req.replace(/identifier "[^"]+"/, 'identifier "com.github.Electron.framework"')
  assert.equal(spawnSync('codesign', ['--verify', `-R=${forElectron}`, ELECTRON()]).status, 0)
  // and the rules before this change turned it away
  assert.notEqual(spawnSync('codesign', ['--verify', `-R=certificate leaf = H"${LEAF}"`, ELECTRON()]).status, 0)
})

test('an install signed by the earlier rules is patched again', () => {
  execFileSync('codesign', ['--force', '--sign', 'Claude Local', '--preserve-metadata=entitlements',
    `-r=designated => identifier "com.anthropic.claudefordesktop" and certificate leaf = H"${LEAF}"`, APP], { stdio: 'ignore' })
  assert.equal(state().out.trim(), 'needs-patch')
  const r = patch()
  assert.equal(r.status, 0, r.out)
  assert.equal(state().out.trim(), 'installed')
  assert.match(requirement(), /Q6L2SF6YDW/)
})

test('the agent does nothing while Claude is patched', () => {
  const was = snapshot()
  const r = agent()
  assert.equal(r.status, 0, r.out)
  assert.deepEqual(r.notes, [])
  assert.deepEqual(snapshot(), was)
})

test('after an update, the agent waits while Claude is open and says so once', () => {
  assert.equal(patch(['--restore']).status, 0) // stands in for Claude updating
  const first = agent({ DOUBLE_SIDEBAR_FAKE_RUNNING: '1' })
  assert.equal(first.status, 0, first.out)
  assert.equal(first.notes.length, 1)
  assert.match(first.notes[0], /comes back the next time you quit Claude/)
  assert.deepEqual(agent({ DOUBLE_SIDEBAR_FAKE_RUNNING: '1' }).notes, [])
  assert.equal(state().out.trim(), 'needs-patch')
})

test('once Claude is closed, the agent patches it and says so once', () => {
  const r = agent()
  assert.equal(r.status, 0, r.out)
  assert.equal(r.notes.length, 1)
  assert.match(r.notes[0], /Sidebar restored/)
  assert.equal(state().out.trim(), 'installed')
  assert.ok(verified())
  assert.deepEqual(agent().notes, [])
})

const MOD = join(HOME, 'Library/Application Support/claude-double-sidebar-mod')
const RUNTIME = join(MOD, 'runtime')
const LAUNCHER = join(RUNTIME, 'agent.sh')
const AGENT_PLIST = join(HOME, 'Library/LaunchAgents/local.claude-double-sidebar.plist')
const agentEnv = (env = {}) => ({ ...process.env, CLAUDE_APP: APP, DOUBLE_SIDEBAR_HOME: HOME, DOUBLE_SIDEBAR_NOTIFY: 'print',
  DOUBLE_SIDEBAR_NO_LAUNCHD: '1', DOUBLE_SIDEBAR_FAIL_AT: '', DOUBLE_SIDEBAR_FAKE_RUNNING: '', ...env })
// what launchd would run: the launcher in the agent's own copy
const launch = (env = {}) => {
  const r = spawnSync('/bin/sh', [LAUNCHER], { env: agentEnv(env), encoding: 'utf8' })
  return { status: r.status, out: r.stdout + r.stderr, notes: (r.stdout.match(/notify: .*/g) || []).map(l => l.slice(8)) }
}

test('the agent runs from its own copy, so the cloned folder can be deleted', () => {
  // a clone somewhere temporary, set up, then deleted
  const clone = join(dir, 'clone')
  const repo = dirname(PATCH)
  for (const f of ['agent.mjs', 'patch.mjs', 'build.mjs', 'uninstall.sh', 'src', 'vendor']) cpSync(join(repo, f), join(clone, f), { recursive: true })
  const r = spawnSync('node', [join(clone, 'agent.mjs'), '--install'], { env: agentEnv(), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  rmSync(clone, { recursive: true, force: true })

  const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', AGENT_PLIST]).toString())
  assert.deepEqual(plist.ProgramArguments, ['/bin/sh', LAUNCHER])
  // and an uninstaller that doesn't need the clone
  assert.equal(spawnSync('test', ['-x', join(RUNTIME, 'uninstall.sh')]).status, 0)
  assert.equal(realpathSync(readFileSync(join(RUNTIME, 'source'), 'utf8').trim().replace(/\/clone$/, '')), realpathSync(dir))

  // a Claude update while Claude is open: the copy works out what's needed and says so
  assert.equal(patch(['--restore']).status, 0)
  const run = launch({ DOUBLE_SIDEBAR_FAKE_RUNNING: '1' })
  assert.equal(run.status, 0, run.out)
  assert.doesNotMatch(run.out, /Cannot find module|Error/)
  assert.equal(run.notes.length, 1, run.out)
  assert.match(run.notes[0], /comes back the next time you quit Claude/)
  assert.equal(patch().status, 0)
})

test('when its patch fails, the agent leaves Claude as it was and does not retry', () => {
  assert.equal(patch(['--restore']).status, 0)
  const was = snapshot()
  const r = agent({ DOUBLE_SIDEBAR_FAIL_AT: 'sign' })
  assert.equal(r.notes.length, 1)
  assert.match(r.notes[0], /Couldn't put the sidebar back/)
  assert.deepEqual(snapshot(), was)
  const again = agent()
  assert.deepEqual(again.notes, [])
  assert.doesNotMatch(again.out, /Patching/)
  assert.deepEqual(snapshot(), was)
  assert.deepEqual(leftovers(), [])
})

test('the uninstaller works from the installed copy: the agent stops, its files stay until Claude is restored', () => {
  // uninstall.sh's own order, run from the copy, as it would be once the clone is gone
  assert.equal(patch().status, 0)
  writeFileSync(join(HOME, 'Library/Logs/claude-double-sidebar.log'), 'a line\n')
  const stop = spawnSync('node', [join(RUNTIME, 'agent.mjs'), '--remove', '--keep-files'], { env: agentEnv(), encoding: 'utf8' })
  assert.equal(stop.status, 0, stop.stdout + stop.stderr)
  assert.ok(!existsSync(AGENT_PLIST))
  assert.ok(existsSync(join(RUNTIME, 'patch.mjs')))
  const restore = spawnSync('node', [join(RUNTIME, 'patch.mjs'), '--restore'], { env: agentEnv(), encoding: 'utf8' })
  assert.equal(restore.status, 0, restore.stdout + restore.stderr)
  assert.equal(state().out.trim(), 'needs-patch')
  // set up again for the next test, from the copy itself
  const again = spawnSync('node', [join(RUNTIME, 'agent.mjs'), '--install'], { env: agentEnv(), encoding: 'utf8' })
  assert.equal(again.status, 0, again.stdout + again.stderr)
  assert.ok(existsSync(AGENT_PLIST))
})

test('without the agent, the copy still goes in, so the mod can be uninstalled later', () => {
  const r = spawnSync('/bin/sh', ['-c', `node "$1" --remove --keep-files && node "$1" --copy`, 'sh', join(dirname(PATCH), 'agent.mjs')], { env: agentEnv(), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!existsSync(AGENT_PLIST))
  assert.equal(spawnSync('test', ['-x', join(RUNTIME, 'uninstall.sh')]).status, 0)
})

test('a Claude laid out differently is refused before anything changes', () => {
  assert.equal(patch(['--restore']).status, 0)
  execFileSync('/usr/libexec/PlistBuddy',
    ['-c', `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${'0'.repeat(64)}`, join(APP, 'Contents/Info.plist')])
  const was = snapshot()
  const s = state()
  assert.equal(s.status, 2)
  assert.match(s.out, /isn't laid out the way this mod expects/)
  const r = patch()
  assert.equal(r.status, 2, r.out)
  assert.deepEqual(snapshot(), was)
  assert.deepEqual(leftovers(), [])
})

test('the agent leaves a Claude it does not recognise alone and says so once', () => {
  const was = snapshot()
  const r = agent()
  assert.equal(r.notes.length, 1, r.out)
  assert.match(r.notes[0], /laid out in a way this version of the sidebar mod doesn't know/)
  assert.deepEqual(agent().notes, [])
  assert.deepEqual(snapshot(), was)
})

test('if the Node.js the agent was set up with goes missing, it says so once', () => {
  assert.equal(spawnSync('node', [join(dirname(PATCH), 'agent.mjs'), '--install'], { env: agentEnv() }).status, 0)
  const launcher = readFileSync(LAUNCHER, 'utf8')
  writeFileSync(LAUNCHER, launcher.replace(/^NODE=.*$/m, "NODE='/nowhere/node'"))
  const first = launch()
  assert.equal(first.status, 0, first.out)
  assert.equal(first.notes.length, 1, first.out)
  assert.match(first.notes[0], /can't find Node\.js/)
  assert.match(first.notes[0], /Run \.\/install\.sh again/)
  assert.deepEqual(launch().notes, [])
})

test('removing the agent takes out its LaunchAgent, its copy, its settings and its log', () => {
  writeFileSync(join(HOME, 'Library/Logs/claude-double-sidebar.log'), 'a line\n')
  const r = spawnSync('node', [join(RUNTIME, 'agent.mjs'), '--remove'], { env: agentEnv(), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  for (const f of [AGENT_PLIST, RUNTIME, join(MOD, 'agent.json'), join(HOME, 'Library/Logs/claude-double-sidebar.log')])
    assert.ok(!existsSync(f), `${f} should be gone`)
})
