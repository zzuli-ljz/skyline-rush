// 第一人称跑者：前进、横移、跳跃（土狼时间+缓冲）、滑铲、空中下压、障碍碰撞
import * as THREE from 'three';
import { clamp, damp } from './utils.js';

const G = 24;
const JUMP = 8.8;
const LAT_SPEED = 7.5;
const EYE = 1.62;
const CROUCH_EYE = 0.95;
const H_STAND = 1.7;
const H_SLIDE = 0.95;
const R = 0.35;

export class Player {
  constructor(stage, audio, fx) {
    this.stage = stage;
    this.audio = audio;
    this.fx = fx;
    this.pos = new THREE.Vector3(0, 10, 0); // 脚底位置
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.sliding = false;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.alive = true;
    this.deathType = null;
    this.bobPhase = 0;
    this.bobY = 0;
    this.roll = 0;
    this.landKick = 0;
    this.lastGroundY = 10;
    this.prevY = 10;
    this.glideT = 0; // 过载结束后的缓降余量
    this._odPrev = false;
    this._v = new THREE.Vector3();
  }

  reset(z) {
    this.pos.set(0, 10, z);
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.sliding = false;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.alive = true;
    this.deathType = null;
    this.bobPhase = 0;
    this.bobY = 0;
    this.landKick = 0;
    this.lastGroundY = 10;
    this.prevY = 10;
    this.glideT = 0;
    this._odPrev = false;
  }

  get height() {
    return this.sliding ? H_SLIDE : H_STAND;
  }

  update(dt, input, city, speed, actions, overdrive) {
    if (!this.alive) {
      // 死亡后相机继续表现：坠楼下坠 / 撞击后倒退
      if (this.deathType === 'fall') {
        this.vy -= G * dt;
        this.pos.y += this.vy * dt;
        this.pos.z += speed * dt * 0.35;
      }
      return;
    }

    // 前进
    this.pos.z += speed * dt;

    // 过载刚结束且人在空中 → 进入缓降余量：冲刺恰好停在楼缝上空时不会直接坠楼
    if (this._odPrev && !overdrive && !this.grounded) this.glideT = 2.0;
    this._odPrev = overdrive;
    if (this.glideT > 0) this.glideT -= dt;

    // 横移（input.axis 为屏幕方向：+1 右、-1 左；玩家朝 +z 跑，屏幕右侧是世界 -x）
    this.vx = damp(this.vx, -input.axis * LAT_SPEED, 11, dt);
    this.pos.x = clamp(this.pos.x + this.vx * dt, -30, 30);

    // 滑铲
    if (input.slideHeld && this.grounded && !this.sliding) {
      this.sliding = true;
      this.audio.slide();
    } else if (!input.slideHeld && this.sliding) {
      this.sliding = false;
    }

    // 跳跃（缓冲 + 土狼时间）
    if (actions.jump) this.jumpBuf = 0.14;
    this.jumpBuf -= dt;
    this.coyote -= dt;
    if (this.jumpBuf > 0 && (this.grounded || this.coyote > 0)) {
      this.vy = JUMP;
      this.grounded = false;
      this.sliding = false;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.audio.jump();
      this.fx.burst(this._v.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 0x9fb4cc, {
        count: 8, speed: 2.5, up: 1, life: 0.4, spread: 0.5, gravity: 4,
      });
    }
    // 过载期间空中按跳跃 = 飞行小跳（继续拔高）
    if (overdrive && !this.grounded && actions.jump) this.vy = Math.max(this.vy, 5.5);

    // 空中按下 = 快速下压（过载滑翔时禁用，避免和升力打架）
    if (!this.grounded && input.slideHeld && !overdrive) this.vy = Math.min(this.vy, -13);

    // 重力 / 过载滑翔
    if (!this.grounded) {
      if (overdrive) {
        // 滑翔：不累积下坠，升到巡航高度（当前/前方楼顶 + 1.2m）后平飞
        const cur = city.platformAt(this.pos.x, this.pos.z);
        const ahead = city.platformAt(this.pos.x, this.pos.z + speed * 0.3);
        let base = this.lastGroundY;
        if (cur) base = Math.max(base, cur.y);
        if (ahead) base = Math.max(base, ahead.y);
        const cruise = base + 1.2;
        const climb = this.pos.y < base + 0.4 ? 12 : 4.5; // 前方有更高的楼要提前爬
        this.vy = damp(this.vy, this.pos.y < cruise ? climb : 0, 8, dt);
        this.pos.y += this.vy * dt;
        if (cur && this.pos.y < cur.y) this.pos.y = Math.min(cur.y, this.pos.y + 12 * dt);
      } else if (this.glideT > 0) {
        // 缓降：限制下坠速度，并给一个高度下限（不低于原楼顶 2.5m），
        // 保证即使缺口比滑翔距离更宽，也能撑到下一块楼顶而不是坠楼
        this.vy = Math.max(this.vy - G * 0.3 * dt, -3.6);
        this.pos.y += this.vy * dt;
        const floor = this.lastGroundY - 2.5;
        if (this.pos.y < floor) {
          this.pos.y = floor;
          this.vy = 0;
        }
      } else {
        this.vy -= G * dt;
        this.pos.y += this.vy * dt;
      }
    }

    // ---- 地面判定 ----
    const seg = city.platformAt(this.pos.x, this.pos.z);
    let groundY = seg ? seg.y : null;
    if (!this.grounded) {
      // 可以落在通风机组 / 空调机顶部
      for (const o of city.obstaclesNear(this.pos.z, 1.5)) {
        if (
          this.pos.x > o.x0 - R && this.pos.x < o.x1 + R &&
          this.pos.z > o.z0 - 0.3 && this.pos.z < o.z1 + 0.3 &&
          this.vy <= 0 && this.prevY >= o.y1 - 0.15 && this.pos.y <= o.y1
        ) {
          groundY = groundY === null ? o.y1 : Math.max(groundY, o.y1);
        }
      }
    }
    // 落地必须"这一帧从上方越过平台面"：prevY 在平台之上才允许吸附，
    // 防止从楼缝里往上穿回楼顶（prevY 容差是快落地时的帧间穿透余量）
    if (groundY !== null && this.pos.y <= groundY + 0.02 && this.vy <= 0 && this.prevY >= groundY - 0.05) {
      if (!this.grounded) {
        const hard = this.vy < -12;
        this.audio.land(hard);
        this.landKick = hard ? 0.16 : 0.08;
        this.fx.burst(this._v.set(this.pos.x, groundY + 0.05, this.pos.z), 0x8a8f98, {
          count: hard ? 14 : 8, speed: 3, up: 1.2, life: 0.5, spread: 0.6, gravity: 6,
        });
      }
      this.pos.y = groundY;
      this.vy = 0;
      this.grounded = true;
      this.lastGroundY = groundY;
      this.coyote = 0.11;
      this.glideT = 0; // 落地即结束缓降，避免影响后续跳跃
    } else if (this.grounded && (groundY === null || this.pos.y > groundY + 0.05)) {
      // 走出边缘
      this.grounded = false;
      this.vy = Math.min(this.vy, 0);
      this.coyote = 0.11;
    }
    this.prevY = this.pos.y;

    // ---- 障碍碰撞（过载与缓降余量期间视为飞行，不会撞死）----
    if (!overdrive && this.glideT <= 0) {
      const top = this.pos.y + this.height;
      for (const o of city.obstaclesNear(this.pos.z, 1.5)) {
        if (
          this.pos.x + R > o.x0 && this.pos.x - R < o.x1 &&
          this.pos.z + 0.3 > o.z0 && this.pos.z - 0.3 < o.z1 &&
          top > o.y0 && this.pos.y < o.y1
        ) {
          this.die('crash');
          break;
        }
      }
    }

    // ---- 坠楼（过载滑翔 / 结束后的缓降期间不会坠楼）----
    if (!seg && this.alive && !overdrive && this.glideT <= 0 && this.pos.y < this.lastGroundY - 9) {
      this.die('fall');
    }

    // ---- 脚步声与镜头晃动 ----
    if (this.grounded && !this.sliding) {
      const prev = Math.sin(this.bobPhase);
      this.bobPhase += dt * speed * 0.62;
      const cur = Math.sin(this.bobPhase);
      if ((prev > 0 && cur <= 0) || (prev < 0 && cur >= 0)) this.audio.footstep();
      this.bobY = Math.sin(this.bobPhase) * 0.055;
    } else {
      this.bobY = damp(this.bobY, 0, 8, dt);
    }
    this.landKick = damp(this.landKick, 0, 6, dt);
    this.roll = damp(this.roll, -this.vx * 0.012, 8, dt);
  }

  die(type) {
    if (!this.alive) return;
    this.alive = false;
    this.deathType = type;
    if (type === 'crash') {
      this.audio.crash();
      this.fx.burst(this._v.set(this.pos.x, this.pos.y + 1.2, this.pos.z), 0xff8a4d, {
        count: 30, speed: 6, up: 4, life: 0.8, spread: 1.0,
      });
    } else {
      this.audio.fall();
    }
  }

  applyCamera(camera) {
    const eyeH = this.sliding ? CROUCH_EYE : EYE;
    camera.position.set(this.pos.x, this.pos.y + eyeH + this.bobY - this.landKick, this.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.sliding ? 0.05 : 0, Math.PI, this.roll);
  }
}
