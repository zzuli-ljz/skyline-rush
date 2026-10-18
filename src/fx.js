// 粒子特效池：芯片火花、落地尘土、撞击碎片（加色混合，黑色即不可见）
import * as THREE from 'three';

const N = 500;

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.base = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.maxLife = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
    this.col.fill(0);
  }

  burst(p, color, { count = 14, speed = 4, up = 2, life = 0.6, gravity = 9, spread = 0.4 } = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % N;
      const k3 = k * 3;
      this.pos[k3] = p.x + (Math.random() - 0.5) * spread;
      this.pos[k3 + 1] = p.y + (Math.random() - 0.5) * spread;
      this.pos[k3 + 2] = p.z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2;
      const r = (0.3 + Math.random() * 0.7) * speed;
      this.vel[k3] = Math.cos(a) * r;
      this.vel[k3 + 1] = Math.random() * up + up * 0.3;
      this.vel[k3 + 2] = Math.sin(a) * r;
      this.base[k3] = c.r;
      this.base[k3 + 1] = c.g;
      this.base[k3 + 2] = c.b;
      this.life[k] = this.maxLife[k] = life * (0.6 + Math.random() * 0.6);
      this.grav[k] = gravity;
    }
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      dirty = true;
      this.life[i] -= dt;
      const k3 = i * 3;
      if (this.life[i] <= 0) {
        this.col[k3] = this.col[k3 + 1] = this.col[k3 + 2] = 0;
        continue;
      }
      this.vel[k3 + 1] -= this.grav[i] * dt;
      this.pos[k3] += this.vel[k3] * dt;
      this.pos[k3 + 1] += this.vel[k3 + 1] * dt;
      this.pos[k3 + 2] += this.vel[k3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[k3] = this.base[k3] * f;
      this.col[k3 + 1] = this.base[k3 + 1] * f;
      this.col[k3 + 2] = this.base[k3 + 2] * f;
    }
    if (dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
  }
}
