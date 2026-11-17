/**
 * 《宇宙漫游》环境音 — Web Audio 纯合成，零素材。
 * 深空底噪（低频群鸣）+ 随航速起伏的星尘风 + 发现彩蛋的钟音。
 * 默认静音，用户手势开启。
 */
export class CosmosAudio {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windBp: BiquadFilterNode | null = null;
  private enabled = false;

  get running(): boolean {
    return this.enabled;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) this.start();
    else this.fade(0);
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
    this.fade(0.85);
    if (this.windGain) return;
    // 深空底噪：失谐正弦群
    for (const [freq, level] of [[36.7, 0.4], [37.1, 0.34], [55.0, 0.22]] as const) {
      const osc = ac.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const g = ac.createGain(); g.gain.value = level * 0.4;
      osc.connect(g); g.connect(this.master!);
      osc.start();
    }
    // 星尘风：带通噪声，随航速起伏（scene 每帧调 setWind）
    const buf = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf; src.loop = true;
    this.windBp = ac.createBiquadFilter();
    this.windBp.type = 'bandpass'; this.windBp.frequency.value = 500; this.windBp.Q.value = 0.8;
    this.windGain = ac.createGain();
    this.windGain.gain.value = 0.02;
    src.connect(this.windBp); this.windBp.connect(this.windGain); this.windGain.connect(this.master!);
    src.start();
  }

  private fade(to: number) {
    if (!this.ac || !this.master) return;
    const t = this.ac.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(to, t + 1.2);
  }

  /** 航速 → 星尘风强度与音色 */
  setWind(speed01: number) {
    if (!this.enabled || !this.ac || !this.windGain || !this.windBp) return;
    const t = this.ac.currentTime;
    this.windGain.gain.setTargetAtTime(0.015 + speed01 * 0.1, t, 0.4);
    this.windBp.frequency.setTargetAtTime(400 + speed01 * 900, t, 0.5);
  }

  /** 发现彩蛋：明亮钟音 */
  chime() {
    if (!this.enabled || !this.ac || !this.master) return;
    const ac = this.ac, t = ac.currentTime;
    for (const [freq, level, dur] of [[880, 0.16, 2.2], [1320, 0.08, 1.6], [1760, 0.04, 1.1]] as const) {
      const osc = ac.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0003, t + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.1);
    }
  }
}
