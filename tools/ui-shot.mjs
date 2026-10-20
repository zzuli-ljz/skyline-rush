// UI 截图：盲盒外观 / 技能槽 / 联机大厅（DOM + canvas 一起截）
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, '.shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9362;
const PAGE = 'http://127.0.0.1:8123/?race';
mkdirSync(SHOTS, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    '--window-size=1600,900',
    `--user-data-dir=${path.join(ROOT, '.tmp-uishot')}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let url = null;
for (let i = 0; i < 60; i++) {
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = tabs.find((t) => t.type === 'page');
    if (page) {
      url = page.webSocketDebuggerUrl;
      break;
    }
  } catch {}
  await sleep(250);
}
const ws = new WebSocket(url);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const pend = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m);
    pend.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: PAGE });
for (let i = 0; i < 40; i++) {
  await sleep(400);
  if ((await evaluate(`typeof window.__game === 'object'`)) === true) break;
}
await sleep(4400);

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64'));
}

// 1) 站在盲盒前看外观
await evaluate(`(()=>{
  const g = window.__game, b = g.powerups.boxes[0];
  g.debug.toBox(0);
  g.player.pos.z = b.z - 7;
  g.player.prevY = g.player.pos.y;
})()`);
await sleep(600);
await shot('ui-box');

// 2) 攻击技能槽
await evaluate(`window.__game.debug.giveSkill('headwind')`);
await sleep(500);
await shot('ui-skill');

// 3) buff 条 + 断电遮罩
await evaluate(`(()=>{window.__game.debug.giveSkill('shield');window.__game.debug.giveSkill('magnet');window.__game.debug.hitBy('headwind','霓虹');})()`);
await sleep(500);
await shot('ui-buffs');
await evaluate(`window.__game.debug.hitBy('blackout','赤风')`);
await sleep(600);
await shot('ui-blackout');

// 4) 联机大厅
await evaluate(`(()=>{document.getElementById('homeBtn').click();})()`);
await sleep(500);
await evaluate(`document.getElementById('onlineBtn').click()`);
await sleep(600);
await shot('ui-lobby');

console.log('shots done');
ws.close();
chrome.kill();
