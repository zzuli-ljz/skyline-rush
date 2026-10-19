// 天际疾行 · Skyline Rush — 状态机 / 主循环 / 关卡节奏
import * as THREE from 'three';
import { createStage } from './scene.js';
import { City } from './city.js';
import { Player } from './player.js';
import { Particles } from './fx.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { clamp, damp } from './utils.js';

// 运行时错误可视化（调试用）
window.addEventListener('error', (e) => {
  const el = document.getElementById('toast');
  if (el) {
    el.className = 'toast show';
    el.style.whiteSpace = 'normal';
    el.textContent = 'ERR: ' + (e.message || e.error);
  }
  console.error('[game]', e.message, e.error);
});

const canvas = document.getElementById('scene');
const stage = createStage(canvas);
const audio = new AudioEngine();
const fx = new Particles(stage.scene);
const city = new City(stage, fx);
const player = new Player(stage, audio, fx);
const hud = new HUD();
const input = new Input();

const isCoarse = matchMedia('(pointer: coarse)').matches;
const BEST_KEY = 'skyline-rush-best';

let mode = 'title'; // title | run | over | pause
let baseSpeed = 12;
let speed = 12;
let dist = 0;
let coins = 0;
let energy = 0;
let odT = 0; // 过载剩余时间
let odCd = 0; // 过载冷却（含冲刺本身的 4 秒）
let streak = 0;
let streakT = 0;
let deathDelay = 0;
let timeScale = 1;
let ghostZ = 0;
let shakeT = 0;
let fov = 76;
let quality = 2;
let fpsTime = 0;
let fpsFrames = 0;
let best = +(localStorage.getItem(BEST_KEY) || 0);

city.env = { speed: 10, diff: 0 };
city.reset();

// ---- 状态切换 ----
function startGame() {
  audio.init();
  city.reset();
  player.reset(0);
  baseSpeed = 12;
  speed = 12;
  dist = 0;
  coins = 0;
  energy = 0;
  odT = 0;
  odCd = 0;
  streak = 0;
  deathDelay = 0;
  timeScale = 1;
  mode = 'run';
  hud.showScreen(null);
  hud.touch(isCoarse);
  audio.ui();
}

function gameOver() {
  mode = 'over';
  const d = dist | 0;
  const isNew = d > best;
  if (isNew) {
    best = d;
    localStorage.setItem(BEST_KEY, String(best));
  }
  hud.setDeath(player.deathType);
  hud.setFinal(d, coins, best, isNew);
  hud.showScreen('over');
  hud.touch(false);
  hud.speedFx(false);
}

function backToTitle() {
  mode = 'title';
  ghostZ = 0;
  city.reset();
  hud.showScreen('title');
  hud.speedFx(false);
}

function pause() {
  if (mode !== 'run') return;
  mode = 'pause';
  hud.showScreen('pause');
  hud.touch(false);
}

function resume() {
  if (mode !== 'pause') return;
  mode = 'run';
  hud.showScreen(null);
  hud.touch(isCoarse);
}

// ---- UI 绑定 ----
// 统一用 bindUI：点击后立刻移除焦点。否则按钮保持焦点时，
// 游戏中按空格会在 keyup 时触发按钮 click（空格激活按钮发生在松开时），
// 表现为"松开跳跃键游戏突然重开回到起点"。
function bindUI(id, fn) {
  const el = document.getElementById(id);
  el.addEventListener('click', () => {
    el.blur();
    fn();
  });
}
bindUI('startBtn', startGame);
bindUI('retryBtn', startGame);
bindUI('homeBtn', backToTitle);
bindUI('resumeBtn', resume);
bindUI('quitBtn', backToTitle);
input.onEscape = () => {
  if (mode === 'run') pause();
  else if (mode === 'pause') resume();
};
input.onMute = () => {
  audio.init();
  audio.setMuted(!audio.muted);
  hud.toast(audio.muted ? '🔇 已静音' : '🔊 已开启声音', 1200);
};

// ---- 主循环 ----
const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  let rawDt = Math.min(clock.getDelta(), 0.05);
  elapsed += rawDt;

  // 自适应画质
  fpsTime += rawDt;
  fpsFrames++;
  if (fpsTime > 2.4) {
    const fps = fpsFrames / fpsTime;
    fpsTime = 0;
    fpsFrames = 0;
    if (fps < 42 && quality > 0) {
      quality--;
      stage.setQuality(quality);
    }
  }

  if (mode === 'pause') {
    stage.render();
    return;
  }

  const dt = rawDt * timeScale;

  if (mode === 'title') {
    // 标题画面：城市上空巡游
    ghostZ += dt * 11;
    if (ghostZ > 1100) {
      ghostZ -= 1000;
      city.rebase(1000);
    }
    city.env = { speed: 9, diff: 0 };
    city.update(ghostZ);
    city.animateCoins(elapsed);
    fx.update(dt);
    stage.camera.position.set(Math.sin(elapsed * 0.13) * 7, 25 + Math.sin(elapsed * 0.21) * 2.5, ghostZ - 30);
    stage.camera.rotation.order = 'YXZ';
    stage.camera.rotation.set(-0.16, Math.PI, Math.sin(elapsed * 0.1) * 0.02);
    if (Math.abs(stage.camera.fov - 62) > 0.1) {
      stage.camera.fov = 62;
      stage.camera.updateProjectionMatrix();
    }
    stage.update(dt, stage.camera.position);
    stage.render();
    return;
  }

  // ---- 游戏进行中（run / 死亡演出 / over） ----
  const running = mode === 'run' && player.alive;
  const actions = input.consume();
  input.update();

  baseSpeed = Math.min(34, 12 + dist * 0.018);
  const diff = clamp(dist / 1600, 0, 1);
  speed = baseSpeed * (odT > 0 ? 1.5 : 1);
  city.env = { speed: baseSpeed, diff };

  // 过载冲刺（有冷却：冲刺 4 秒 + 冷却 6 秒，防止连放）
  if (odCd > 0) odCd -= dt;
  if (running && actions.dash) {
    if (energy >= 50 && odT <= 0 && odCd <= 0) {
      odT = 4;
      odCd = 10; // 4s 冲刺 + 6s 冷却
      energy -= 50;
      audio.overdrive();
      hud.toast('⚡ 过载冲刺', 1400);
      fx.burst(player.pos, 0x8fd8ff, { count: 26, speed: 6, up: 3, life: 0.6, spread: 0.8 });
    } else if (odCd > 0) {
      hud.toast(`过载冷却中 · ${Math.ceil(odCd)}s`, 900);
    } else {
      hud.toast('能量不足 · 收集芯片', 900);
    }
  }
  if (odT > 0) {
    odT -= dt;
    if (odT <= 0) hud.speedFx(false);
  }

  if (running) {
    dist += speed * dt;
    player.update(dt, input, city, speed, actions, odT > 0);
  } else if (mode === 'run') {
    // 死亡演出
    player.update(dt, input, city, speed, actions, false);
    deathDelay -= rawDt;
    timeScale = player.deathType === 'crash' ? 0.32 : 0.6;
    shakeT = Math.max(shakeT, 0);
    if (deathDelay <= 0) {
      timeScale = 1;
      gameOver();
    }
  } else if (mode === 'over') {
    player.update(dt, input, city, speed, actions, false);
  }

  // 芯片收集
  if (running) {
    streakT -= dt;
    if (streakT <= 0) streak = 0;
    const radius = odT > 0 ? 4.2 : 1.6;
    for (const c of city.coinsNear(player.pos.z, radius + 3)) {
      const dx = c.x - player.pos.x;
      const dy = c.y - (player.pos.y + 1.0);
      const dz = c.z - player.pos.z;
      if (dx * dx + dy * dy + dz * dz < radius * radius) {
        city.collect(c);
        coins++;
        energy = Math.min(100, energy + 12);
        audio.coin(streak);
        streak = Math.min(streak + 1, 5);
        streakT = 1.2;
        fx.burst(c, 0xffc766, { count: 10, speed: 3.5, up: 2, life: 0.5, spread: 0.3 });
        if (energy >= 50 && energy < 62) hud.toast('过载就绪 · SHIFT', 1400);
      }
    }
    // 过载时撞碎障碍
    if (odT > 0) {
      for (const o of city.obstaclesNear(player.pos.z, 1.5)) {
        if (
          player.pos.x + 0.6 > o.x0 && player.pos.x - 0.6 < o.x1 &&
          player.pos.z + 0.6 > o.z0 && player.pos.z - 0.6 < o.z1
        ) {
          city.smash(o);
          audio.smash();
          shakeT = 0.12;
        }
      }
    }
  }

  // 世界更新
  city.update(player.pos.z);
  city.animateCoins(elapsed);
  fx.update(dt);
  audio.setWind(clamp((speed - 10) / 26, 0, 1) + (odT > 0 ? 0.15 : 0));

  // 相机
  player.applyCamera(stage.camera);
  if (shakeT > 0) {
    shakeT -= rawDt;
    const s = shakeT * 2.2;
    stage.camera.position.x += (Math.random() - 0.5) * s;
    stage.camera.position.y += (Math.random() - 0.5) * s;
  }
  const targetFov = 76 + ((baseSpeed - 12) / 22) * 6 + (odT > 0 ? 13 : 0);
  fov = damp(fov, targetFov, 6, rawDt);
  if (Math.abs(stage.camera.fov - fov) > 0.05) {
    stage.camera.fov = fov;
    stage.camera.updateProjectionMatrix();
  }
  hud.speedFx(odT > 0);

  // 浮点原点回正（世界整体后移，dist 不受影响）
  if (player.pos.z > 1200) {
    const D = 1000;
    player.pos.z -= D;
    city.rebase(D);
  }

  if (running || mode === 'run') {
    hud.hud(dist, best, coins, energy, odT > 0, odCd);
  }

  stage.update(dt, stage.camera.position);
  stage.render();
}

// 调试接口
window.__game = {
  get mode() {
    return mode;
  },
  get speed() {
    return speed;
  },
  startGame,
  player,
  city,
  get dist() {
    return dist;
  },
  get coins() {
    return coins;
  },
  get odT() {
    return odT;
  },
  get odCd() {
    return odCd;
  },
  debug: {
    giveEnergy: (n) => (energy = Math.min(100, energy + n)),
  },
};

// 调试：?auto 直接开局；?sim 自动跑酷（会看路：遇缺口跳、遇横梁滑、遇障碍跳）
if (location.search.includes('auto')) {
  setTimeout(() => startGame(), 500);
}
if (location.search.includes('sim')) {
  setTimeout(() => {
    setInterval(() => {
      const g = window.__game;
      if (!g || g.mode !== 'run' || !g.player.alive) return;
      const p = g.player;
      const spd = g.speed;

      // 1) 近处障碍反应
      for (const o of g.city.obstaclesNear(p.pos.z + spd * 0.35, 1.0)) {
        if (o.kind === 'beam') {
          input._slideTouch = true;
          setTimeout(() => (input._slideTouch = false), 450);
          return;
        }
        if (o.kind === 'wall') {
          const wx = (o.x0 + o.x1) / 2;
          // _touchAxis 是屏幕方向，世界 +x 对应屏幕左侧，故取反
          input._touchAxis = wx > p.pos.x ? 0.9 : -0.9;
          return;
        }
        if ((o.kind === 'vent' || o.kind === 'ac') && p.grounded) {
          input.jumpQueued = true;
          return;
        }
      }

      // 2) 缺口：贴边起跳并对准落点平台中心
      if (p.grounded && !g.city.platformAt(p.pos.x, p.pos.z + spd * 0.14)) {
        const landing =
          g.city.platformAt(p.pos.x, p.pos.z + spd * 1.3) ||
          g.city.platformAt(0, p.pos.z + spd * 1.3);
        if (landing) {
          // 世界 +x = 屏幕左，转向量取反
          input._touchAxis = clamp(-(landing.cx - p.pos.x) * 0.5, -1, 1);
          input.jumpQueued = true;
          return;
        }
      }

      // 3) 上台阶
      const cur = g.city.platformAt(p.pos.x, p.pos.z);
      if (cur) {
        const ahead = g.city.platformAt(cur.cx, p.pos.z + spd * 0.5);
        if (ahead && ahead.y > p.pos.y + 0.3 && p.grounded) {
          input.jumpQueued = true;
          return;
        }
        input._touchAxis = clamp(-(cur.cx - p.pos.x) * 0.35, -0.7, 0.7);
      }
    }, 60);
    setTimeout(() => startGame(), 500);
  }, 100);
}

animate();
