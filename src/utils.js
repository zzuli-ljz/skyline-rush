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
