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
import { mkdtempSync, rmSync, existsSync, readFileSync, renameSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
