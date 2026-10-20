// 把幽灵放到正前方截特写，验证胶囊/名牌渲染
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, '.shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9352;
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars', '--window-size=1600,900', `--user-data-dir=${path.join(ROOT, '.tmp-rshot')}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function attach() {
  for (let i = 0; i < 60; i++) {
    try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = t.find((x) => x.type === 'page'); if (p) return p.webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
}
const ws = new WebSocket(await attach());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (m2, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m2, params: p })); });
const evaluate = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.navigate', { url: 'http://127.0.0.1:8123/?race' });
await sleep(6000);
console.log(await evaluate(`(()=>{
  const g=window.__game,p=g.player;
  const o=g.race.opponents[0];
  o.z=p.pos.z+13; o.x=p.pos.x+1.2; o.y=p.pos.y;
  return JSON.stringify({pz:+p.pos.z.toFixed(1),gz:+o.z.toFixed(1)});
})()`));
await sleep(160);
const d = await evaluate(`(()=>{const c=document.getElementById('scene');return c?c.toDataURL('image/png'):''})()`);
if (d) writeFileSync(path.join(SHOTS, 'race-ghost.png'), Buffer.from(d.split(',')[1], 'base64'));
ws.close(); chrome.kill();
