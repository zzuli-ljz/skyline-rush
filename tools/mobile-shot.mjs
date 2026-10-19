// 移动端截图（iPhone 横屏模拟）
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9335;
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--enable-unsafe-swiftshader',
  '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${path.join(ROOT, '.tmp-profile3')}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page = null;
for (let i = 0; i < 50; i++) {
  try {
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = t.find((x) => x.type === 'page');
    if (page) break;
  } catch {}
  await sleep(250);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
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
await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: 'http://127.0.0.1:8123/' });
await sleep(5500);
await send('Runtime.evaluate', { expression: `document.getElementById('startBtn').click()` });
await sleep(2500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(path.join(ROOT, '.shot-mobile.png'), Buffer.from(shot.result.data, 'base64'));
console.log('shot ok');
ws.close();
chrome.kill();
try { rmSync(path.join(ROOT, '.tmp-profile3'), { recursive: true, force: true }); } catch {}
process.exit(0);
