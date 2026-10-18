// 程序化城市：天台平台流式生成 + 障碍 + 芯片 + 楼群（实例化渲染）
import * as THREE from 'three';
import { mulberry32, facadeTexture, roofTexture, puddleTexture, clamp } from './utils.js';

const ZERO = /* @__PURE__ */ new THREE.Matrix4().makeScale(0, 0, 0);

function pool(n, make) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const m = make();
    m.visible = false;
    items.push(m);
  }
  return {
    items,
    get() {
      for (const m of items) if (!m.visible) return m;
      // 池满时按需扩容：极端情况（瞬移/长时间卡顿）下也绝不返回 null
      const m = make();
      items.push(m);
      return m;
    },
  };
}

export class City {
  constructor(stage, fx) {
    this.stage = stage;
    this.fx = fx;
    this.root = new THREE.Group();
    stage.scene.add(this.root);

    const rng = mulberry32(20261018);
    this.roofMat = new THREE.MeshStandardMaterial({
      map: roofTexture(rng),
      roughnessMap: puddleTexture(rng),
      roughness: 1,
      metalness: 0.08,
      envMapIntensity: 0.9,
    });
    const facadeTex = facadeTexture(rng);
    this.buildingMat = new THREE.MeshStandardMaterial({
      map: facadeTex,
      emissive: 0xffffff,
      emissiveMap: facadeTex,
      emissiveIntensity: 0.8,
      roughness: 0.75,
      metalness: 0.12,
      envMapIntensity: 0.55,
    });
    this.metalMat = new THREE.MeshStandardMaterial({
      color: 0x79818c,
      roughness: 0.42,
      metalness: 0.75,
      envMapIntensity: 1.1,
    });
    this.beamMat = new THREE.MeshStandardMaterial({
      color: 0x424a56,
      roughness: 0.5,
      metalness: 0.65,
      envMapIntensity: 1.0,
    });
    this.concreteMat = new THREE.MeshStandardMaterial({
      color: 0x474d58,
      roughness: 0.85,
      metalness: 0.05,
    });

    // 楼群（单 Draw Call 实例化，原点在底部）
    const bgeo = new THREE.BoxGeometry(1, 1, 1);
    bgeo.translate(0, 0.5, 0);
    this.bMesh = new THREE.InstancedMesh(bgeo, this.buildingMat, 460);
    // 楼群不投影：避免前方高楼把整条天台罩进阴影（只保留障碍物投影）
    this.bMesh.castShadow = false;
    this.bMesh.receiveShadow = true;
    this.bMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bMeta = new Map(); // idx -> {x,y,z,sx,sy,sz}
    this.bFree = [];
    const tint = new THREE.Color();
    for (let i = 0; i < 460; i++) {
      this.bFree.push(i);
      this.bMesh.setMatrixAt(i, ZERO);
      const v = 0.62 + Math.random() * 0.45;
      tint.setRGB(v * 0.92, v * 0.95, v * 1.08);
      this.bMesh.setColorAt(i, tint);
    }
    this.bMesh.instanceMatrix.needsUpdate = true;
    this.root.add(this.bMesh);

    // 天台平台池
    const pgeo = new THREE.BoxGeometry(1, 1, 1);
    this.platPool = pool(46, () => {
      const m = new THREE.Mesh(pgeo, this.roofMat);
      m.receiveShadow = true;
      this.root.add(m);
      return m;
    });

    // 障碍池
    const mk = (w, h, d, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
      return m;
    };
    this.ventPool = pool(24, () => mk(1.3, 0.9, 1.3, this.metalMat));
    this.acPool = pool(18, () => mk(2.0, 1.35, 1.2, this.metalMat));
    this.beamPool = pool(12, () => mk(1, 0.5, 0.7, this.beamMat));
    this.wallPool = pool(14, () => mk(0.9, 2.6, 0.5, this.beamMat));
    this.bulkPool = pool(12, () => mk(1, 1, 1, this.concreteMat));

    // 芯片（金币）实例
    const cgeo = new THREE.CylinderGeometry(0.34, 0.34, 0.09, 14);
    cgeo.rotateX(Math.PI / 2);
    this.coinMat = new THREE.MeshStandardMaterial({
      color: 0xffc766,
      emissive: 0xffaa33,
      emissiveIntensity: 1.7,
      metalness: 0.9,
      roughness: 0.22,
    });
    this.cMesh = new THREE.InstancedMesh(cgeo, this.coinMat, 260);
    this.cMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cMesh.frustumCulled = false;
    for (let i = 0; i < 260; i++) this.cMesh.setMatrixAt(i, ZERO);
    this.root.add(this.cMesh);
    this.cFree = [];
    for (let i = 0; i < 260; i++) this.cFree.push(i);

    this.segments = [];
    this.nextZ = 0;
    this.env = { speed: 12, diff: 0 };
    this.rng = mulberry32((Math.random() * 1e9) | 0);
  }

  reset() {
    for (const s of this.segments) this._freeSegment(s);
    this.segments = [];
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    // 起始安全平台
    const seg = this._makeSegment({ z1: -40 }, 0);
    seg.z0 = -40;
    seg.z1 = 45;
    seg.L = 85;
    seg.w = 10;
    seg.cx = 0;
    seg.y = 10;
    this._buildSegment(seg);
    this.segments.push(seg);
    this.nextZ = seg.z1;
    while (this.nextZ < 280) this._genOne();
  }

  _makeSegment(prev, gapAfter) {
    return {
      z0: prev.z1 + gapAfter,
      z1: 0,
      y: 10,
      cx: 0,
      w: 9,
      L: 0,
      obstacles: [],
      coins: [],
      plat: null,
      extras: [],
      bIdx: [],
      cIdx: [],
    };
  }

  _claimBuilding(x, y, z, sx, sy, sz) {
    if (!this.bFree.length) return -1;
    const i = this.bFree.pop();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion(),
      new THREE.Vector3(sx, sy, sz)
    );
    this.bMesh.setMatrixAt(i, m);
    this.bMesh.instanceMatrix.needsUpdate = true;
    this.bMeta.set(i, { x, y, z, sx, sy, sz });
    return i;
  }

  _releaseBuilding(i) {
    if (i < 0) return;
    this.bMesh.setMatrixAt(i, ZERO);
    this.bMeta.delete(i);
    this.bMesh.instanceMatrix.needsUpdate = true;
    this.bFree.push(i);
  }

  _claimCoin() {
    if (!this.cFree.length) return -1;
    return this.cFree.pop();
  }

  _releaseCoin(i) {
    if (i < 0) return;
    this.cMesh.setMatrixAt(i, ZERO);
    this.cFree.push(i);
  }

  _genOne() {
    const prev = this.segments[this.segments.length - 1];
    const rng = this.rng;
    const { speed, diff } = this.env;

    const L = 14 + rng() * 15 + diff * 5;
    const r = rng();
    let dy = 0;
    if (r < 0.3) dy = 0.7 + rng() * 0.5;
    else if (r < 0.52) dy = -(1.2 + rng() * 2.4);
    else dy = (rng() - 0.5) * 1.0;
    const maxGap = clamp(speed * 0.62, 4.5, 17);
    let gap = 2.5 + rng() * maxGap * 0.55;
    // 公平性：上台阶时跳跃距离变短，收缩缺口；下落则可以更远
    if (dy > 0.5) gap *= 0.55;
    else if (dy < -1) gap = Math.min(gap * 1.15, maxGap * 0.75);
    const y = clamp(prev.y + dy, 8, 34);
    const w = clamp(7.5 + rng() * 4 - diff * 2, 5, 11);
    const cx = clamp(prev.cx + (rng() - 0.5) * 5.5, -8, 8);

    const seg = this._makeSegment(prev, gap);
    seg.L = L;
    seg.z1 = seg.z0 + L;
    seg.y = y;
    seg.cx = cx;
    seg.w = w;
    this._buildSegment(seg);

    // ---- 障碍 ----
    const chance = 0.5 + 0.45 * diff;
    let n = rng() < chance ? 1 + (rng() < diff * 0.85 ? 1 : 0) + (rng() < diff * 0.4 ? 1 : 0) : 0;
    n = Math.min(n, Math.floor(L / 7));
    const zs = [];
    for (let i = 0; i < n; i++) zs.push(seg.z0 + 5.5 + rng() * (L - 9));
    zs.sort((a, b) => a - b);
    let lastZ = -99;
    for (const oz of zs) {
      if (oz - lastZ < 4.5) continue;
      lastZ = oz;
      const kr = rng();
      let kind;
      if (kr < 0.34) kind = 'vent';
      else if (kr < 0.56) kind = 'ac';
      else if (kr < 0.56 + (L >= 14 ? 0.26 : 0)) kind = 'beam';
      else kind = 'wall';
      this._placeObstacle(seg, kind, oz, rng);
    }

    // ---- 芯片 ----
    if (rng() < 0.62) {
      if (gap > 4 && rng() < 0.5) this._coinArc(seg, gap);
      else this._coinLine(seg, rng);
    }

    this.segments.push(seg);
    this.nextZ = seg.z1;
  }

  _placeObstacle(seg, kind, z, rng) {
    let p = null;
    let box = null;
    if (kind === 'vent') {
      p = this.ventPool.get();
      if (!p) return;
      const x = seg.cx + (rng() - 0.5) * (seg.w - 3);
      p.position.set(x, seg.y + 0.45, z);
      box = { x0: x - 0.65, x1: x + 0.65, z0: z - 0.65, z1: z + 0.65, y0: seg.y, y1: seg.y + 0.9 };
    } else if (kind === 'ac') {
      p = this.acPool.get();
      if (!p) return;
      const x = seg.cx + (rng() - 0.5) * (seg.w - 4);
      p.position.set(x, seg.y + 0.675, z);
      box = { x0: x - 1.0, x1: x + 1.0, z0: z - 0.6, z1: z + 0.6, y0: seg.y, y1: seg.y + 1.35 };
    } else if (kind === 'beam') {
      p = this.beamPool.get();
      if (!p) return;
      p.scale.set(seg.w + 0.4, 1, 1);
      p.position.set(seg.cx, seg.y + 1.75, z);
      box = {
        x0: seg.cx - seg.w,
        x1: seg.cx + seg.w,
        z0: z - 0.35,
        z1: z + 0.35,
        y0: seg.y + 1.5,
        y1: seg.y + 2.0,
      };
    } else {
      p = this.wallPool.get();
      if (!p) return;
      const side = rng() < 0.5 ? -1 : 1;
      const x = seg.cx + side * seg.w * 0.24;
      p.position.set(x, seg.y + 1.3, z);
      box = { x0: x - 0.45, x1: x + 0.45, z0: z - 0.25, z1: z + 0.25, y0: seg.y, y1: seg.y + 2.6 };
    }
    p.visible = true;
    p.scale.y = 1;
    p.scale.z = 1;
    if (kind !== 'beam') p.scale.x = 1;
    seg.obstacles.push({ ...box, kind, mesh: p, dead: false });
  }

  _coinLine(seg, rng) {
    const n = 4 + ((rng() * 3) | 0);
    const x = seg.cx + (rng() - 0.5) * seg.w * 0.4;
    const z0 = seg.z0 + 4;
    for (let i = 0; i < n; i++) {
      const z = z0 + i * 2.1;
      if (z > seg.z1 - 2) break;
      const idx = this._claimCoin();
      if (idx < 0) return;
      seg.coins.push({ x, y: seg.y + 1.25, z, idx, taken: false, ph: rng() * 6.28 });
    }
  }

  _coinArc(seg, gap) {
    const n = 7;
    const zMid = (seg.z0 + seg.z1) / 2 - gap / 2; // 缺口中点
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const z = seg.z0 - 3 + t * (gap + 6);
      const y = seg.y + 1.2 + Math.sin(t * Math.PI) * 1.5;
      const idx = this._claimCoin();
      if (idx < 0) return;
      seg.coins.push({ x: seg.cx, y, z, idx, taken: false, ph: Math.random() * 6.28 });
    }
  }

  _buildSegment(seg) {
    const { y, cx, w, L } = seg;
    const plat = this.platPool.get();
    plat.scale.set(w, 0.6, L);
    plat.position.set(cx, y - 0.3, (seg.z0 + seg.z1) / 2);
    plat.visible = true;
    plat.castShadow = true;
    seg.plat = plat;
    // 平台下的塔楼
    seg.bIdx.push(this._claimBuilding(cx, 0, (seg.z0 + seg.z1) / 2, w + 1.4, Math.max(y - 0.35, 1), L + 1.2));
    // 周边城市天际线
    const rng = this.rng;
    const nB = 2 + ((rng() * 2.4) | 0);
    for (let i = 0; i < nB; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const dist = w / 2 + 9 + rng() * 28;
      const bw = 8 + rng() * 12;
      const bd = 8 + rng() * 12;
      const bh = 20 + rng() * 66;
      const bx = cx + side * dist + (rng() - 0.5) * 10;
      const bz = seg.z0 + rng() * L;
      seg.bIdx.push(this._claimBuilding(bx, 0, bz, bw, bh, bd));
    }
    if (rng() < 0.3) {
      // 远景超高层剪影
      const side = rng() < 0.5 ? -1 : 1;
      seg.bIdx.push(
        this._claimBuilding(
          cx + side * (55 + rng() * 40),
          0,
          seg.z0 + rng() * L,
          16 + rng() * 18,
          90 + rng() * 55,
          16 + rng() * 18
        )
      );
    }
    // 天台角落的楼梯间装饰
    if (rng() < 0.42) {
      const b = this.bulkPool.get();
      if (b) {
        const side = rng() < 0.5 ? -1 : 1;
        b.scale.set(2.3, 2.5, 2.8);
        b.position.set(cx + side * (w / 2 - 1.4), y + 1.25, seg.z0 + 3 + rng() * (L - 6));
        b.visible = true;
        seg.extras.push(b);
      }
    }
  }

  _freeSegment(seg) {
    if (seg.plat) seg.plat.visible = false;
    for (const o of seg.obstacles) {
      o.mesh.visible = false;
      if (o.kind === 'beam') o.mesh.scale.set(1, 1, 1);
    }
    for (const e of seg.extras) e.visible = false;
    for (const i of seg.bIdx) this._releaseBuilding(i);
    for (const c of seg.coins) if (!c.taken) this._releaseCoin(c.idx);
  }

  update(playerZ) {
    // 每帧限量生成，防止一次性造出上百段（瞬移/掉帧时）
    let guard = 8;
    while (this.nextZ < playerZ + 280 && guard-- > 0) this._genOne();
    while (this.segments.length > 2 && this.segments[0].z1 < playerZ - 45) {
      this._freeSegment(this.segments.shift());
    }
  }

  // 玩家脚下的平台（找 z/x 覆盖的最高平台）
  platformAt(x, z) {
    let best = null;
    for (const s of this.segments) {
      if (z >= s.z0 - 0.2 && z <= s.z1 + 0.2 && x >= s.cx - s.w / 2 - 0.2 && x <= s.cx + s.w / 2 + 0.2) {
        if (!best || s.y > best.y) best = s;
      }
    }
    return best;
  }

  obstaclesNear(z, range = 2) {
    const out = [];
    for (const s of this.segments) {
      if (s.z1 < z - range || s.z0 > z + range) continue;
      for (const o of s.obstacles) if (!o.dead) out.push(o);
    }
    return out;
  }

  coinsNear(z, range = 8) {
    const out = [];
    for (const s of this.segments) {
      if (s.z1 < z - range || s.z0 > z + range) continue;
      for (const c of s.coins) if (!c.taken) out.push(c);
    }
    return out;
  }

  collect(c) {
    c.taken = true;
    this._releaseCoin(c.idx);
  }

  smash(o) {
    o.dead = true;
    o.mesh.visible = false;
    this.fx.burst(
      new THREE.Vector3((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, (o.z0 + o.z1) / 2),
      0xffb35c,
      { count: 26, speed: 7, up: 5, life: 0.7, spread: 1.2 }
    );
  }

  animateCoins(t) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(0, t * 3.2, 0);
    const sc = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    for (const s of this.segments) {
      for (const c of s.coins) {
        if (c.taken) continue;
        e.y = t * 3.2 + c.ph;
        q.setFromEuler(e);
        p.set(c.x, c.y + Math.sin(t * 2.4 + c.ph) * 0.12, c.z);
        m.compose(p, q, sc);
        this.cMesh.setMatrixAt(c.idx, m);
      }
    }
    this.cMesh.instanceMatrix.needsUpdate = true;
  }

  // 浮点原点回正：所有数据与网格整体后移
  rebase(D) {
    for (const s of this.segments) {
      s.z0 -= D;
      s.z1 -= D;
      for (const o of s.obstacles) {
        o.z0 -= D;
        o.z1 -= D;
        o.mesh.position.z -= D;
      }
      for (const c of s.coins) c.z -= D;
      if (s.plat) s.plat.position.z -= D;
      for (const e of s.extras) e.position.z -= D;
    }
    for (const [i, b] of this.bMeta) {
      b.z -= D;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(b.x, b.y, b.z),
        new THREE.Quaternion(),
        new THREE.Vector3(b.sx, b.sy, b.sz)
      );
      this.bMesh.setMatrixAt(i, m);
    }
    this.bMesh.instanceMatrix.needsUpdate = true;
    // 生成游标必须同步后移，否则会误判"前方已生成足够"，跑道直接断掉
    this.nextZ -= D;
  }
}
