// 移动端手势验证：模拟触屏滑动/上滑/下滑/冲刺按钮
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const PAGE = 'http://127.0.0.1:8123/';

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--enable-unsafe-swiftshader',
  '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${path.join(ROOT, '.tmp-profile2')}`, 'about:blank',
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
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
};
const send = (method, params = {}) =>
  new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
// 模拟 iPhone 横屏 + 触摸
await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: PAGE });
await sleep(4500);

console.log('coarse:', await evaluate(`matchMedia('(pointer: coarse)').matches`));
await evaluate(`document.getElementById('startBtn').click()`);
await sleep(1500);
console.log('MODE:', await evaluate(`window.__game.mode`));
console.log('TOUCH-UI:', await evaluate(`JSON.stringify({ui:document.getElementById('touchUI').className,area:document.getElementById('touchArea').className,hint:document.getElementById('gestureHint').className})`));

async function touch(type, x, y) {
  await send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  });
}
async function release(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// 1) 右滑 → 世界 x 应减小（屏幕右 = -x）
const xa = await evaluate(`window.__game.player.pos.x`);
await touch('touchStart', 240, 200);
for (let i = 1; i <= 8; i++) { await touch('touchMove', 240 + i * 10, 200); await sleep(30); }
await sleep(400);
const xb = await evaluate(`window.__game.player.pos.x`);
await release();
await sleep(300);
console.log('SWIPE-RIGHT:', xa.toFixed(2), '->', xb.toFixed(2), xb < xa - 0.5 ? 'OK' : '❌ 没有转向');

// 2) 上滑 → 跳跃
await sleep(300);
const g0 = await evaluate(`window.__game.player.grounded`);
await touch('touchStart', 420, 260);
for (let i = 1; i <= 6; i++) { await touch('touchMove', 420, 260 - i * 14); await sleep(25); }
await release();
await sleep(120);
const jumpState = await evaluate(`JSON.stringify({grounded:window.__game.player.grounded,vy:+window.__game.player.vy.toFixed(1)})`);
console.log('SWIPE-UP:', jumpState, JSON.parse(jumpState).grounded === false ? 'OK（起跳）' : '❌ 没跳');

// 3) 下滑按住 → 滑铲（先等落地；若已死亡则重开）
for (let i = 0; i < 20; i++) {
  const st = await evaluate(`JSON.stringify({m:window.__game.mode,g:window.__game.player.grounded})`);
  const o = JSON.parse(st);
  if (o.m !== 'run') { await evaluate(`document.getElementById('retryBtn').click()`); await sleep(1200); continue; }
  if (o.g) break;
  await sleep(200);
}
console.log('MODE-BEFORE-SLIDE:', await evaluate(`window.__game.mode`), 'grounded:', await evaluate(`window.__game.player.grounded`));
await touch('touchStart', 420, 200);
for (let i = 1; i <= 5; i++) { await touch('touchMove', 420, 200 + i * 14); await sleep(25); }
await sleep(120);
const slideState = await evaluate(`JSON.stringify({sliding:window.__game.player.sliding})`);
await release();
await sleep(200);
console.log('SWIPE-DOWN:', slideState, JSON.parse(slideState).sliding ? 'OK（滑铲）' : '❌ 没滑铲');

// 4) 冲刺按钮（确保在跑动状态）
if ((await evaluate(`window.__game.mode`)) !== 'run') {
  await evaluate(`document.getElementById('retryBtn').click()`);
  await sleep(1200);
}
await evaluate(`window.__game.debug.giveEnergy(100)`);
const rect = await evaluate(`JSON.stringify(document.getElementById('btnDash').getBoundingClientRect())`);
const r = JSON.parse(rect);
await touch('touchStart', Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
await sleep(60);
await release();
await sleep(300);
const od = await evaluate(`+window.__game.odT.toFixed(1)`);
console.log('DASH-BTN:', od, od > 0 ? 'OK（冲刺触发）' : '❌ 没触发');

console.log('FS-BTN:', await evaluate(`!!document.getElementById('fsBtn')`), 'fullscreenEnabled:', await evaluate(`!!document.fullscreenEnabled`));
console.log('JS-ERRORS:', errors.length ? errors.slice(0, 3) : 'none');
ws.close();
chrome.kill();
try { rmSync(path.join(ROOT, '.tmp-profile2'), { recursive: true, force: true }); } catch {}
process.exit(0);
