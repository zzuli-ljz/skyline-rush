// 全程序化音频：风声、脚步、跳跃、落地、芯片、坠楼、过载、撞击
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.streak = 0;
  }

  // 必须在用户手势后调用
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    // 白噪声缓冲
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 循环风声（低通噪声，音量/亮度随速度变化）
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = this.noiseBuf;
    this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.windSrc.start();

    // 远处城市低鸣
    this.hum = ctx.createOscillator();
    this.hum.type = 'sine';
    this.hum.frequency.value = 55;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.028;
    this.hum.connect(this.humGain).connect(this.master);
    this.hum.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  // speedNorm: 0~1
  setWind(speedNorm) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.windFilter.frequency.setTargetAtTime(400 + speedNorm * 1600, t, 0.2);
    this.windGain.gain.setTargetAtTime(0.03 + speedNorm * 0.14, t, 0.2);
  }

  _noise(dur, filterType, f0, f1, vol, q = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const flt = ctx.createBiquadFilter();
    flt.type = filterType;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _tone(type, f0, f1, dur, vol, delay = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  footstep() {
    this._noise(0.09, 'bandpass', 260 + Math.random() * 140, 120, 0.16, 1.4);
  }

  jump() {
    this._noise(0.22, 'highpass', 500, 2400, 0.1);
    this._tone('sine', 300, 520, 0.16, 0.07);
  }

  land(hard = false) {
    this._tone('sine', hard ? 120 : 95, 45, 0.14, hard ? 0.3 : 0.18);
    this._noise(0.12, 'lowpass', 900, 200, hard ? 0.24 : 0.13);
  }

  slide() {
    this._noise(0.3, 'lowpass', 1600, 500, 0.14);
  }

  coin(streak) {
    const scale = [523, 587, 659, 784, 880, 1047];
    const f = scale[Math.min(streak, scale.length - 1)];
    this._tone('sine', f, f, 0.16, 0.16);
    this._tone('sine', f * 2, f * 2, 0.1, 0.05, 0.02);
  }

  smash() {
    this._noise(0.25, 'lowpass', 2200, 300, 0.34);
    this._tone('square', 160, 60, 0.18, 0.12);
  }

  crash() {
    this._noise(0.5, 'lowpass', 1400, 120, 0.5);
    this._tone('sawtooth', 220, 50, 0.5, 0.28);
  }

  fall() {
    // 坠楼：风声骤增 + 下坠滑音
    this._tone('sine', 600, 90, 1.4, 0.14);
    this._noise(1.4, 'lowpass', 3000, 300, 0.3);
  }

  overdrive() {
    this._tone('sawtooth', 180, 720, 0.45, 0.16);
    this._tone('sine', 1200, 1600, 0.6, 0.06, 0.1);
    this._noise(0.5, 'highpass', 800, 3500, 0.12);
  }

  ui() {
    this._tone('sine', 660, 660, 0.07, 0.08);
  }
}
