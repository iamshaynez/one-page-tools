import { environmentAt } from './forest-god-core';
import type { World } from './forest-god-core';
import type { WeatherKind } from './forest-god-content';

/** 《森林之神》环境音：纯 Web Audio 合成，默认静音，用户手势开启。 */
export function createForestAudio() {
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let rainGain: GainNode | null = null;
  let rainFilter: BiquadFilterNode | null = null;
  let enabled = false;
  let disposed = false;
  let daylight = 0.7;
  let weather: WeatherKind = 'clear';
  const sources: AudioScheduledSourceNode[] = [];
  const timers: number[] = [];

  function ensure(): AudioContext | null {
    if (ac) return ac;
    if (typeof window === 'undefined') return null;
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    try {
      ac = new Context();
      master = ac.createGain();
      master.gain.value = 0;
      master.connect(ac.destination);

      const buffer = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      const wind = ac.createBufferSource();
      wind.buffer = buffer;
      wind.loop = true;
      windFilter = ac.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 420;
      windFilter.Q.value = 0.45;
      windGain = ac.createGain();
      windGain.gain.value = 0;
      wind.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);

      const breath = ac.createOscillator();
      breath.frequency.value = 0.075;
      const breathGain = ac.createGain();
      breathGain.gain.value = 85;
      breath.connect(breathGain);
      breathGain.connect(windFilter.frequency);

      const rain = ac.createBufferSource();
      rain.buffer = buffer;
      rain.loop = true;
      rainFilter = ac.createBiquadFilter();
      rainFilter.type = 'highpass';
      rainFilter.frequency.value = 1100;
      const rainLp = ac.createBiquadFilter();
      rainLp.type = 'lowpass';
      rainLp.frequency.value = 7200;
      rainGain = ac.createGain();
      rainGain.gain.value = 0;
      rain.connect(rainFilter);
      rainFilter.connect(rainLp);
      rainLp.connect(rainGain);
      rainGain.connect(master);

      wind.start();
      rain.start();
      breath.start();
      sources.push(wind, rain, breath);
      return ac;
    } catch {
      if (ac) void ac.close().catch(() => undefined);
      ac = null;
      master = null;
      return null;
    }
  }

  function applyAmbience(): void {
    if (!ac) return;
    const t = ac.currentTime;
    const storm = weather === 'storm' ? 1 : 0;
    const rain = weather === 'clear' ? 0 : weather === 'storm' ? 1 : 0.58;
    windGain?.gain.setTargetAtTime(0.026 + rain * 0.018 + storm * 0.034, t, 0.8);
    windFilter?.frequency.setTargetAtTime(400 + storm * 250 + (1 - daylight) * 60, t, 1.2);
    rainGain?.gain.setTargetAtTime(rain * 0.072, t, 0.65);
    rainFilter?.frequency.setTargetAtTime(1050 + storm * 650, t, 0.8);
  }

  function fade(to: number): void {
    if (!ac || !master) return;
    const t = ac.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(to, t + (to ? 1.1 : 0.45));
  }

  function stopTimers(): void {
    for (const timer of timers.splice(0)) clearInterval(timer);
  }

  function tone(frequency: number, at: number, duration: number, level: number, end = frequency, type: OscillatorType = 'sine'): void {
    if (!ac || !master) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), at + duration * 0.8);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + Math.min(0.012, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + duration + 0.03);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  function bird(): void {
    if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime + 0.02;
    const base = 1750 + Math.random() * 1250;
    const notes = Math.random() < 0.45 ? 2 : 1;
    for (let i = 0; i < notes; i++) {
      const f = base * (1 + i * 0.12);
      tone(f, t + i * 0.15, 0.12, 0.022 * daylight, f * 1.3);
    }
  }

  function cricket(): void {
    if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime + 0.02;
    const frequency = 3900 + Math.random() * 700;
    for (let i = 0; i < 3; i++) tone(frequency, t + i * 0.072, 0.042, 0.012 * (1 - daylight));
  }

  function startTimers(): void {
    stopTimers();
    if (typeof window === 'undefined') return;
    timers.push(window.setInterval(() => {
      if (enabled && weather !== 'storm' && daylight > 0.3 && Math.random() < daylight * 0.3) bird();
    }, 2600));
    timers.push(window.setInterval(() => {
      if (enabled && daylight < 0.3 && Math.random() < (1 - daylight) * 0.5) cricket();
    }, 1200));
  }

  async function toggle(): Promise<boolean> {
    if (disposed) return false;
    if (enabled) {
      enabled = false;
      stopTimers();
      fade(0);
      return false;
    }
    const context = ensure();
    if (!context) return false;
    enabled = true;
    try {
      if (context.state === 'suspended') await context.resume();
    } catch {
      enabled = false;
      return false;
    }
    if (disposed || !enabled || ac !== context) return false;
    applyAmbience();
    fade(0.72);
    startTimers();
    return true;
  }

  function update(world: World): void {
    daylight = environmentAt(world.time).daylight;
    weather = world.weather.kind;
    if (enabled) applyAmbience();
  }

  function chime(kind: 'divine' | 'birth' | 'death' | 'click'): void {
    if (!enabled || !ac || ac.state !== 'running') return;
    const t = ac.currentTime + 0.01;
    if (kind === 'divine') {
      tone(523.25, t, 1.25, 0.065);
      tone(659.25, t + 0.1, 1.1, 0.045);
      tone(1046.5, t + 0.2, 1.5, 0.028);
    } else if (kind === 'birth') {
      tone(587.33, t, 0.48, 0.05, 659.25);
      tone(880, t + 0.11, 0.65, 0.04);
    } else if (kind === 'death') {
      tone(196, t, 0.9, 0.045, 130.81);
    } else {
      tone(740, t, 0.075, 0.035, 620, 'triangle');
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    enabled = false;
    stopTimers();
    for (const source of sources.splice(0)) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    if (ac) {
      const context = ac;
      ac = null;
      void context.close().catch(() => undefined);
    }
    master = null;
    windGain = null;
    windFilter = null;
    rainGain = null;
    rainFilter = null;
  }

  return { toggle, update, chime, dispose };
}
