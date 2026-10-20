// HUD 与界面状态
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'),
      dist: $('dist'),
      best: $('best'),
      coins: $('coins'),
      energyFill: $('energyFill'),
      odHint: $('odHint'),
      toast: $('toast'),
      title: $('title'),
      over: $('over'),
      pause: $('pause'),
      speedlines: $('speedlines'),
      finalDist: $('finalDist'),
      finalCoins: $('finalCoins'),
      finalBest: $('finalBest'),
      newRecord: $('newRecord'),
      deathLabel: $('deathLabel'),
      touchUI: $('touchUI'),
      gestureHint: $('gestureHint'),
      dashBtn: $('btnDash'),
      raceBoard: $('raceBoard'),
      countdown: $('countdown'),
      hitFlash: $('hitFlash'),
      f1l: $('f1l'),
      f2l: $('f2l'),
      f3l: $('f3l'),
      f1u: $('f1u'),
      f3u: $('f3u'),
    };
    this._toastT = null;
    this._hintT = null;
    this._lastDist = -1;
    this._boardKey = '';
  }

  hud(dist, best, coins, energy, odActive, odCd = 0) {
    const d = dist | 0;
    if (d !== this._lastDist) {
      this.el.dist.textContent = d;
      this._lastDist = d;
    }
    this.el.best.textContent = best;
    this.el.coins.textContent = coins;
    this.el.energyFill.style.width = `${Math.min(100, energy)}%`;
    const cooling = odCd > 0;
    this.el.energyFill.classList.toggle('cooling', cooling);
    this.el.energyFill.classList.toggle('ready', energy >= 50 && !odActive && !cooling);
    this.el.odHint.classList.toggle('ready', energy >= 50 && !odActive && !cooling);
    this.el.odHint.textContent = cooling ? `过载冷却 ${Math.ceil(odCd)}s` : '过载就绪 · SHIFT';
    // 触屏冲刺按钮状态
    if (this.el.dashBtn) {
      this.el.dashBtn.classList.toggle('ready', energy >= 50 && !odActive && !cooling);
      this.el.dashBtn.classList.toggle('cool', cooling || odActive);
    }
  }

  speedFx(on) {
    this.el.speedlines.classList.toggle('on', on);
  }

  // ---- 竞速模式 ----
  race(on) {
    this.el.raceBoard.classList.toggle('on', on);
    this._boardKey = '';
  }

  // 名次表：只有内容变化时才重建 DOM（每帧 innerHTML 会掉帧）
  board(rows, timeStr) {
    const me = rows.find((r) => r.me);
    const key = rows.map((r) => `${r.place}${r.gap}`).join('|') + timeStr;
    if (key === this._boardKey) return;
    this._boardKey = key;
    let html = `<div class="race-head"><span>${timeStr}</span><b>${me ? me.place : 1}/${rows.length}</b></div>`;
    for (const r of rows) {
      html +=
        `<div class="race-row${r.me ? ' me' : ''}" style="--c:${r.color}">` +
        `<b>${r.place}</b><i></i><span>${r.name}</span><em>${r.gap}</em></div>`;
    }
    this.el.raceBoard.innerHTML = html;
  }

  countdown(text) {
    if (text === null) {
      this.el.countdown.classList.remove('on');
      return;
    }
    this.el.countdown.textContent = text;
    this.el.countdown.classList.add('on');
  }

  // 受击红边：强度直接给 0~1
  hit(v) {
    this.el.hitFlash.style.opacity = v < 0.02 ? '0' : (v * 0.62).toFixed(2);
  }

  touch(on) {
    this.el.touchUI.classList.toggle('on', on);
    document.getElementById('touchArea').classList.toggle('on', on);
    // 首次上手：亮出手势提示 5 秒
    if (on && this.el.gestureHint) {
      const seen = sessionStorage.getItem('sr-touch-seen');
      if (!seen) {
        sessionStorage.setItem('sr-touch-seen', '1');
        this.el.gestureHint.classList.add('show');
        clearTimeout(this._hintT);
        this._hintT = setTimeout(() => this.el.gestureHint.classList.remove('show'), 5000);
      }
    } else if (this.el.gestureHint) {
      this.el.gestureHint.classList.remove('show');
    }
  }

  showScreen(name) {
    for (const k of ['title', 'over', 'pause']) {
      this.el[k].classList.toggle('visible', k === name);
    }
    this.el.hud.classList.toggle('hidden', name === 'title');
    if (name === 'title') this.race(false);
  }

  setDeath(type) {
    this.el.deathLabel.textContent =
      type === 'fall' ? '你坠入了楼与楼之间的黄昏' : '你撞上了天台上的障碍物';
  }

  setFinal(dist, coins, best, isNew) {
    this.el.f1l.textContent = '奔跑距离';
    this.el.f2l.textContent = '芯片';
    this.el.f3l.textContent = '最佳';
    this.el.f1u.textContent = 'm';
    this.el.f3u.textContent = 'm';
    this.el.finalDist.textContent = dist | 0;
    this.el.finalCoins.textContent = coins;
    this.el.finalBest.textContent = best;
    this.el.newRecord.classList.toggle('visible', isNew);
  }

  // 竞速结算：名次 / 用时 / 芯片
  setRaceResult(place, total, timeStr, coins, isBest) {
    this.el.deathLabel.textContent =
      place === 1 ? '冠军 · 第一个冲过终点线' : `第 ${place} 名 · 只差一点`;
    this.el.f1l.textContent = '名次';
    this.el.f2l.textContent = '用时';
    this.el.f3l.textContent = '芯片';
    this.el.f1u.textContent = '';
    this.el.f3u.textContent = '';
    this.el.finalDist.textContent = `${place}/${total}`;
    this.el.finalCoins.textContent = timeStr;
    this.el.finalBest.textContent = coins;
    this.el.newRecord.textContent = '★ 最佳用时 ★';
    this.el.newRecord.classList.toggle('visible', !!isBest);
  }

  toast(msg, ms = 1800) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }
}
