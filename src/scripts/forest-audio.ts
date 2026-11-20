/**
 * 《深林》环境音 — 全部合成，零素材
 * 风（带通噪声 · 呼吸 LFO）· 水声（高通噪声 · 按邻近度）
 * · 鸟鸣（日间偶发双音）· 虫声（暮色脉冲）
 */
export class ForestAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private cricketGain: GainNode | null = null;
  private birdTimer: ReturnType<typeof setTimeout> | undefined;
  private on = false;
  private day = 0.55;
  private water = 0;

  toggle(): boolean {
    if (this.on) {
      this.stop();
      return false;
    }
    this.start();
    return true;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private start() {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = this.ctx = new Ctx();
    const master = this.master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.6);

    const noise = this.noiseBuffer(ctx);

    // 风：带通噪声，慢呼吸
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noise; windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass'; windFilter.frequency.value = 480; windFilter.Q.value = 0.55;
    const windGain = this.windGain = ctx.createGain();
    windGain.gain.value = 0.16;
    windSrc.connect(windFilter).connect(windGain).connect(master);
    windSrc.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.07;
    lfo.connect(lfoAmt).connect(windGain.gain);
    lfo.start();

    // 水声：高通噪声，音量由邻近度驱动
    const waterSrc = ctx.createBufferSource();
    waterSrc.buffer = noise; waterSrc.loop = true; waterSrc.playbackRate.value = 1.3;
    const waterFilter = ctx.createBiquadFilter();
    waterFilter.type = 'highpass'; waterFilter.frequency.value = 800;
    const waterGain = this.waterGain = ctx.createGain();
    waterGain.gain.value = 0;
    waterSrc.connect(waterFilter).connect(waterGain).connect(master);
    waterSrc.start();

    // 虫声：暮色脉冲（4.3kHz 载波 × 17Hz 颤）
    const cricket = ctx.createOscillator();
    cricket.type = 'triangle'; cricket.frequency.value = 4300;
    const trem = ctx.createGain();
    const tremLfo = ctx.createOscillator();
    tremLfo.frequency.value = 17;
    const tremAmt = ctx.createGain();
    tremAmt.gain.value = 0.5;
    tremLfo.connect(tremAmt).connect(trem.gain);
    trem.gain.value = 0.5;
    const cricketGain = this.cricketGain = ctx.createGain();
    cricketGain.gain.value = 0;
    cricket.connect(trem).connect(cricketGain).connect(master);
    cricket.start(); tremLfo.start();

    this.on = true;
    this.scheduleBird();
  }

  private stop() {
    this.on = false;
    if (this.birdTimer) clearTimeout(this.birdTimer);
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master?.gain.linearRampToValueAtTime(0, t + 0.5);
      setTimeout(() => void this.ctx?.close().catch(() => {}), 700);
      this.ctx = null;
    }
  }

  /** 鸟鸣：两三个短促下滑音（FM 味道用 pitch 包络近似） */
  private scheduleBird() {
    if (!this.on || !this.ctx || !this.master) return;
    const wait = 4000 + Math.random() * 9000;
    this.birdTimer = setTimeout(() => {
      if (this.day < 0.72 && this.ctx && this.master) {
        const ctx = this.ctx;
        const notes = 2 + Math.floor(Math.random() * 2);
        let at = ctx.currentTime + 0.05;
        const base = 2300 + Math.random() * 900;
        for (let i = 0; i < notes; i++) {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          const g = ctx.createGain();
          osc.frequency.setValueAtTime(base + i * 190, at);
          osc.frequency.exponentialRampToValueAtTime(base * 0.72 + i * 120, at + 0.16);
          g.gain.setValueAtTime(0, at);
          g.gain.linearRampToValueAtTime(0.05, at + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0008, at + 0.22);
          osc.connect(g).connect(this.master!);
          osc.start(at); osc.stop(at + 0.26);
          at += 0.24 + Math.random() * 0.1;
        }
      }
      this.scheduleBird();
    }, wait);
  }

  /** 每帧：水域邻近度 0..1（河 + 瀑布加权）与时段 */
  setEnv(water: number, falls: number, day: number) {
    if (!this.on || !this.ctx) return;
    this.day = day;
    const t = this.ctx.currentTime;
    const target = Math.min(0.34, water * 0.1 + falls * 0.34);
    this.waterGain?.gain.setTargetAtTime(target, t, 0.4);
    this.cricketGain?.gain.setTargetAtTime(day > 0.78 ? 0.028 * (day - 0.78) / 0.22 : 0, t, 1.2);
    this.windGain?.gain.setTargetAtTime(0.13 + day * 0.05, t, 0.8);
    void this.water;
  }

  chime() {
    if (!this.on || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + 0.9);
    osc.connect(g).connect(this.master);
    osc.start(); osc.stop(ctx.currentTime + 1);
  }
}
