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
    };
    this._toastT = null;
    this._lastDist = -1;
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
  }

  speedFx(on) {
    this.el.speedlines.classList.toggle('on', on);
  }

  touch(on) {
    this.el.touchUI.classList.toggle('on', on);
  }

  showScreen(name) {
    for (const k of ['title', 'over', 'pause']) {
      this.el[k].classList.toggle('visible', k === name);
    }
    this.el.hud.classList.toggle('hidden', name === 'title');
  }

  setDeath(type) {
    this.el.deathLabel.textContent =
      type === 'fall' ? '你坠入了楼与楼之间的黄昏' : '你撞上了天台上的障碍物';
  }

  setFinal(dist, coins, best, isNew) {
    this.el.finalDist.textContent = dist | 0;
    this.el.finalCoins.textContent = coins;
    this.el.finalBest.textContent = best;
    this.el.newRecord.classList.toggle('visible', isNew);
  }

  toast(msg, ms = 1800) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }
}
