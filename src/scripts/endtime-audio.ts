/**
 * 《时间的尽头》环境音 — Web Audio 纯合成，零素材。
 * 低频群鸣（两台失谐正弦 + 纯五度）× 风噪 × 偶发深钟；
 * 倒流时一切声音向下俯冲。默认静音，进馆自己开。
 */
export class EndOfTimeAudio {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private riserGain: GainNode | null = null;
  private riserOsc: OscillatorNode | null = null;
  private enabled = false;

  get running(): boolean {
    return this.enabled;
  }

  /** 用户手势里调用（浏览器自动播放策略） */
  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) this.start();
    else this.stop();
    return this.enabled;
  }

  private ensure(): AudioContext {
    if (!this.ac) {
      this.ac = new AudioContext();
      this.master = this.ac.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ac.destination);
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
    return this.ac;
  }

  private start() {
    const ac = this.ensure();
    const t = ac.currentTime;
    this.master!.gain.cancelScheduledValues(t);
    this.master!.gain.setValueAtTime(this.master!.gain.value, t);
    this.master!.gain.linearRampToValueAtTime(0.9, t + 2.2);

    if (!this.droneGain) {
      // ---- 群鸣：55Hz ± 失谐 + 纯五度 82.4Hz，低通压暗 ----
      this.droneGain = ac.createGain();
      this.droneGain.gain.value = 0.16;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 240;
      this.droneGain.connect(lp); lp.connect(this.master!);
      for (const [freq, level] of [[55, 0.5], [55.6, 0.42], [82.41, 0.3], [110.3, 0.14]] as const) {
        const osc = ac.createOscillator();
        osc.type = 'sine'; osc.frequency.value = freq;
        const g = ac.createGain(); g.gain.value = level;
        // 极慢的幅度呼吸，各自相位错开
        const lfo = ac.createOscillator();
        lfo.frequency.value = 0.05 + freq * 0.0006;
        const lfoG = ac.createGain(); lfoG.gain.value = level * 0.4;
        lfo.connect(lfoG); lfoG.connect(g.gain);
        osc.connect(g); g.connect(this.droneGain);
        osc.start(); lfo.start();
      }
      // ---- 风噪：带通白噪，中心频率缓慢游走 ----
      const wind = ac.createBufferSource();
      const buf = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      wind.buffer = buf; wind.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 0.7;
      const wg = ac.createGain(); wg.gain.value = 0.05;
      const wlfo = ac.createOscillator(); wlfo.frequency.value = 0.06;
      const wlfoG = ac.createGain(); wlfoG.gain.value = 180;
      wlfo.connect(wlfoG); wlfoG.connect(bp.frequency);
      wind.connect(bp); bp.connect(wg); wg.connect(this.master!);
      wind.start(); wlfo.start();
    }
  }

  private stop() {
    if (!this.ac || !this.master) return;
    const t = this.ac.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.8);
  }

  /** 点击涟漪时的深钟（正弦 + 五度泛音，指数衰减） */
  bell() {
    if (!this.enabled || !this.ac || !this.master) return;
    const ac = this.ac, t = ac.currentTime;
    const base = pick([196, 220, 261.6, 293.7]);
    for (const [freq, level, dur] of [
      [base, 0.24, 4.2],
      [base * 2.01, 0.1, 2.6],
      [base * 2.99, 0.05, 1.4],
    ] as const) {
      const osc = ac.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.1);
    }
  }

  /** 倒流起势：锯齿波向下俯冲 + 胸腔轰鸣 */
  reversal(on: boolean) {
    if (!this.enabled || !this.ac || !this.master) return;
    const ac = this.ac, t = ac.currentTime;
    if (on) {
      if (this.riserOsc) return;
      this.riserGain = ac.createGain();
      this.riserGain.gain.setValueAtTime(0, t);
      this.riserGain.gain.linearRampToValueAtTime(0.14, t + 0.9);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 420;
      this.riserGain.connect(lp); lp.connect(this.master);
      this.riserOsc = ac.createOscillator();
      this.riserOsc.type = 'sawtooth';
      this.riserOsc.frequency.setValueAtTime(88, t);
      this.riserOsc.frequency.exponentialRampToValueAtTime(36, t + 1.6);
      this.riserOsc.connect(this.riserGain);
      this.riserOsc.start();
    } else if (this.riserOsc && this.riserGain) {
      const osc = this.riserOsc, g = this.riserGain;
      this.riserOsc = null; this.riserGain = null;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.7);
      osc.stop(t + 0.8);
    }
  }
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
