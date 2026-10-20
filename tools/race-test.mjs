// 竞速模式端到端测试：倒计时 → 起跑 → 撞击减速 → 掉落复活 → 终点结算
// 前置：python -m http.server 8123（项目根目录）
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, '.shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9351;
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
    '--window-size=1600,900',
    `--user-data-dir=${path.join(ROOT, '.tmp-race')}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
  for (let i = 0; i < 60; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = tabs.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('无法连接 Chrome 调试端口');
}

const ws = new WebSocket(await attach());
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let msgId = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: PAGE });

async function shot(name) {
  const d = await evaluate(`(()=>{const c=document.getElementById('scene');return c?c.toDataURL('image/png'):''})()`);
  if (d) writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(d.split(',')[1], 'base64'));
  return !!d;
}

const out = {};

// 1) 等倒计时结束
await sleep(1600);
out.countdown = await evaluate(`JSON.stringify({s:window.__game?.raceState, cd:document.getElementById('countdown').textContent})`);
await sleep(2600);
out.started = await evaluate(
  `JSON.stringify({s:window.__game.raceState, mode:window.__game.mode, ghosts:window.__game.race.opponents.length, place:window.__game.race.place})`
);
await sleep(1500);
out.running = await evaluate(
  `JSON.stringify({z:+window.__game.player.pos.z.toFixed(1), place:window.__game.race.place,
    board:document.getElementById('raceBoard').classList.contains('on'),
    rows:document.querySelectorAll('#raceBoard .race-row').length})`
);
await shot('race-1-start');

// 2) 撞障碍：应当减速、不死
out.crash = await evaluate(`(()=>{
  const g=window.__game,p=g.player;
  // 找一个前方的空调机组，直接放到它面前
  let target=null;
  for(const s of g.city.segments) for(const o of s.obstacles){
    if(o.z0>p.pos.z+4 && (!target||o.z0<target.z0)) target=o;
  }
  if(!target) return JSON.stringify({err:'no-obstacle'});
  p.pos.set((target.x0+target.x1)/2, target.y0, target.z0-0.9);
  p.prevY=p.pos.y; p.vy=0; p.vx=0; p.grounded=true; p.invulnT=0;
  return JSON.stringify({kind:target.kind, z:+target.z0.toFixed(1)});
})()`);
await sleep(420);
out.crashAfter = await evaluate(
  `JSON.stringify({alive:window.__game.player.alive, speedMul:+window.__game.player.speedMul.toFixed(2),
    mode:window.__game.mode, invuln:+window.__game.player.invulnT.toFixed(2)})`
);
await shot('race-2-hit');

// 3) 掉落：应当被拉回楼顶、不死
out.fall = await evaluate(`(()=>{
  const g=window.__game,p=g.player;
  const seg=g.city.platformAt(p.pos.x,p.pos.z);
  p.pos.y = (seg?seg.y:p.lastGroundY) - 11; p.prevY=p.pos.y+0.1; p.vy=-6; p.grounded=false;
  return JSON.stringify({y:+p.pos.y.toFixed(1)});
})()`);
await sleep(450);
out.fallAfter = await evaluate(
  `JSON.stringify({alive:window.__game.player.alive, y:+window.__game.player.pos.y.toFixed(2),
    speedMul:+window.__game.player.speedMul.toFixed(2), mode:window.__game.mode,
    z:+window.__game.player.pos.z.toFixed(1)})`
);

// 4) 终点：直接推到终点线前
out.finish = await evaluate(`(()=>{
  const g=window.__game,p=g.player;
  p.pos.z = g.RACE_LEN - 2; p.prevY=p.pos.y;
  return JSON.stringify({z:+p.pos.z.toFixed(0), len:g.RACE_LEN});
})()`);
await sleep(900);
out.finished = await evaluate(
  `JSON.stringify({mode:window.__game.mode, state:window.__game.raceState,
    label:document.getElementById('deathLabel').textContent,
    cells:[...document.querySelectorAll('.final-cell b')].map(e=>e.textContent.trim())})`
);
await shot('race-3-result');

out.errors = errors.slice(0, 5);
console.log(JSON.stringify(out, null, 1));

const C = JSON.parse(out.crashAfter || '{}');
const F = JSON.parse(out.fallAfter || '{}');
const R = JSON.parse(out.finished || '{}');
const S = JSON.parse(out.started || '{}');
const pass =
  S.ghosts === 2 &&
  C.alive === true &&
  C.speedMul < 0.6 &&
  F.alive === true &&
  R.mode === 'over' &&
  R.cells?.[0]?.includes('/') &&
  errors.length === 0;
console.log(pass ? 'RACE PASS ✅' : 'RACE FAILED ❌');

ws.close();
chrome.kill();
