// 定点验收 v2：不停顿，传送后 2 帧内连拍（跑进障碍前完成）
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9359;
const DIR = path.join(ROOT, '.shots');
mkdirSync(DIR, { recursive: true });

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--enable-unsafe-swiftshader',
  '--no-sandbox', '--hide-scrollbars', '--window-size=1600,900',
  `--user-data-dir=${path.join(ROOT, '.tmp-obsshots2')}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let url = null;
for (let i = 0; i < 60; i++) {
  try {
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = t.find((x) => x.type === 'page');
    if (p) { url = p.webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(250);
}
const ws = new WebSocket(url);
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

const snap = (expr) => send('Runtime.evaluate', {
  expression: `(async()=>{const r=(()=>{${expr}})();
    await new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(res)));
    const img=document.getElementById('scene').toDataURL('image/png');
    return {info:r,img};})()`,
  awaitPromise: true,
  returnByValue: true,
});

const shoot = async (name, dist, what) => {
  const search = what === 'ob'
    ? "for(const s of g.city.segments)for(const o of s.obstacles){if(o.z0>p.pos.z+2&&(!target||o.z0<target.z0))target={z:o.z0,cx:(o.x0+o.x1)/2,y:o.y0};}"
    : "for(const s of g.city.segments)for(const c of s.coins){if(!c.taken&&c.z>p.pos.z+6&&(!target||c.z<target.z))target={z:c.z,x:c.x,y:c.y-1.25};}";
  const code = "const g=window.__game,p=g.player;g.debug.setDist(" + dist + ");let target=null;" + search +
    "if(!target)return 'no-target';" +
    "p.pos.set(target.cx!==undefined?target.cx:target.x,target.y,target.z-3.4);" +
    "p.prevY=p.pos.y;p.vy=0;p.vx=0;p.grounded=true;p.lastGroundY=target.y;" +
    "p.applyCamera(g.stage.camera);return JSON.stringify({z:+target.z.toFixed(1),dist:" + dist + "});";
  const r = await snap(code);
  const v = r.result?.result?.value;
  if (!v || !v.img) { console.log(name, 'FAIL', JSON.stringify(r).slice(0, 300)); return; }
  writeFileSync(path.join(DIR, name + '.png'), Buffer.from(v.img.split(',')[1], 'base64'));
  console.log(name, v.info);
};

await shoot('obs-day', 60, 'ob');
await shoot('coin-day', 60, 'coin');
await shoot('obs-night', 1250, 'ob');
await shoot('coin-night', 1250, 'coin');

ws.close();
chrome.kill();
try { rmSync(path.join(ROOT, '.tmp-obsshots2'), { recursive: true, force: true }); } catch {}
process.exit(0);
