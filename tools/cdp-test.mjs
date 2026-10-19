// CDP 端到端冒烟测试：真实浏览器里跑完整流程
// 前置：先在项目根目录起静态服务器（python -m http.server 8123）
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, '.shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const PAGE = 'http://127.0.0.1:8123/?sim';

mkdirSync(SHOTS, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(ROOT, '.tmp-profile')}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

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
  throw new Error('无法连接 Chrome 调试端口');
}

const wsUrl = await attach();
const ws = new WebSocket(wsUrl);
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
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push(msg.params.entry.text);
  }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  return r.result?.result?.value;
}
async function shot(name) {
  const data = await evaluate(
    `(()=>{const c=document.getElementById('scene');return c?c.toDataURL('image/png'):''})()`
  );
  if (data) {
    writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    console.log('SHOT:', name);
  }
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: PAGE });
await sleep(5000);

console.log('MODE:', await evaluate(`window.__game && window.__game.mode`));
const d1 = await evaluate(`window.__game ? window.__game.dist : -1`);
console.log('DIST@6s:', d1);
await shot('run1');

await sleep(6000);
const d2 = await evaluate(`window.__game ? window.__game.dist : -1`);
console.log('DIST@12s:', d2);
await shot('run2');

// 强制撞墙 → 结算
await evaluate(`window.__game.player.die('crash')`);
await sleep(2500);
console.log('MODE-AFTER-DIE:', await evaluate(`window.__game.mode`));
await shot('over');

// 重开
await evaluate(`document.getElementById('retryBtn').click()`);
await sleep(1500);
const modeRetry = await evaluate(`window.__game.mode`);
console.log('MODE-RETRY:', modeRetry);
await shot('retry');

// 焦点修复验证：点击按钮后不应有按钮保持焦点（否则空格 keyup 会再次触发按钮）
const focusEl = await evaluate(
  `document.activeElement && document.activeElement.tagName + '#' + (document.activeElement.id || '?')`
);
console.log('FOCUS-AFTER-CLICK:', focusEl || 'none/body', focusEl === 'BUTTON#retryBtn' ? '❌ 未移除焦点' : 'OK');

// 过载冷却验证：给满能量 → 冲刺；冲刺结束后仍有冷却，不能立刻再放
await evaluate(`window.__game.debug.giveEnergy(100)`);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'ShiftLeft'}))`);
await sleep(300);
const od1 = await evaluate(`JSON.stringify({odT:+window.__game.odT.toFixed(1),odCd:+window.__game.odCd.toFixed(1)})`);
await sleep(4200); // 等冲刺 4s 结束
await evaluate(`window.__game.debug.giveEnergy(100)`);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'ShiftLeft'}))`);
await sleep(200);
const od2 = await evaluate(`JSON.stringify({odT:+window.__game.odT.toFixed(1),odCd:+window.__game.odCd.toFixed(1)})`);
console.log('OD-CAST:', od1, ' AFTER-4.2s-RECAST:', od2, JSON.parse(od2).odT === 0 ? 'OK（冷却中禁止再放）' : '❌ 仍可连放');

// 滑翔验证：过载期间把玩家悬在缺口上空 → 应回升到巡航高度而不是坠落
// （先重开一局清掉上一段测试留下的冷却）
await evaluate(`document.getElementById('retryBtn').click()`);
await sleep(1200);
await evaluate(`window.__game.debug.giveEnergy(100)`);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'ShiftLeft'}))`);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'ShiftLeft'}))`);
await sleep(200);
const odCast = await evaluate(`JSON.stringify({odT:+window.__game.odT.toFixed(1),odCd:+window.__game.odCd.toFixed(1)})`);
await evaluate(
  `(()=>{const g=window.__game,p=g.player;p.pos.set(0,9.0,46);p.prevY=9;p.vy=-3;p.grounded=false;p.vx=0;p.lastGroundY=10;return 1})()`
);
await sleep(900);
const glideState = await evaluate(
  `(()=>{const g=window.__game,p=g.player;return JSON.stringify({y:+p.pos.y.toFixed(2),alive:p.alive,odT:+g.odT.toFixed(1)})})()`
);
console.log('OD-CAST@GLIDE:', odCast);
console.log('GLIDE-TEST:', glideState, JSON.parse(glideState).alive && JSON.parse(glideState).y > 9.5 ? 'OK（滑翔越过缺口）' : '❌ 坠落或未爬升');
await evaluate(`document.getElementById('retryBtn').click()`);
await sleep(1000);

// 坠楼吸附验证：把玩家放到平台下方下坠，不应被吸回楼顶
const fallRes = await evaluate(
  `(()=>{const g=window.__game,p=g.player;
    p.pos.set(0, 6, 5); p.prevY=6; p.vy=-2; p.grounded=false; p.vx=0; p.lastGroundY=10;
    return 1})()`
);
await sleep(500);
const fallState = await evaluate(
  `(()=>{const g=window.__game,p=g.player;return JSON.stringify({y:+p.pos.y.toFixed(1),grounded:p.grounded,alive:p.alive,type:p.deathType})})()`
);
console.log('FALL-TEST:', fallState, JSON.parse(fallState).y < 9 ? 'OK（未被吸回楼顶）' : '❌ 被吸回楼顶');

// 方向键测试（先重开，因为坠楼测试后角色已死亡）：D 应该是屏幕右 = 世界 -x
await evaluate(`document.getElementById('retryBtn').click()`);
await sleep(1200);
const x0 = await evaluate(`window.__game.player.pos.x`);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD'}))`);
await sleep(700);
const x1 = await evaluate(`window.__game.player.pos.x`);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyD'}))`);
await sleep(300);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA'}))`);
await sleep(700);
const x2 = await evaluate(`window.__game.player.pos.x`);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyA'}))`);
console.log('AXIS: x0=', x0.toFixed(2), 'afterD=', x1.toFixed(2), 'afterA=', x2.toFixed(2), x1 < x0 && x2 > x1 ? 'OK' : 'REVERSED ❌');
const axisOK = x1 < x0 && x2 > x1;
const focusOK = focusEl !== 'BUTTON#retryBtn';
const odOK = JSON.parse(od1).odT > 0 && JSON.parse(od2).odT === 0;
const fallOK = JSON.parse(fallState).y < 9;
const glideOK = JSON.parse(glideState).alive && JSON.parse(glideState).y > 9.5;

// 坠楼死亡后重开，再进入回正测试
await evaluate(`document.getElementById('retryBtn').click()`);
await sleep(1200);

// 原点回正测试：先按真实节奏把世界流式生成到 1320，再站到 1200 之后的一个真实平台上触发 rebase
await evaluate(`(()=>{const g=window.__game;for(let z=0;z<1320;z+=40)g.city.update(z);return 1})()`);
await sleep(300);
await evaluate(
  `(()=>{const g=window.__game;
    const segs=g.city.segments.filter(s=>s.z0>1200&&s.z1>s.z0);
    const s=segs[Math.floor(segs.length/2)]||g.city.segments[g.city.segments.length-1];
    g.player.pos.set(s.cx, s.y, (s.z0+s.z1)/2);g.player.grounded=true;g.player.vy=0;
    return 1})()`
);
await sleep(500);
const afterRebase = await evaluate(
  `(()=>{const g=window.__game,p=g.player;return JSON.stringify({z:+p.pos.z.toFixed(1),dist:Math.round(g.dist),mode:g.mode,
    onPlat:!!g.city.platformAt(p.pos.x,p.pos.z),ahead:!!g.city.platformAt(p.pos.x,p.pos.z+40),nextZ:Math.round(g.city.nextZ)})})()`
);
console.log('AFTER-REBASE:', afterRebase);
const dBefore = await evaluate(`window.__game.dist`);
await sleep(4000);
const dAfter = await evaluate(`window.__game.dist`);
const modeRebase = await evaluate(`window.__game.mode`);
const zNow = await evaluate(`+window.__game.player.pos.z.toFixed(1)`);
console.log('DIST-POST:', Math.round(dBefore), '->', Math.round(dAfter), 'z=', zNow, 'mode=', modeRebase, 'death=', await evaluate(`window.__game.player.deathType`));
await shot('rebase');

console.log('JS-ERRORS:', errors.length ? errors.slice(0, 5) : 'none');
// 回正后不强制要求 AI 仍然存活（自动跑酷有随机性），只要求距离持续增长
const pass =
  d2 > d1 &&
  modeRetry === 'run' &&
  dAfter > dBefore &&
  axisOK &&
  focusOK &&
  odOK &&
  fallOK &&
  glideOK &&
  errors.length === 0;
console.log(
  pass ? 'ALL PASS ✅' : 'FAILED ❌',
  JSON.stringify({ d2gt: d2 > d1, retry: modeRetry === 'run', distPost: dAfter > dBefore, axisOK, focusOK, odOK, fallOK, glideOK, noErr: errors.length === 0 })
);

ws.close();
chrome.kill();
rmSync(path.join(ROOT, '.tmp-profile'), { recursive: true, force: true });
process.exit(pass ? 0 : 1);
