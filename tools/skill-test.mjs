// 技能盲盒端到端测试：拾取 → 自用生效 → 攻击技能选目标 → 护盾抵消撞击
// 前置：python -m http.server 8123（项目根目录）
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9355;
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
    `--user-data-dir=${path.join(ROOT, '.tmp-skill')}`,
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

let ready = false;
for (let i = 0; i < 40; i++) {
  await sleep(400);
  ready = (await evaluate(`typeof window.__game === 'object'`)) === true;
  if (ready) break;
}
if (!ready) {
  console.log('PAGE FAILED ❌');
  ws.close();
  chrome.kill();
  process.exit(1);
}
await sleep(4400); // 倒计时结束

const out = {};

// 1) 盲盒在赛道上可见 + 数量正确
out.boxes = await evaluate(`JSON.stringify({
  total: window.__game.powerups.boxes.length,
  visible: window.__game.powerups.boxes.filter(b=>b.mesh.visible).length,
  firstZ: window.__game.powerups.boxes[0].z,
  skill: window.__game.powerups.boxes[0].skill
})`);

// 2) 传送到第 1 个盲盒上，验证被拾取并生效
out.pick = await evaluate(`(()=>{
  const g = window.__game;
  const b = g.powerups.boxes[0];
  const before = g.powerups.boxes.filter(x=>!x.taken).length;
  g.debug.toBox(0);
  return JSON.stringify({ before, skill: b.skill, self: ['gale','shield','magnet'].includes(b.skill) });
})()`);
await sleep(420);
out.pickAfter = await evaluate(`JSON.stringify({
  taken: window.__game.powerups.boxes[0].taken,
  atkSkill: window.__game.atkSkill,
  buffUpT: +window.__game.player.buffUpT.toFixed(1),
  shieldT: +window.__game.player.shieldT.toFixed(1),
  magnetT: +window.__game.player.magnetT.toFixed(1),
  slotOn: document.getElementById('skillBar').classList.contains('on')
})`);

// 3) 逐个技能：自用效果 / 攻击进槽
const self = {};
for (const k of ['gale', 'shield', 'magnet']) {
  await evaluate(`window.__game.debug.giveSkill('${k}')`);
  await sleep(60);
  self[k] = await evaluate(
    `JSON.stringify({up:+window.__game.player.buffUp.toFixed(2), shield:+window.__game.player.shieldT.toFixed(1),
      magnet:+window.__game.player.magnetT.toFixed(1)})`
  );
}
out.self = self;

// 4) 攻击技能：进槽 → 按名次释放 → 目标减速
await evaluate(`window.__game.debug.giveSkill('headwind')`);
await sleep(80);
out.slot = await evaluate(
  `JSON.stringify({atk:window.__game.atkSkill, on:document.getElementById('skillBar').classList.contains('on'),
    text:document.getElementById('skillBar').textContent.trim()})`
);
out.cast = await evaluate(`(()=>{
  const g = window.__game;
  const rows = g.race.rows(g.player.pos.z);
  const target = rows.find(r=>!r.me);
  window.__game.debug.cast(target.place);
  const o = g.race.opponents.find(x=>x.id===target.id) || g.race.opponents.find(x=>x.name===target.name);
  return JSON.stringify({place:target.place, name:o&&o.name, slowT:o?+o.slowT.toFixed(1):null,
    consumed:g.atkSkill===null, slotOn:document.getElementById('skillBar').classList.contains('on')});
})()`);

// 5) 护盾：抵消一次撞击（不该掉速）
out.shieldHit = await evaluate(`(()=>{
  const g = window.__game, p = g.player;
  g.debug.giveSkill('shield');
  p.invulnT = 0; p.speedMul = 1; p.speedMulT = 0;
  p.hit({ kind: 'wall' });
  return JSON.stringify({shieldT:+p.shieldT.toFixed(1), speedMul:p.speedMul, invuln:+p.invulnT.toFixed(2)});
})()`);

// 6) 被命中：逆风 / 断电 / 锁跳
const hit = {};
for (const k of ['headwind', 'blackout', 'lockjump']) {
  await evaluate(`window.__game.debug.hitBy('${k}','测试')`);
  await sleep(60);
  hit[k] = await evaluate(
    `JSON.stringify({down:+window.__game.player.buffDown.toFixed(2), downT:+window.__game.player.buffDownT.toFixed(1),
      noJump:+window.__game.player.noJumpT.toFixed(1), noFuel:+window.__game.player.noFuelT.toFixed(1),
      blackout:document.getElementById('blackout').style.opacity})`
  );
}
out.hit = hit;

// 7) 锁跳真的跳不起来
out.lockJump = await evaluate(`(()=>{
  const g = window.__game, p = g.player;
  p.noJumpT = 4; p.grounded = true; p.vy = 0; p.coyote = 0.2; p.jumpBuf = 0;
  const y0 = p.pos.y;
  p.jumpBuf = 0.14;
  p.update(0.016, {axis:0, slideHeld:false}, g.city, 12, {jump:false, dash:false}, false);
  return JSON.stringify({vy:+p.vy.toFixed(2), rose: p.vy > 1});
})()`);

out.errors = errors.slice(0, 4);
console.log(JSON.stringify(out, null, 1));

const J = (v) => (typeof v === 'string' ? JSON.parse(v) : v || {});
const B = J(out.boxes);
const P = J(out.pickAfter);
const S = J(out.self);
const SL = J(out.slot);
const C = J(out.cast);
const SH = J(out.shieldHit);
const H = J(out.hit);
const L = J(out.lockJump);

const pass =
  B.total === 11 &&
  P.taken === true &&
  (P.atkSkill !== null || P.buffUpT > 0 || P.shieldT > 0 || P.magnetT > 0) &&
  J(S.gale).up > 1.2 &&
  J(S.shield).shield > 0 &&
  J(S.magnet).magnet > 0 &&
  SL.atk === 'headwind' &&
  SL.on === true &&
  C.slowT > 0 &&
  C.consumed === true &&
  C.slotOn === false &&
  SH.speedMul === 1 &&
  SH.shieldT <= 0 &&
  J(H.headwind).down < 1 &&
  J(H.blackout).noFuel > 0 &&
  J(H.lockjump).noJump > 0 &&
  L.rose === false &&
  errors.length === 0;

console.log(pass ? 'SKILL PASS ✅' : 'SKILL FAILED ❌');
ws.close();
chrome.kill();
