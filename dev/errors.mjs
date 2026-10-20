// dev only: print errors and console messages from Claude's page for a few seconds
const targets = await (await fetch('http://127.0.0.1:9339/json')).json()
const page = targets.find(t => t.type === 'page' && /^https:\/\/claude\.ai/.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
let id = 0
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }))
ws.onmessage = m => {
  const d = JSON.parse(m.data)
  if (d.method === 'Runtime.exceptionThrown') console.log('EXCEPTION', d.params.exceptionDetails.exception?.description?.slice(0, 400) || d.params.exceptionDetails.text)
  if (d.method === 'Runtime.consoleAPICalled' && /error|warn/.test(d.params.type)) console.log(d.params.type.toUpperCase(), JSON.stringify(d.params.args.map(a => a.value ?? a.description)).slice(0, 300))
}
send('Runtime.enable')
send('Runtime.evaluate', { expression: 'document.body.append(document.createElement("i")); document.querySelector("body > i:last-child").remove()' })
await new Promise(r => setTimeout(r, Number(process.argv[2] || 3000)))
ws.close()
