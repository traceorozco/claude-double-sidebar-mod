// dev only: evaluate code in Claude's main page over the local debug port
//   node dev/cdp.mjs <file.js>        run a file
//   node dev/cdp.mjs -e '<expr>'      run an expression
//   add --shot out.png                screenshot the page
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const targets = await (await fetch('http://127.0.0.1:9339/json')).json()
const want = new RegExp(process.env.TARGET || '^https://claude\.ai'); const page = targets.find(t => t.type === 'page' && want.test(t.url))
if (!page) { console.log(JSON.stringify(targets.map(t => [t.type, t.url]), null, 1)); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
let id = 0
const pending = new Map()
ws.onmessage = m => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id) }
const call = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })

const ei = args.indexOf('-e')
const code = ei >= 0 ? args[ei + 1] : args[0] && !args[0].startsWith('--') ? readFileSync(args[0], 'utf8') : null
if (code) {
  const r = await call('Runtime.evaluate', { expression: code, returnByValue: true, awaitPromise: true })
  const v = r.result?.result?.value
  console.log(r.result?.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 800) : typeof v === 'string' ? v : JSON.stringify(v, null, 1))
}
const si = args.indexOf('--shot')
if (si >= 0) {
  const r = await call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(args[si + 1], Buffer.from(r.result.data, 'base64'))
  console.log('shot', args[si + 1])
}
ws.close()
