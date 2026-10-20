// 联机：手写 MQTT 3.1.1 over WebSocket（QoS0 够用，省掉一个几百 KB 的依赖）。
// 房间 = 一个 topic，6 位房间码；每 100ms 广播一次自己的位置，技能走独立事件。
// 断线不崩：上层把该玩家就地转成 AI 托管继续跑。

const TEX = new TextEncoder();

const utf8 = (s) => TEX.encode(s);

function lenPrefixed(bytes) {
  const out = new Uint8Array(bytes.length + 2);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function remainingLen(n) {
  const out = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 0x80;
    out.push(d);
  } while (n > 0);
  return new Uint8Array(out);
}

function joinBytes(list) {
  let len = 0;
  for (const a of list) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of list) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

function packet(type, flags, payload) {
  return joinBytes([new Uint8Array([(type << 4) | flags]), remainingLen(payload.length), payload]);
}

export function mqttConnectPkt(clientId, keepalive = 45) {
  const payload = joinBytes([
    new Uint8Array([0x00, 0x04]),
    utf8('MQTT'),
    new Uint8Array([0x04, 0x02, (keepalive >> 8) & 0xff, keepalive & 0xff]),
    lenPrefixed(utf8(clientId)),
  ]);
  return packet(1, 0, payload);
}

export function mqttSubscribePkt(topic, pid = 1) {
  const payload = joinBytes([
    new Uint8Array([(pid >> 8) & 0xff, pid & 0xff]),
    lenPrefixed(utf8(topic)),
    new Uint8Array([0x00]),
  ]);
  return packet(8, 2, payload);
}

export function mqttPublishPkt(topic, text) {
  return packet(3, 0, joinBytes([lenPrefixed(utf8(topic)), utf8(text)]));
}

// 流式解包：WebSocket 一次可能给半个包，也可能给两个半包
export class MqttParser {
  constructor() {
    this.buf = new Uint8Array(0);
  }

  push(data) {
    const merged = new Uint8Array(this.buf.length + data.length);
    merged.set(this.buf);
    merged.set(data, this.buf.length);
    this.buf = merged;
    const out = [];
    for (;;) {
      if (this.buf.length < 2) break;
      const type = this.buf[0] >> 4;
      let mul = 1;
      let len = 0;
      let i = 1;
      let b = 0;
      let incomplete = false;
      do {
        if (i >= this.buf.length) {
          incomplete = true;
          break;
        }
        b = this.buf[i++];
        len += (b & 0x7f) * mul;
        mul *= 128;
      } while (b & 0x80);
      if (incomplete || this.buf.length < i + len) break;
      out.push({ type, payload: this.buf.subarray(i, i + len) });
      this.buf = this.buf.subarray(i + len);
    }
    return out;
  }
}

function decodePublish(payload) {
  if (payload.length < 2) return null;
  const tl = (payload[0] << 8) | payload[1];
  if (payload.length < 2 + tl) return null;
  const topic = new TextDecoder().decode(payload.subarray(2, 2 + tl));
  const text = new TextDecoder().decode(payload.subarray(2 + tl));
  return { topic, text };
}

// 可用的公共 WSS broker（按顺序尝试，公共 broker 会抖，所以多备几个 + 重试）
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const TOPIC = (code) => `skyline-rush/v1/${code}`;

class Mqtt {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.parser = new MqttParser();
    this.ready = false;
    this.onPublish = null;
    this.onClose = null;
    this.onBroken = null;
    this._pid = 0;
    this._pingT = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            this.ws && this.ws.close();
          } catch {}
          reject(new Error('连接超时'));
        }
      }, 6000);
      try {
        this.ws = new WebSocket(this.url, 'mqtt');
      } catch (e) {
        clearTimeout(timer);
        reject(e);
        return;
      }
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        this.ws.send(mqttConnectPkt('sr_' + Math.random().toString(36).slice(2, 10)));
      };
      this.ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('无法连接联机服务器'));
        }
      };
      this.ws.onclose = () => {
        this.ready = false;
        clearInterval(this._pingT);
        if (this.onClose) this.onClose();
      };
      this.ws.onmessage = (ev) => {
        const list = this.parser.push(new Uint8Array(ev.data));
        for (const p of list) {
          if (p.type === 2) {
            this.ready = true;
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve();
            }
          } else if (p.type === 3) {
            const m = decodePublish(p.payload);
            if (m && this.onPublish) this.onPublish(m.topic, m.text);
          }
        }
      };
    });
  }

  subscribe(topic) {
    this.ws.send(mqttSubscribePkt(topic, ++this._pid));
    clearInterval(this._pingT);
    this._pingT = setInterval(() => {
      if (this.ready && this.ws.readyState === 1) this.ws.send(new Uint8Array([0xc0, 0x00]));
    }, 20000);
  }

  publish(topic, obj) {
    if (!this.ready || !this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(mqttPublishPkt(topic, JSON.stringify(obj)));
    return true;
  }

  close() {
    clearInterval(this._pingT);
    this.ready = false;
    try {
      this.ws && this.ws.close();
    } catch {}
    this.ws = null;
  }
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genCode(n = 6) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

export class Net {
  constructor() {
    this.id = 'p' + Math.random().toString(36).slice(2, 10);
    this.code = '';
    this.name = '';
    this.seed = 0;
    this.players = [];
    this.isHost = false;
    this.ready = false;
    this.onEvent = () => {};
    this._mqtt = null;
    this._rosterWait = null;
    this._hbT = null;
  }

  get topic() {
    return TOPIC(this.code);
  }

  async _open() {
    let lastErr = null;
    for (const url of BROKERS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const m = new Mqtt(url);
        try {
          await m.connect();
          this._mqtt = m;
          this.ready = true;
          m.onPublish = (_t, text) => this._onMessage(text);
          m.onClose = () => {
            if (!this.ready) return;
            this.ready = false;
            this.onEvent('disconnect');
          };
          m.subscribe(this.topic);
          // 应用层心跳：MQTT 的 TCP 断开可能要几十秒才被发现，
          // 这里 1.5s 一次，上层 5s 收不到就判定掉线并转 AI 托管
          clearInterval(this._hbT);
          this._hbT = setInterval(() => this._send({ t: 'hb' }), 1500);
          return;
        } catch (e) {
          lastErr = e;
          m.close();
        }
      }
    }
    throw lastErr || new Error('无法连接联机服务器');
  }

  _send(obj) {
    if (!this._mqtt) return false;
    return this._mqtt.publish(this.topic, { ...obj, from: this.id });
  }

  _broadcastRoster() {
    this._send({ t: 'roster', players: this.players, seed: this.seed, host: this.id });
  }

  async create(name) {
    this.name = name || '玩家';
    this.isHost = true;
    this.seed = (Math.random() * 1e9) | 0;
    this.code = genCode();
    await this._open();
    this.players = [{ id: this.id, name: this.name }];
    this._send({ t: 'join', id: this.id, name: this.name, host: true });
    this.onEvent('roster', this.players);
    return this.code;
  }

  async join(code, name) {
    this.name = name || '玩家';
    this.isHost = false;
    this.code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (this.code.length !== 6) throw new Error('房间码是 6 位');
    await this._open();
    // 订阅刚建好时对方可能还没收到，重发几次 join
    let lastErr = new Error('房间不存在，或房主已经离开');
    for (let attempt = 0; attempt < 3; attempt++) {
      this._send({ t: 'join', id: this.id, name: this.name });
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this._rosterWait = null;
            reject(lastErr);
          }, 2400);
          this._rosterWait = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        return this.code;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  startRace(cd = 3.4) {
    this._send({ t: 'start', seed: this.seed, cd });
  }

  sendState(z, x, y, slow, lock) {
    this._send({ t: 'st', z: Math.round(z * 10) / 10, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, slow, lock });
  }

  sendSkill(to, kind) {
    this._send({ t: 'sk', to, kind });
  }

  leave() {
    if (this._mqtt) this._send({ t: 'bye', id: this.id });
    clearInterval(this._hbT);
    if (this._mqtt) this._mqtt.close();
    this._mqtt = null;
    this.ready = false;
    this.players = [];
  }

  _onMessage(text) {
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (!m || m.from === this.id) return;
    switch (m.t) {
      case 'join': {
        if (!this.isHost) return;
        if (this.players.length >= 3) {
          this._send({ t: 'full', to: m.id });
          return;
        }
        if (!this.players.some((p) => p.id === m.id)) this.players.push({ id: m.id, name: m.name || '玩家' });
        this._broadcastRoster();
        this.onEvent('roster', this.players);
        break;
      }
      case 'roster': {
        const mine = (m.players || []).find((p) => p.id === this.id);
        if (!mine) return; // 自己不在名单里：说明房间满了或已重置
        this.players = m.players;
        this.seed = m.seed;
        this.isHost = m.host === this.id;
        if (this._rosterWait) {
          const w = this._rosterWait;
          this._rosterWait = null;
          w();
        }
        this.onEvent('roster', this.players);
        break;
      }
      case 'full':
        if (m.to === this.id) this.onEvent('full');
        break;
      case 'start':
        this.onEvent('start', { seed: m.seed, cd: m.cd });
        break;
      case 'st':
        this.onEvent('state', m);
        break;
      case 'hb':
        this.onEvent('hb', { id: m.from });
        break;
      case 'sk':
        this.onEvent('skill', m);
        break;
      case 'bye':
        if (this.isHost) {
          this.players = this.players.filter((p) => p.id !== m.id);
          this._broadcastRoster();
          this.onEvent('roster', this.players);
        }
        this.onEvent('left', m);
        break;
      default:
        break;
    }
  }
}
