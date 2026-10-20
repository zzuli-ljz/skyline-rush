// 天际疾行 · Skyline Rush — 状态机 / 主循环 / 关卡节奏
import * as THREE from 'three';
import { createStage } from './scene.js';
import { City } from './city.js';
import { Player } from './player.js';
import { Particles } from './fx.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { Daylight } from './daylight.js';
import { Race, RACE_LEN } from './race.js';
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
const daylight = new Daylight(stage, city);
const race = new Race(stage, city);

const isCoarse = matchMedia('(pointer: coarse)').matches;
const BEST_KEY = 'skyline-rush-best';
const RACE_BEST_KEY = 'skyline-rush-race-best';

let mode = 'title'; // title | run | race | over | pause
let lastPlay = 'run'; // 用于"再跑一次"回到正确的模式
let pauseFrom = 'run';
let raceState = 'idle'; // idle | countdown | go | done
let cdT = 0;
let lastCd = '';
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
let glideWas = false;
let lastPhase = 0;
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
  player.raceMode = false;
  race.setVisible(false);
  baseSpeed = 12;
  speed = 12;
  dist = 0;
  coins = 0;
  energy = 0;
  odT = 0;
  odCd = 0;
  glideWas = false;
  lastPhase = 0;
  daylight.update(0);
  streak = 0;
  deathDelay = 0;
  timeScale = 1;
  mode = 'run';
  lastPlay = 'run';
  raceState = 'idle';
  hud.race(false);
  hud.countdown(null);
  hud.showScreen(null);
  hud.touch(isCoarse);
  // 手机端：借用户手势顺手进全屏（浏览器要求全屏必须由手势触发）
  if (isCoarse && !fsEl()) toggleFullscreen();
  syncRotate();
  audio.ui();
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// 竞速赛：固定赛道 + 3 人（本地 1 人 + 2 个幽灵），撞/掉只扣速度
function startRace(seed) {
  audio.init();
  const s = seed === undefined ? (Math.random() * 1e9) | 0 : seed | 0;
  city.reset(s);
  player.reset(0);
  player.raceMode = true;
  race.reset(s, { ai: 2, len: RACE_LEN });
  race.setVisible(true);
  baseSpeed = 12;
  speed = 12;
  dist = 0;
  coins = 0;
  energy = 0;
  odT = 0;
  odCd = 0;
  glideWas = false;
  lastPhase = 0;
  daylight.update(0);
  streak = 0;
  deathDelay = 0;
  timeScale = 1;
  mode = 'race';
  lastPlay = 'race';
  raceState = 'countdown';
  cdT = 3.4;
  lastCd = '';
  hud.showScreen(null);
  hud.race(true);
  hud.touch(isCoarse);
  if (isCoarse && !fsEl()) toggleFullscreen();
  syncRotate();
  audio.ui();
}

// 竖屏提示：手机竖着玩视野太窄，提示旋转
function syncRotate() {
  const hint = document.getElementById('rotateHint');
  if (!hint) return;
  const portrait = window.innerHeight > window.innerWidth;
  hint.classList.toggle('show', isCoarse && portrait && (mode === 'run' || mode === 'race'));
}
window.addEventListener('resize', syncRotate);

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
  syncRotate();
}

// 竞速结束：不再有"死亡演出"，直接结算名次与用时
function finishRace() {
  mode = 'over';
  raceState = 'done';
  player.raceMode = false;
  const place = race.place;
  const t = race.time;
  const rb = +(localStorage.getItem(RACE_BEST_KEY) || 0);
  const isBest = rb === 0 || t < rb;
  if (isBest) localStorage.setItem(RACE_BEST_KEY, String(t));
  hud.setRaceResult(place, race.opponents.length + 1, fmtTime(t), coins, isBest);
  hud.showScreen('over');
  hud.race(false);
  hud.touch(false);
  hud.speedFx(false);
  hud.countdown(null);
  hud.hit(0);
  syncRotate();
  audio.ui();
}

function backToTitle() {
  mode = 'title';
  ghostZ = 0;
  player.raceMode = false;
  race.setVisible(false);
  hud.race(false);
  hud.countdown(null);
  hud.hit(0);
  city.reset();
  hud.showScreen('title');
  hud.speedFx(false);
  hud.touch(false);
  syncRotate();
}

function pause() {
  if (mode !== 'run' && mode !== 'race') return;
  pauseFrom = mode;
  mode = 'pause';
  hud.showScreen('pause');
  hud.touch(false);
  syncRotate();
}

function resume() {
  if (mode !== 'pause') return;
  mode = pauseFrom;
  hud.showScreen(null);
  hud.touch(isCoarse);
  syncRotate();
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
bindUI('startRaceBtn', () => startRace());
bindUI('retryBtn', () => (lastPlay === 'race' ? startRace() : startGame()));
bindUI('homeBtn', backToTitle);
bindUI('resumeBtn', resume);
bindUI('quitBtn', backToTitle);
input.onEscape = () => {
  if (mode === 'run' || mode === 'race') pause();
  else if (mode === 'pause') resume();
};
input.onMute = () => {
  audio.init();
  audio.setMuted(!audio.muted);
  hud.toast(audio.muted ? '🔇 已静音' : '🔊 已开启声音', 1200);
};

// ---- 全屏 ----
const fsBtn = document.getElementById('fsBtn');
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;

async function toggleFullscreen() {
  try {
    if (!fsEl()) {
      const el = document.documentElement;
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      // 触屏设备尝试锁定横屏（部分浏览器不支持，失败无妨）
      if (isCoarse && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } else if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } catch (e) {
    hud.toast('当前浏览器不支持全屏', 1400);
  }
}

function syncFsBtn() {
  if (!fsBtn) return;
  fsBtn.textContent = fsEl() ? '⛶' : '⛶';
  fsBtn.classList.toggle('on', !!fsEl());
  fsBtn.title = fsEl() ? '退出全屏（F）' : '全屏（F）';
}

fsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fsBtn.blur();
  toggleFullscreen();
});
document.addEventListener('fullscreenchange', syncFsBtn);
document.addEventListener('webkitfullscreenchange', syncFsBtn);
input.onFullscreen = toggleFullscreen;

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
    daylight.update(0);
    stage.update(dt, stage.camera.position);
    stage.render();
    return;
  }

  // ---- 游戏进行中（run / race / 死亡演出 / over） ----
  const actions = input.consume();
  input.update();

  // 竞速倒计时：3-2-1-GO，期间所有人静止，起跑才公平
  if (mode === 'race' && raceState === 'countdown') {
    cdT -= rawDt;
    const label = cdT <= 0.45 ? 'GO' : String(Math.min(3, Math.max(1, Math.ceil(cdT))));
    if (label !== lastCd) {
      lastCd = label;
      hud.countdown(label);
      audio.ui();
    }
    if (cdT <= 0) {
      raceState = 'go';
      hud.countdown(null);
    }
  }

  const running = (mode === 'run' || (mode === 'race' && raceState === 'go')) && player.alive;

  baseSpeed = Math.min(34, 12 + dist * 0.018);
  const diff = clamp(dist / 1600, 0, 1);
  speed = baseSpeed * (odT > 0 ? 1.5 : 1) * player.speedMul;
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
    // 竞速模式以真实位置为准（掉下去被拉回来时距离会同步回退，不刷里程）
    if (mode === 'race') dist = player.pos.z;
    else dist += speed * dt;
    player.update(dt, input, city, speed, actions, odT > 0);
    // 缓降开始提示：告诉玩家可以自己决定何时落地
    const gliding = player.glideT > 0;
    if (gliding && !glideWas) hud.toast(isCoarse ? '下拉可立即落地' : 'S / ↓ 可立即落地', 1200);
    glideWas = gliding;
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
  } else if (mode === 'over' && lastPlay !== 'race') {
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

  // 世界更新：生成按最前面的对手（避免领跑的幽灵跑出已生成的地图），
  // 回收只看玩家自己——落后玩家脚下的楼顶绝不能被拆
  city.update(
    mode === 'race' ? Math.max(player.pos.z, race.maxZ()) : player.pos.z,
    player.pos.z
  );
  // 日光推进：每 400m 一档，纯视觉，不参与物理
  daylight.update(dist);
  if (mode === 'run' && daylight.phase !== lastPhase) {
    lastPhase = daylight.phase;
    hud.toast(
      ['', '落日更低了一点', '余晖褪去 · 城市亮灯', '蓝调时刻 · 霓虹亮起'][daylight.phase] || '',
      1600
    );
  }
  city.animateCoins(elapsed);
  fx.update(dt);
  audio.setWind(clamp((speed - 10) / 26, 0, 1) + (odT > 0 ? 0.15 : 0));

  // 竞速：幽灵推进 → 名次 → 终点
  if (mode === 'race') {
    race.update(running ? dt : 0, player.pos.z);
    if (raceState === 'go' && player.pos.z >= RACE_LEN) finishRace();
    else hud.board(race.rows(player.pos.z), fmtTime(race.time));
  }
  hud.hit(player.hitFlash);

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
  // 竞速模式不做回正：赛道有终点，而且回正会让各客户端的坐标错开
  if (mode !== 'race' && player.pos.z > 1200) {
    const D = 1000;
    player.pos.z -= D;
    city.rebase(D);
  }

  if (running || mode === 'run' || mode === 'race') {
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
  startRace,
  player,
  city,
  race,
  daylight,
  stage,
  get raceState() {
    return raceState;
  },
  get RACE_LEN() {
    return RACE_LEN;
  },
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
    setDist: (v) => {
      dist = v;
      daylight.update(v);
    },
  },
};

// 调试：?auto 直接开局；?sim 自动跑酷（会看路：遇缺口跳、遇横梁滑、遇障碍跳）
if (location.search.includes('auto')) {
  setTimeout(() => startGame(), 500);
}
if (location.search.includes('race')) {
  setTimeout(() => startRace(12345), 500);
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
