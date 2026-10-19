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
    this.onFullscreen = null;
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
      if (k === 'KeyF' && this.onFullscreen) this.onFullscreen();
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => {
      this.keys = {};
    });

    // ---- 触屏手势 ----
    // 全屏滑动层：左右滑动转向（相对起点位移，60px 满舵）
    //            上滑 = 跳；下滑按住 = 滑铲；轻点 = 跳
    // 右下角圆形按钮只保留"冲刺"，不再挤三个圆钮
    const isTouch = matchMedia('(pointer: coarse)').matches;
    this.isTouch = isTouch;
    const area = document.getElementById('touchArea');
    if (isTouch && area) {
      const clamp1 = (v) => Math.max(-1, Math.min(1, v));
      let id = null;
      let x0 = 0;
      let y0 = 0;
      let t0 = 0;
      let jumped = false;
      area.addEventListener(
        'touchstart',
        (e) => {
          if (id !== null) return;
          const t = e.changedTouches[0];
          id = t.identifier;
          x0 = t.clientX;
          y0 = t.clientY;
          t0 = performance.now();
          jumped = false;
        },
        { passive: true }
      );
      area.addEventListener(
        'touchmove',
        (e) => {
          for (const t of e.changedTouches) {
            if (t.identifier !== id) continue;
            const dx = t.clientX - x0;
            const dy = t.clientY - y0;
            this._touchAxis = clamp1(dx / 60);
            // 上滑跳跃：一次手势只触发一次
            if (!jumped && dy < -42 && Math.abs(dy) > Math.abs(dx) * 1.2) {
              jumped = true;
              this.jumpQueued = true;
            }
            // 往下拉并按住 = 持续滑铲
            this._slideTouch = dy > 34 && Math.abs(dy) > Math.abs(dx) * 0.8;
          }
        },
        { passive: true }
      );
      const end = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== id) continue;
          const dt = performance.now() - t0;
          const dx = t.clientX - x0;
          const dy = t.clientY - y0;
          // 原地轻点 = 跳
          if (!jumped && dt < 220 && Math.hypot(dx, dy) < 18) this.jumpQueued = true;
          id = null;
          this._touchAxis = 0;
          this._slideTouch = false;
        }
      };
      area.addEventListener('touchend', end, { passive: true });
      area.addEventListener('touchcancel', end, { passive: true });

      const dashBtn = document.getElementById('btnDash');
      if (dashBtn) {
        dashBtn.addEventListener(
          'touchstart',
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dashQueued = true;
          },
          { passive: false }
        );
      }
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
