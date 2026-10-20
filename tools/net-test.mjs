// 联机端到端测试：建房 → 加入 → 同步开局 → 位置同步 → 技能跨端命中 → 断线转 AI
// 前置：python -m http.server 8123（项目根目录）
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'http://127.0.0.1:8123/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(port, name) {
  return spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      '--headless=new',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--hide-scrollbars',
      '--no-proxy-server',
      '--proxy-bypass-list=*',
      '--window-size=1280,720',
      `--user-data-dir=${path.join(ROOT, '.tmp-net-' + name)}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
}

async function connect(port) {
  let url = null;
  for (let i = 0; i < 60; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = tabs.find((t) => t.type === 'page');
      if (page) {
        url = page.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(250);
  }
  if (!url) throw new Error('无法连接调试端口 ' + port);
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pend = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m);
      pend.delete(m.id);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
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
  return { ws, send, evaluate, errors };
}

const chromeA = launch(9357, 'a');
const chromeB = launch(9358, 'b');
const A = await connect(9357);
const B = await connect(9358);

for (const P of [A, B]) {
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if ((await P.evaluate(`typeof window.__game === 'object'`)) === true) break;
  }
}

const out = {};

// 1) A 建房
await A.evaluate(`document.getElementById('onlineBtn').click()`);
await A.evaluate(`document.getElementById('nameInput').value='甲';document.getElementById('createRoomBtn').click()`);
let code = null;
for (let i = 0; i < 50; i++) {
  await sleep(600);
  code = await A.evaluate(`window.__game.net && window.__game.net.code | ''`);
  const cur = await A.evaluate(`window.__game.net ? window.__game.net.code : ''`);
  if (cur) {
    code = cur;
    break;
  }
}
out.code = code;
out.statusA = await A.evaluate(`document.getElementById('lobbyStatus').textContent`);
out.netA = await A.evaluate(`JSON.stringify({has: !!window.__game.net, ready: window.__game.net && window.__game.net.ready})`);

// 2) B 加入
if (code) {
  await B.evaluate(`document.getElementById('onlineBtn').click()`);
  await B.evaluate(
    `document.getElementById('nameInput').value='乙';document.getElementById('codeInput').value='${code}';document.getElementById('joinRoomBtn').click()`
  );
  let joined = false;
  for (let i = 0; i < 50; i++) {
    await sleep(500);
    joined = (await B.evaluate(`!!(window.__game.net && window.__game.net.players.length >= 2)`)) === true;
    if (joined) break;
  }
  out.joined = joined;
  await sleep(800);
  out.rosterA = await A.evaluate(`JSON.stringify((window.__game.net||{players:[]}).players.map(p=>p.name))`);
  out.rosterB = await B.evaluate(`JSON.stringify((window.__game.net||{players:[]}).players.map(p=>p.name))`);
}

// 3) 开局
if (out.joined) {
  await A.evaluate(`document.getElementById('roomStartBtn').click()`);
  await sleep(900);
  out.startA = await A.evaluate(`JSON.stringify({mode:window.__game.mode, state:window.__game.raceState,
    opponents:window.__game.race.opponents.length, remote:window.__game.race.opponents.map(o=>o.remote)})`);
  out.startB = await B.evaluate(`JSON.stringify({mode:window.__game.mode, state:window.__game.raceState,
    opponents:window.__game.race.opponents.length})`);

  // 等倒计时结束
  await sleep(3600);

  // 4) 位置同步：B 往前瞬移，A 应看到对应幽灵跟过来
  await B.evaluate(`(()=>{const g=window.__game;g.player.pos.z=80;g.player.prevY=g.player.pos.y;})()`);
  await sleep(1400);
  out.sync = await A.evaluate(`JSON.stringify((window.__game.race.opponents||[]).map(o=>({name:o.name, z:+o.z.toFixed(1), remote:o.remote})))`);

  // 5) 跨端技能：B 对 A 释放逆风
  await B.evaluate(`window.__game.debug.giveSkill('headwind')`);
  await sleep(200);
  out.castB = await B.evaluate(`(()=>{
    const g=window.__game;
    const row=g.race.rows(g.player.pos.z).find(r=>!r.me);
    g.debug.cast(row.place);
    return JSON.stringify({to:row.name, place:row.place});
  })()`);
  await sleep(900);
  out.hitA = await A.evaluate(
    `JSON.stringify({down:+window.__game.player.buffDown.toFixed(2), downT:+window.__game.player.buffDownT.toFixed(1)})`
  );

  // 6) 断线：直接杀掉 B 的浏览器，A 应通过心跳超时把对手转为 AI 托管
  chromeB.kill();
  await sleep(7600);
  out.afterDrop = await A.evaluate(`JSON.stringify({netRace:window.__game.netRace,
    opponents:(window.__game.race.opponents||[]).map(o=>({name:o.name, remote:o.remote, ai:o.ai}))})`);
}

out.errorsA = A.errors.slice(0, 3);
out.errorsB = B.errors.slice(0, 3);
console.log(JSON.stringify(out, null, 1));

const joined = out.joined === true;
const ra = JSON.parse(out.rosterA || '[]');
const rb = JSON.parse(out.rosterB || '[]');
const sa = JSON.parse(out.startA || '{}');
const sb = JSON.parse(out.startB || '{}');
const sync = JSON.parse(out.sync || '[]');
const hit = JSON.parse(out.hitA || '{}');
const drop = JSON.parse(out.afterDrop || '{}');

const pass =
  !!out.code &&
  joined &&
  ra.length === 2 &&
  rb.length === 2 &&
  sa.mode === 'race' &&
  sa.opponents === 1 &&
  sa.remote?.[0] === true &&
  sb.mode === 'race' &&
  sync.length === 1 &&
  sync[0].z > 60 &&
  hit.down < 1 &&
  drop.opponents?.[0]?.ai === true &&
  drop.opponents?.[0]?.remote === false &&
  A.errors.length === 0 &&
  B.errors.length === 0;

console.log(pass ? 'NET PASS ✅' : 'NET FAILED ❌');
A.ws.close();
try { B.ws.close(); } catch {}
chromeA.kill();
chromeB.kill();
