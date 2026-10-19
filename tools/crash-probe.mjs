// 收集"幽灵碰撞"样本：让自动跑酷 AI 连续跑 N 局，每次 crash 都记录命中现场
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const PAGE = 'http://127.0.0.1:8123/?sim';

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--enable-unsafe-swiftshader',
  '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${path.join(ROOT, '.tmp-profile')}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
  for (let i = 0; i < 50; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = tabs.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no cdp');
}
const ws = new WebSocket(await attach());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;

await send('Runtime.enable');
await send('Page.navigate', { url: PAGE });
await sleep(4000);

for (let run = 0; run < 5; run++) {
  const t0 = Date.now();
  while (Date.now() - t0 < 100000) {
    const mode = await evaluate(`window.__game && window.__game.mode`);
    if (mode === 'over') break;
    await sleep(500);
  }
  const info = await evaluate(`window.__lastCrash ? JSON.stringify(window.__lastCrash) : 'none'`);
  console.log(`run${run}:`, info);
  await evaluate(`window.__lastCrash=null;document.getElementById('retryBtn').click()`);
  await sleep(1200);
}
ws.close();
chrome.kill();
try { try { rmSync(path.join(ROOT, '.tmp-profile'), { recursive: true, force: true }); } catch {} } catch {}
process.exit(0);
