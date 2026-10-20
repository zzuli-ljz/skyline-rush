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
    const tag = nameTag(AI_NAMES[i % AI_NAMES.length], color);
    tag.position.y = 2.15;
    root.add(tag);
    this._root.add(root);

    const rng = mulberry32((seed | 0) + i * 7919 + 13);
    this.opponents.push({
      ai: true,
      name: AI_NAMES[i % AI_NAMES.length],
      color,
      root,
      z: -5 - i * 5, // 起跑线后错开排队
      x: (i - 0.5) * 3,
      y: 10,
      pace: 0.955 + rng() * 0.065, // 相对玩家速度的系数：有强有弱
      wob: rng() * 6.283,
      t: rng() * 3,
      finished: false,
      finishT: 0,
    });
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
      if (o.finished) {
        o.root.position.set(o.x, o.y, o.z);
        continue;
      }
      o.t += dt;
      // 沿关卡曲线加速，再加一点正弦起伏，看起来像在认真跑而不是匀速滑动
      const base = Math.min(34, 12 + o.z * 0.018) * o.pace;
      o.z += base * (1 + Math.sin(o.t * 1.7) * 0.035) * dt;
      const seg = this.city.platformAt(o.x, o.z);
      if (seg) {
        o.y = seg.y;
        const target = seg.cx + Math.sin(o.z * 0.11 + o.wob) * (seg.w * 0.18);
        o.x = damp(o.x, clamp(target, seg.cx - seg.w / 2 + 0.7, seg.cx + seg.w / 2 - 0.7), 4, dt);
      }
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
      { name: '你', z: playerZ, me: true, color: '#6fd6ff', done: false },
      ...this.opponents.map((o) => ({
        name: o.name,
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
      me: r.me,
      color: r.color,
      gap: r.me ? '—' : r.done ? '完赛' : `${r.z > playerZ ? '+' : ''}${Math.round(r.z - playerZ)}m`,
    }));
  }

  setVisible(on) {
    this._root.visible = on;
  }
}
