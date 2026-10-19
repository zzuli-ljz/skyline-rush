// 通用工具：随机数、插值、程序化纹理
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));

function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

// 楼体立面：暗色混凝土 + 随机亮灯窗户（同时用作 emissiveMap，亮窗自然发光）
export function facadeTexture(rng) {
  const [c, g] = canvas2d(256);
  g.fillStyle = '#12161e';
  g.fillRect(0, 0, 256, 256);
  // 轻微竖向渐变，模拟楼体受光
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,180,120,0.10)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.25)');
  const cols = 8;
  const rows = 10;
  const cw = 256 / cols;
  const ch = 256 / rows;
  for (let y = 0; y < rows; y++) {
    // 部分整层熄灯，制造楼层节奏
    const floorDark = rng() < 0.18;
    for (let x = 0; x < cols; x++) {
      const wx = x * cw + 5;
      const wy = y * ch + 5;
      const ww = cw - 10;
      const wh = ch - 9;
      const r = rng();
      if (!floorDark && r < 0.3) {
        const warm = rng() < 0.72;
        g.fillStyle = warm
          ? `rgba(255,${170 + ((rng() * 50) | 0)},${90 + ((rng() * 60) | 0)},1)`
          : `rgba(${130 + ((rng() * 40) | 0)},${190 + ((rng() * 40) | 0)},255,1)`;
      } else {
        g.fillStyle = r < 0.5 ? '#0a0d13' : '#0e1219';
      }
      g.fillRect(wx, wy, ww, wh);
    }
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 天台地面：混凝土 + 分缝 + 污渍
export function roofTexture(rng) {
  const [c, g] = canvas2d(256);
  g.fillStyle = '#2b2e34';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 30 + ((rng() * 26) | 0);
    g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    g.fillRect(rng() * 256, rng() * 256, 1.6, 1.6);
  }
  // 面板分缝
  g.strokeStyle = 'rgba(10,12,16,0.85)';
  g.lineWidth = 2;
  for (let i = 0; i <= 2; i++) {
    g.beginPath();
    g.moveTo(i * 128, 0);
    g.lineTo(i * 128, 256);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * 128);
    g.lineTo(256, i * 128);
    g.stroke();
  }
  // 锈迹污渍
  for (let i = 0; i < 7; i++) {
    g.fillStyle = `rgba(64,52,38,${0.12 + rng() * 0.14})`;
    g.beginPath();
    g.ellipse(rng() * 256, rng() * 256, 8 + rng() * 26, 6 + rng() * 18, rng() * 3, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 天台粗糙度图：雨后积水（暗=光滑反射）
export function puddleTexture(rng) {
  const [c, g] = canvas2d(256);
  g.fillStyle = '#c8c8c8';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = `rgba(30,30,30,${0.55 + rng() * 0.35})`;
    g.beginPath();
    g.ellipse(rng() * 256, rng() * 256, 10 + rng() * 30, 8 + rng() * 22, rng() * 3, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---- 芯片：暗色电路板 + 细亮线路（发光只在线上，整片不发光）----
function drawChip(g, emissive) {
  g.clearRect(0, 0, 256, 256);
  if (emissive) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
  } else {
    const bg = g.createRadialGradient(112, 104, 12, 128, 128, 132);
    bg.addColorStop(0, '#222b36');
    bg.addColorStop(0.72, '#131a23');
    bg.addColorStop(1, '#080b10');
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 256);
  }
  const line = emissive ? '#ffffff' : '#ffd68a';
  const soft = emissive ? 'rgba(255,255,255,0.5)' : 'rgba(255,214,138,0.45)';
  // 外圈
  g.strokeStyle = line;
  g.lineWidth = 5;
  g.beginPath(); g.arc(128, 128, 116, 0, 6.2832); g.stroke();
  // 内细圈
  g.strokeStyle = soft;
  g.lineWidth = 2;
  g.beginPath(); g.arc(128, 128, 101, 0, 6.2832); g.stroke();
  // 电路走线：四向折线
  g.strokeStyle = line;
  g.lineWidth = 5;
  g.lineCap = 'square';
  const paths = [
    [[128, 12], [128, 62], [92, 62]],
    [[128, 244], [128, 194], [164, 194]],
    [[12, 128], [62, 128], [62, 160]],
    [[244, 128], [194, 128], [194, 96]],
  ];
  for (const p of paths) {
    g.beginPath();
    g.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]);
    g.stroke();
  }
  // 走线末端的焊点
  for (const [x, y] of [[92, 62], [164, 194], [62, 160], [194, 96]]) {
    g.fillStyle = line;
    g.beginPath(); g.arc(x, y, 5.5, 0, 6.2832); g.fill();
  }
  // 中央芯片焊盘
  if (!emissive) {
    g.fillStyle = '#0a0f15';
    g.fillRect(97, 97, 62, 62);
  }
  g.strokeStyle = line;
  g.lineWidth = 4;
  g.strokeRect(97, 97, 62, 62);
  g.strokeStyle = soft;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(112, 128); g.lineTo(144, 128);
  g.moveTo(128, 112); g.lineTo(128, 144);
  g.stroke();
}

export function chipTexture() {
  const [ca, ga] = canvas2d(256);
  drawChip(ga, false);
  const [ce, ge] = canvas2d(256);
  drawChip(ge, true);
  const map = new THREE.CanvasTexture(ca);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const emissive = new THREE.CanvasTexture(ce);
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}

// ---- 障碍物反光条：金属底 + 顶部一道 3M 式反光带（带内是斜纹警示条）----
function drawTapeBand(g, y0, h, emissive) {
  g.save();
  g.beginPath();
  g.rect(0, y0, 256, h);
  g.clip();
  g.fillStyle = emissive ? '#aebdd8' : '#eef3fa';
  g.fillRect(0, y0, 256, h);
  // 45° 斜纹
  g.lineWidth = 9;
  g.strokeStyle = emissive ? '#6b4a1c' : '#e0a03c';
  for (let x = -h; x < 256 + h; x += 30) {
    g.beginPath();
    g.moveTo(x, y0 + h + 6);
    g.lineTo(x + h + 12, y0 - 6);
    g.stroke();
  }
  // 上下压边
  g.strokeStyle = emissive ? '#4a5568' : 'rgba(30,36,44,0.55)';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, y0 + 1.5); g.lineTo(256, y0 + 1.5); g.stroke();
  g.beginPath(); g.moveTo(0, y0 + h - 1.5); g.lineTo(256, y0 + h - 1.5); g.stroke();
  g.restore();
}

function drawHazard(g, emissive) {
  if (emissive) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
  } else {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#7f8894');
    grad.addColorStop(0.55, '#69727e');
    grad.addColorStop(1, '#4e5763');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    // 竖向拉丝，避免大面积死板
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * 256;
      g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.035})`;
      g.fillRect(x, 0, 1.6, 256);
    }
    // 分缝
    g.strokeStyle = 'rgba(38,44,52,0.5)';
    g.lineWidth = 2;
    for (const y of [96, 176]) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke();
    }
  }
  drawTapeBand(g, 28, 30, emissive); // 顶部反光带
  drawTapeBand(g, 134, 20, emissive); // 腰部细带
}

export function hazardTexture() {
  const [ca, ga] = canvas2d(256);
  drawHazard(ga, false);
  const [ce, ge] = canvas2d(256);
  drawHazard(ge, true);
  const map = new THREE.CanvasTexture(ca);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const emissive = new THREE.CanvasTexture(ce);
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}
