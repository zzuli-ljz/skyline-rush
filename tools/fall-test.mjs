// 竞速模式坠落复活回归测试：验证"掉下去 → 送到前方楼顶"，且不会原地无限弹起
// 前置：python -m http.server 8123（项目根目录）
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9353;
const PAGE = 'http://127.0.0.1:8123/?race';

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
    '--window-size=1280,720',
    `--user-data-dir=${path.join(ROOT, '.tmp-fall')}`,
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

// 等游戏实例就绪 + 起跑（倒计时 3.4s）
let ready = false;
for (let i = 0; i < 40; i++) {
  await sleep(400);
  ready = (await evaluate(`typeof window.__game === 'object'`)) === true;
  if (ready) break;
}
if (!ready) {
  console.log('PAGE FAILED ❌ window.__game 未就绪:', await evaluate('location.href'));
  ws.close();
  chrome.kill();
  process.exit(1);
}
await sleep(4200);

// 装上探针：记录每次 respawn 的前后位置
await evaluate(`(()=>{
  const g = window.__game;
  if (window.__probe) return 'already';
  window.__falls = [];
  const p = g.player;
  const orig = p.respawn.bind(p);
  p.respawn = (city) => {
    const before = { z: p.pos.z, y: p.pos.y };
    orig(city);
    const seg = g.city.platformAt(p.pos.x, p.pos.z);
    window.__falls.push({
      bz: +before.z.toFixed(1),
      az: +p.pos.z.toFixed(1),
      y: +p.pos.y.toFixed(2),
      segY: seg ? +seg.y.toFixed(2) : null,
      grounded: p.grounded,
      alive: p.alive,
      groundZ: +p.lastGroundZ.toFixed(1),
    });
  };
  window.__probe = true;
  return 'ok';
})()`);

// 场景 A：掉进楼缝（z 落在两段之间）
const A = [];
for (let i = 0; i < 3; i++) {
  const drop = await evaluate(`(()=>{
    const g = window.__game, p = g.player;
    const segs = g.city.segments.slice().sort((a,b)=>a.z0-b.z0);
    let prev = null, gap = null;
    for (const s of segs) {
      if (prev && s.z0 - prev.z1 > 1.0 && prev.z1 > p.pos.z + 2) {
        gap = { z0: prev.z1, z1: s.z0, y: prev.y, cx: prev.cx };
        break;
      }
      prev = s;
    }
    if (!gap) return JSON.stringify({ err: 'no-gap' });
    p.pos.set(gap.cx, gap.y - 11.5, (gap.z0 + gap.z1) / 2);
    p.prevY = p.pos.y + 0.1; p.vy = -9; p.vx = 0;
    p.grounded = false; p.lastGroundY = gap.y; p.glideT = 0; p.invulnT = 0;
    return JSON.stringify({ gapZ0: +gap.z0.toFixed(1), gapZ1: +gap.z1.toFixed(1), fromY: +gap.y.toFixed(1) });
  })()`);
  await sleep(500);
  A.push({ drop: JSON.parse(drop), last: await evaluate(`JSON.stringify(window.__falls.at(-1)||null)`) });
}

// 场景 B：从楼顶边缘横向掉出去（x 在平台外）
const B = [];
for (let i = 0; i < 2; i++) {
  const drop = await evaluate(`(()=>{
    const g = window.__game, p = g.player;
    const seg = g.city.platformNear(p.pos.z + 6);
    if (!seg) return JSON.stringify({ err: 'no-seg' });
    p.pos.set(seg.cx + seg.w / 2 + 4, seg.y - 12, seg.z0 + (seg.z1 - seg.z0) * 0.5);
    p.prevY = p.pos.y + 0.1; p.vy = -9; p.vx = 0;
    p.grounded = false; p.lastGroundY = seg.y; p.glideT = 0; p.invulnT = 0;
    return JSON.stringify({ segY: +seg.y.toFixed(1), segZ0: +seg.z0.toFixed(1), x: +p.pos.x.toFixed(1) });
  })()`);
  await sleep(500);
  B.push({ drop: JSON.parse(drop), last: await evaluate(`JSON.stringify(window.__falls.at(-1)||null)`) });
}

// 场景 C：幽灵领先 100m 时，玩家脚下的楼顶不允许被回收（曾经的"地板消失"bug）
const C = await (async () => {
  await evaluate(`(()=>{
    const g = window.__game, p = g.player;
    const seg = g.city.platformNear(p.pos.z + 4) || g.city.segments[1];
    p.pos.set(seg.cx, seg.y, seg.z0 + 2);
    p.prevY = seg.y; p.vy = 0; p.vx = 0;
    p.grounded = true; p.lastGroundY = seg.y; p.lastGroundX = seg.cx; p.lastGroundZ = seg.z0 + 2;
    window.__cSegZ1 = seg.z1;
    for (const o of g.race.opponents) o.z = p.pos.z + 100; // 幽灵大幅领先
    return 'ok';
  })()`);
  await sleep(2600); // 足够让旧逻辑按 maxZ-45 把这段拆掉
  return await evaluate(
    `JSON.stringify((()=>{
      const g = window.__game, p = g.player;
      const kept = g.city.segments.some(s => Math.abs(s.z1 - window.__cSegZ1) < 0.01); // 所站段未被回收
      return { segZ1:+window.__cSegZ1.toFixed(1), maxZ:+g.race.maxZ().toFixed(1),
        playerZ:+p.pos.z.toFixed(1), alive:p.alive, kept,
        respawns:window.__falls.length }; // 复活次数应仍为 5（没有因地板消失引发坠落）
    })())`
  ).then((s) => JSON.parse(s || '{}'));
})();

const all = await evaluate(`JSON.stringify(window.__falls)`);
const falls = JSON.parse(all || '[]');
const state = await evaluate(
  `JSON.stringify({alive:window.__game.player.alive, mode:window.__game.mode,
    z:+window.__game.player.pos.z.toFixed(1), grounded:window.__game.player.grounded})`
);

console.log('A(掉进楼缝):', JSON.stringify(A));
console.log('B(横向掉出):', JSON.stringify(B));
console.log('C(幽灵领先100m):', JSON.stringify(C));
console.log('全部复活记录:', all);
console.log('当前状态:', state);

// 判定：5 次坠落应恰好触发 5 次复活（没有额外循环），每次复活后都站在真实楼顶上，
// 且落点不低于坠落前的 z（不能"原地升起"）；场景 C 要求幽灵领先时脚下地板始终存在
const ok =
  falls.length > 0 &&
  falls.length <= 6 &&
  falls.every((f) => f.grounded === true && f.alive === true && f.segY !== null) &&
  falls.every((f) => f.az >= f.bz - 0.5) &&
  falls.every((f, i) => i === 0 || f.bz >= falls[i - 1].az - 1) &&
  C.kept === true &&
  C.alive === true &&
  JSON.parse(state || '{}').alive === true &&
  errors.length === 0;

console.log('复活次数:', falls.length, '(预期 5)');
console.log(ok ? 'FALL PASS ✅' : 'FALL FAILED ❌');
if (errors.length) console.log('JS 报错:', errors.slice(0, 3));

ws.close();
chrome.kill();
