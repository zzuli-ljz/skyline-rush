// 探测 MQTT over WebSocket 公共 broker 是否可达（沙箱/代理环境常见被拦）
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9360;

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    `--user-data-dir=${path.join(ROOT, '.tmp-netprobe')}`,
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
  throw new Error('no cdp');
}

const ws = new WebSocket(await attach());
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
await send('Page.navigate', { url: 'http://127.0.0.1:8123/' });
await sleep(2500);

const urls = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
for (const u of urls) {
  const r = await evaluate(`new Promise((res)=>{
    let w;
    try { w = new WebSocket(${JSON.stringify(u)}, 'mqtt'); } catch(e) { res('ctor-error'); return; }
    const t = setTimeout(()=>{ try{w.close()}catch(e){}; res('timeout') }, 7000);
    w.onopen=()=>{ clearTimeout(t); try{w.close()}catch(e){}; res('open'); };
    w.onerror=()=>{ clearTimeout(t); res('error'); };
  })`);
  console.log(u, '=>', r);
}

ws.close();
chrome.kill();
