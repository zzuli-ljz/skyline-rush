// 竞速模式：幽灵对手 + 名次 + 终点。
// 设计要点：所有对手（AI 或真人）都只是"一个会走路的坐标"，
// 渲染与排名走同一套接口，所以后面接联机时只需要换掉谁在驱动 z/x/y。
import * as THREE from 'three';
import { mulberry32, clamp, damp } from './utils.js';

export const RACE_LEN = 2200;

const AI_NAMES = ['霓虹', '赤风', '夜航'];
const AI_COLORS = [0x6fd6ff, 0xffb066, 0xb98cff];

function nameTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 38px system-ui, "PingFang SC", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(4,8,14,0.9)';
  g.strokeText(text, 128, 33);
  g.fillStyle = '#' + color.toString(16).padStart(6, '0');
  g.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.4, 0.6, 1);
  return sp;
}

export class Race {
  constructor(stage, city) {
    this.stage = stage;
    this.city = city;
    this.len = RACE_LEN;
    this.opponents = [];
    this.place = 1;
    this.time = 0;
    this.done = false;
    this._root = new THREE.Group();
    stage.scene.add(this._root);
    this._geo = new THREE.CapsuleGeometry(0.3, 0.92, 4, 10);
    this._ringGeo = new THREE.RingGeometry(0.46, 0.62, 26);
  }

  reset(seed, opts = {}) {
    this.len = opts.len || RACE_LEN;
    this.time = 0;
    this.place = 1;
    this.done = false;
    for (const o of this.opponents) o.root.visible = false;
    this.opponents.length = 0;
    const n = opts.ai === undefined ? 2 : opts.ai;
    for (let i = 0; i < n; i++) this._addAI(i, seed);
  }

  _addAI(i, seed) {
    const color = AI_COLORS[i % AI_COLORS.length];
    const o = this._makeGhost(AI_NAMES[i % AI_NAMES.length], color);
    o.ai = true;
    o.z = -5 - i * 5; // 起跑线后错开排队
    o.x = (i - 0.5) * 3;
    o.y = 10;
    const rng = mulberry32((seed | 0) + i * 7919 + 13);
    o.pace = 0.955 + rng() * 0.065; // 相对玩家速度的系数：有强有弱
    o.wob = rng() * 6.283;
    o.t = rng() * 3;
    this.opponents.push(o);
  }

  // 联机对手：位置由网络驱动（ai=false），断线后由 net 调用 takeover() 转 AI 托管
  addHuman(id, name, color, z = -4) {
    const o = this._makeGhost(name, color);
    o.id = id;
    o.ai = false;
    o.remote = true;
    o.z = z;
    o.netZ = z;
    o.netX = 0;
    o.netY = 10;
    o.pace = 1;
    o.wob = Math.random() * 6.283;
    o.t = Math.random() * 3;
    this.opponents.push(o);
    return o;
  }

  // 网络位置：只记录目标值，渲染时做阻尼插值（否则每 100ms 一跳很抖）
  setRemote(p) {
    const id = p.id || p.from; // state 包的发送者就是对手 id
    const o = this.opponents.find((x) => x.id === id);
    if (!o) return;
    o.netZ = p.z;
    o.netX = p.x === undefined ? o.netX : p.x;
    o.netY = p.y === undefined ? o.netY : p.y;
    o.lastSeen = Date.now();
    o.slowT = p.slow || 0;
    o.lockT = p.lock || 0;
    if (o.z < p.z - 40) o.z = p.z - 40; // 掉线很久后回归时别瞬移太远
  }

  // 心跳：证明这个对手还活着（应用层判定，不依赖 TCP 断开）
  touch(id) {
    const o = this.opponents.find((x) => x.id === id);
    if (o) o.lastSeen = Date.now();
  }

  // 断线 → 就地转 AI 托管，继续以当前速度跑完，别让比赛变成一个人的独角戏
  takeover(id) {
    const o = this.opponents.find((x) => x.id === id);
    if (!o) return null;
    o.ai = true;
    o.remote = false;
    o.pace = Math.min(1.02, Math.max(0.9, (12 + o.z * 0.018) / Math.max(1, 12 + o.z * 0.018)));
    return o;
  }

  removeHuman(id) {
    const i = this.opponents.findIndex((x) => x.id === id);
    if (i < 0) return;
    const o = this.opponents[i];
    o.root.visible = false;
    this.opponents.splice(i, 1);
  }

  // 技能命中：AI 直接生效；真人对手由上层通过 net 通知对方本地结算
  applySkill(o, kind) {
    if (!o) return;
    if (kind === 'headwind') o.slowT = 4;
    else if (kind === 'blackout') {
      o.slowT = 2;
      o.darkT = 5;
    } else if (kind === 'lockjump') o.lockT = 4;
  }

  _makeGhost(name, color) {
    const root = new THREE.Group();
    const body = new THREE.Mesh(
      this._geo,
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.9,
        roughness: 0.45,
        metalness: 0.25,
        transparent: true,
        opacity: 0.92,
      })
    );
    body.position.y = 0.86;
    body.castShadow = false;
    root.add(body);
    const ring = new THREE.Mesh(
      this._ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    root.add(ring);
    const tag = nameTag(name, color);
    tag.position.y = 2.15;
    root.add(tag);
    this._root.add(root);
    return {
      ai: true,
      remote: false,
      id: null,
      name,
      color,
      root,
      body,
      ring,
      z: -5,
      x: 0,
      y: 10,
      netZ: -5,
      netX: 0,
      netY: 10,
      pace: 1,
      wob: 0,
      t: 0,
      finished: false,
      finishT: 0,
      slowT: 0,
      lockT: 0,
      darkT: 0,
      lastSeen: Date.now(),
    };
  }

  // 生成要跑到所有对手前面，否则领先的幽灵会掉进"还没生成的地图"
  maxZ() {
    let m = 0;
    for (const o of this.opponents) if (o.z > m) m = o.z;
    return m;
  }

  update(dt, playerZ) {
    this.time += dt;
    for (const o of this.opponents) {
      o.t += dt;
      if (o.slowT > 0) o.slowT -= dt;
      if (o.lockT > 0) o.lockT -= dt;
      if (o.darkT > 0) o.darkT -= dt;
      if (o.finished) {
        o.root.position.set(o.x, o.y, o.z);
        continue;
      }
      if (o.ai) {
        // AI（含断线托管）：沿关卡曲线加速 + 一点正弦起伏，技能会改变它的速度
        const base = Math.min(34, 12 + o.z * 0.018) * o.pace;
        let mul = 1;
        if (o.slowT > 0) mul *= 0.72;
        if (o.lockT > 0) mul *= 0.86;
        o.z += base * mul * (1 + Math.sin(o.t * 1.7) * 0.035) * dt;
        const seg = this.city.platformAt(o.x, o.z);
        if (seg) {
          o.y = seg.y;
          const target = seg.cx + Math.sin(o.z * 0.11 + o.wob) * (seg.w * 0.18);
          o.x = damp(o.x, clamp(target, seg.cx - seg.w / 2 + 0.7, seg.cx + seg.w / 2 - 0.7), 4, dt);
        }
      } else {
        // 真人：位置来自网络，做阻尼插值（每秒 10 帧的状态直贴会抖）
        o.z = damp(o.z, o.netZ, 12, dt);
        o.x = damp(o.x, o.netX, 9, dt);
        o.y = damp(o.y, o.netY, 9, dt);
      }
      // 中招视觉：被减速 / 断电时压暗
      if (o.body) o.body.material.emissiveIntensity = o.darkT > 0 ? 0.3 : o.slowT > 0 ? 0.55 : 0.9;
      o.root.position.set(o.x, o.y, o.z);
      if (o.z >= this.len) {
        o.finished = true;
        o.finishT = this.time;
      }
    }
    let ahead = 0;
    for (const o of this.opponents) if (o.finished || o.z > playerZ) ahead++;
    this.place = ahead + 1;
  }

  // 名次表：按赛道进度降序，相差的米数直接给玩家看
  rows(playerZ) {
    const list = [
      { name: '你', z: playerZ, me: true, color: '#6fd6ff', done: false, id: null },
      ...this.opponents.map((o) => ({
        name: o.name,
        id: o.id,
        z: Math.min(o.z, this.len),
        me: false,
        color: '#' + o.color.toString(16).padStart(6, '0'),
        done: o.finished,
      })),
    ];
    list.sort((a, b) => b.z - a.z);
    return list.map((r, i) => ({
      place: i + 1,
      name: r.name,
      id: r.id,
      me: r.me,
      color: r.color,
      gap: r.me ? '—' : r.done ? '完赛' : `${r.z > playerZ ? '+' : ''}${Math.round(r.z - playerZ)}m`,
    }));
  }

  setVisible(on) {
    this._root.visible = on;
  }
}
