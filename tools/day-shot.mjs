// 日光推进档位截图：0 / 400 / 800 / 1200m（直接读 canvas，避免 headless 黑帧）
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9350;
const DIR = path.join(ROOT, '.shots');
mkdirSync(DIR, { recursive: true });

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--enable-unsafe-swiftshader',
  '--no-sandbox', '--hide-scrollbars', '--window-size=1600,900',
  `--user-data-dir=${path.join(ROOT, '.tmp-dayshot')}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
  for (let i = 0; i < 60; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = t.find((x) => x.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome not ready');
}

const ws = new WebSocket(await attach());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++mid; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8123/?auto' });
await sleep(3500);

const snap = async (dist, name) => {
  const r = await send('Runtime.evaluate', {
    expression: `(async()=>{const g=window.__game;
      if(!g) return '';
      g.debug.setDist(${dist});
      await new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(res)));
      return document.getElementById('scene').toDataURL('image/png');})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const data = r.result?.result?.value;
  if (!data) { console.log(name, 'EMPTY'); return; }
  writeFileSync(path.join(DIR, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
  const info = await send('Runtime.evaluate', {
    expression: `JSON.stringify({phase:window.__game.daylight.phase,fog:window.__game.debug&&1,
      sunY:+window.__game.player.pos.y.toFixed(1),mode:window.__game.mode})`,
    returnByValue: true,
  });
  console.log(name, data.length, info.result?.result?.value);
};

await snap(0, 'day-0-dusk');
await snap(400, 'day-1-low');
await snap(800, 'day-2-after');
await snap(1200, 'day-3-blue');

ws.close();
chrome.kill();
try { rmSync(path.join(ROOT, '.tmp-dayshot'), { recursive: true, force: true }); } catch {}
process.exit(0);
