// 加载错误探针：抓 console / 异常
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9355;
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--enable-unsafe-swiftshader',
  '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${path.join(ROOT, '.tmp-probe')}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let url = null;
for (let i = 0; i < 60; i++) {
  try {
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = t.find((x) => x.type === 'page');
    if (p) { url = p.webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(250);
}
const ws = new WebSocket(url);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === 'Runtime.consoleAPICalled') logs.push('console: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++mid; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8123/?auto' });
await sleep(4000);
const r = await send('Runtime.evaluate', { expression: 'typeof window.__game + "|" + !!window.__game', returnByValue: true });
console.log('game:', r.result?.result?.value);
console.log('toast:', (await send('Runtime.evaluate', { expression: 'document.getElementById("toast").textContent', returnByValue: true })).result?.result?.value);
console.log(logs.slice(0, 8).join('\n') || '(no logs)');
ws.close();
chrome.kill();
try { rmSync(path.join(ROOT, '.tmp-probe'), { recursive: true, force: true }); } catch {}
process.exit(0);
