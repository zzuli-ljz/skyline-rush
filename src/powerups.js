// 技能盲盒：赛道上每 BOX_STEP 米刷一个，跑过去撞到就随机开出一个技能。
// 自用技能（疾风/护盾/磁力）拾取即生效；攻击技能（逆风/断电/锁跳）进槽，按 1/2/3 指定对手释放。
// 盲盒内容由赛道种子预先决定 —— 同一房间里同一个盒子对所有人都是同一个技能，保证公平。
import * as THREE from 'three';
import { mulberry32, clamp } from './utils.js';

export const SKILLS = {
  gale: { name: '疾风', icon: '🌬', self: true, dur: 8, color: 0x7de3ff, desc: '速度 +22% · 8s' },
  shield: { name: '护盾', icon: '🛡', self: true, dur: 10, color: 0x8affc1, desc: '免疫一次撞击/坠落 · 10s' },
  magnet: { name: '磁力', icon: '🧲', self: true, dur: 8, color: 0xffd27d, desc: '大范围吸取芯片 · 8s' },
  headwind: { name: '逆风', icon: '🌪', self: false, dur: 4, color: 0xff9a5c, desc: '目标减速 28% · 4s' },
  blackout: { name: '断电', icon: '🔌', self: false, dur: 5, color: 0xc9a6ff, desc: '目标能量清零 · 5s 无法过载' },
  lockjump: { name: '锁跳', icon: '⛓', self: false, dur: 4, color: 0xff8a8a, desc: '目标无法跳跃 · 4s' },
};
export const SKILL_KEYS = Object.keys(SKILLS);
export const BOX_FIRST = 220; // 第一个盲盒的位置（m）
export const BOX_STEP = 200; // 之后每 200m 一个
export const BOX_COUNT = 11;

export class Powerups {
  constructor(stage, city) {
    this.stage = stage;
    this.city = city;
    this.root = new THREE.Group();
    stage.scene.add(this.root);
    this.boxes = [];
    this._geo = new THREE.BoxGeometry(0.78, 0.78, 0.78);
    this._edgeGeo = new THREE.EdgesGeometry(this._geo);
    this._boxMat = new THREE.MeshStandardMaterial({
      color: 0x18222e,
      emissive: 0x2b6a86,
      emissiveIntensity: 0.55,
      roughness: 0.42,
      metalness: 0.62,
    });
    this._lineMat = new THREE.LineBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.85 });
    this._ringGeo = new THREE.RingGeometry(0.62, 0.74, 30);
    for (let i = 0; i < BOX_COUNT; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this._geo, this._boxMat);
      const edge = new THREE.LineSegments(this._edgeGeo, this._lineMat);
      const ring = new THREE.Mesh(
        this._ringGeo,
        new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.62;
      g.add(body, edge, ring);
      g.visible = false;
      this.root.add(g);
      this.boxes.push({ mesh: g, ring, z: BOX_FIRST + i * BOX_STEP, x: 0, y: 10, taken: false, aligned: false, ph: i * 1.7, skill: 'gale' });
    }
  }

  reset(seed) {
    const rng = mulberry32(((seed | 0) ^ 0x5f3a9c) | 0);
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      b.z = BOX_FIRST + i * BOX_STEP;
      b.taken = false;
      b.aligned = false;
      b.mesh.visible = false;
      b.skill = SKILL_KEYS[(rng() * SKILL_KEYS.length) | 0];
    }
  }

  setVisible(on) {
    this.root.visible = on;
  }

  // 盒子所在位置可能正好是楼缝：吸附到前方最近的一块楼顶上
  _align(b) {
    const seg = this.city.platformNear(b.z);
    if (seg) {
      b.x = clamp(seg.cx, seg.cx - seg.w / 2 + 0.7, seg.cx + seg.w / 2 - 0.7);
      b.y = seg.y + 1.05;
      b.aligned = true;
      return true;
    }
    const p = this.city.respawnPoint(0, b.z, 90);
    if (!p) return false;
    b.z = p.z;
    b.x = p.x;
    b.y = p.y + 1.05;
    b.aligned = true;
    return true;
  }

  // 返回本帧被吃掉的盒子（没有则 null）
  update(dt, player) {
    let picked = null;
    for (const b of this.boxes) {
      if (b.taken) continue;
      if (b.z < player.pos.z - 25 || b.z > player.pos.z + 220) {
        b.mesh.visible = false;
        continue;
      }
      if (!b.aligned && !this._align(b)) continue;
      b.ph += dt;
      b.mesh.visible = true;
      b.mesh.position.set(b.x, b.y + Math.sin(b.ph * 1.6) * 0.12, b.z);
      b.mesh.rotation.y = b.ph * 0.9;
      b.ring.rotation.z = -b.ph * 1.4;
      if (
        Math.abs(player.pos.z - b.z) < 1.6 &&
        Math.abs(player.pos.x - b.x) < 1.7 &&
        Math.abs(player.pos.y + 0.9 - b.y) < 2.4
      ) {
        b.taken = true;
        b.mesh.visible = false;
        picked = b;
      }
    }
    return picked;
  }
}
