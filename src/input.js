// 输入：键鼠 + 触屏（左侧拖动横向移动，右侧按钮跳跃/滑铲/过载）
export class Input {
  constructor() {
    this.keys = {};
    this.axis = 0; // -1 ~ 1 横向
    this.jumpQueued = false;
    this.slideHeld = false;
    this.dashQueued = false;
    this.onEscape = null;
    this.onMute = null;
    this._touchAxis = 0;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys[k] = true;
      if (k === 'Space') {
        this.jumpQueued = true;
        e.preventDefault();
      }
      if (k === 'ShiftLeft' || k === 'ShiftRight') this.dashQueued = true;
      if (k === 'Escape' && this.onEscape) this.onEscape();
      if (k === 'KeyM' && this.onMute) this.onMute();
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => {
      this.keys = {};
    });

    // ---- 触屏 ----
    let dragId = null;
    let startX = 0;
    let t0 = 0;
    const area = document.getElementById('touchArea');
    const isTouch = matchMedia('(pointer: coarse)').matches;
    if (isTouch && area) {
      area.addEventListener(
        'touchstart',
        (e) => {
          const t = e.changedTouches[0];
          dragId = t.identifier;
          startX = t.clientX;
          t0 = performance.now();
        },
        { passive: true }
      );
      area.addEventListener(
        'touchmove',
        (e) => {
          for (const t of e.changedTouches) {
            if (t.identifier === dragId) {
              this._touchAxis = Math.max(-1, Math.min(1, (t.clientX - startX) / 70));
            }
          }
        },
        { passive: true }
      );
      const end = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === dragId) {
            // 快速轻点 = 跳跃
            if (performance.now() - t0 < 220 && Math.abs(t.clientX - startX) < 14) {
              this.jumpQueued = true;
            }
            dragId = null;
            this._touchAxis = 0;
          }
        }
      };
      area.addEventListener('touchend', end, { passive: true });
      area.addEventListener('touchcancel', end, { passive: true });

      const bindBtn = (id, down, up) => {
        const el = document.getElementById(id);
        el.addEventListener('touchstart', (e) => { e.preventDefault(); down(); }, { passive: false });
        if (up) el.addEventListener('touchend', up), el.addEventListener('touchcancel', up);
      };
      bindBtn('btnJump', () => (this.jumpQueued = true));
      bindBtn(
        'btnSlide',
        () => (this._slideTouch = true),
        () => (this._slideTouch = false)
      );
      bindBtn('btnDash', () => (this.dashQueued = true));
    }
  }

  update() {
    let a = 0;
    const k = this.keys;
    if (k.KeyA || k.ArrowLeft) a -= 1;
    if (k.KeyD || k.ArrowRight) a += 1;
    this.axis = a !== 0 ? a : this._touchAxis;
    const kbSlide = !!(k.KeyS || k.ArrowDown || k.ControlLeft);
    this.slideHeld = kbSlide || !!this._slideTouch;
  }

  // 每帧末调用：消费一次性事件
  consume() {
    const j = this.jumpQueued;
    const d = this.dashQueued;
    this.jumpQueued = false;
    this.dashQueued = false;
    return { jump: j, dash: d };
  }
}
