import { environmentAt } from './forest-god-core';
import type { World } from './forest-god-core';
import type { WeatherKind } from './forest-god-content';

/** 《森林之神》环境音：纯 Web Audio 合成，默认静音，用户手势开启。 */
export function createForestAudio() {
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let masterFilter: BiquadFilterNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let rainGain: GainNode | null = null;
  let rainFilter: BiquadFilterNode | null = null;
  let leafGain: GainNode | null = null;
  let leafFilter: BiquadFilterNode | null = null;
  let auroraGain: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let enabled = false;
  let hidden = false;
  let disposed = false;
  let daylight = 0.7;
  let aurora = 0;
  let weather: WeatherKind = 'clear';
  let suspendTimer: number | null = null;
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
      masterFilter = ac.createBiquadFilter();
      masterFilter.type = 'lowpass';
      masterFilter.frequency.value = 18000;
      masterFilter.Q.value = 0.25;
      master.connect(masterFilter);
      masterFilter.connect(ac.destination);

      const buffer = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noiseBuffer = buffer;

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

      const leaves = ac.createBufferSource();
      leaves.buffer = buffer;
      leaves.loop = true;
      leaves.playbackRate.value = 0.81;
      leafFilter = ac.createBiquadFilter();
      leafFilter.type = 'bandpass';
      leafFilter.frequency.value = 2900;
      leafFilter.Q.value = 0.65;
      leafGain = ac.createGain();
      leafGain.gain.value = 0;
      leaves.connect(leafFilter);
      leafFilter.connect(leafGain);
      leafGain.connect(master);

      auroraGain = ac.createGain();
      auroraGain.gain.value = 0;
      auroraGain.connect(master);
      const auroraLow = ac.createOscillator();
      auroraLow.frequency.value = 196;
      const auroraLowGain = ac.createGain();
      auroraLowGain.gain.value = 0.55;
      auroraLow.connect(auroraLowGain);
      auroraLowGain.connect(auroraGain);
      const auroraHigh = ac.createOscillator();
      auroraHigh.frequency.value = 587.33;
      const auroraHighGain = ac.createGain();
      auroraHighGain.gain.value = 0.16;
      auroraHigh.connect(auroraHighGain);
      auroraHighGain.connect(auroraGain);
      const shimmer = ac.createOscillator();
      shimmer.frequency.value = 0.06;
      const shimmerGain = ac.createGain();
      shimmerGain.gain.value = 5;
      shimmer.connect(shimmerGain);
      shimmerGain.connect(auroraLow.detune);
      shimmerGain.connect(auroraHigh.detune);

      wind.start();
      rain.start(0, 1.25);
      leaves.start(0, 2.5);
      breath.start();
      auroraLow.start();
      auroraHigh.start();
      shimmer.start();
      sources.push(wind, rain, leaves, breath, auroraLow, auroraHigh, shimmer);
      return ac;
    } catch {
      for (const source of sources.splice(0)) {
        try { source.stop(); } catch { /* already stopped */ }
        source.disconnect();
      }
      if (ac) void ac.close().catch(() => undefined);
      ac = null;
      master = null;
      masterFilter = null;
      windGain = null;
      windFilter = null;
      rainGain = null;
      rainFilter = null;
      leafGain = null;
      leafFilter = null;
      auroraGain = null;
      noiseBuffer = null;
      return null;
    }
  }

  function applyAmbience(): void {
    if (!ac) return;
    const t = ac.currentTime;
    const storm = weather === 'storm' ? 1 : 0;
    const rain = weather === 'storm' ? 1 : weather === 'rain' ? 0.58 : 0;
    const mist = weather === 'mist' ? 1 : 0;
    const snow = weather === 'snow' ? 1 : 0;
    const night = 1 - daylight;
    const snowNight = snow * (0.35 + night * 0.65);
    windGain?.gain.setTargetAtTime(0.026 + rain * 0.018 + storm * 0.034 + mist * 0.006 + snow * 0.004, t, 0.8);
    windFilter?.frequency.setTargetAtTime(400 + storm * 250 + night * 60 - mist * 85 - snow * 65, t, 1.2);
    rainGain?.gain.setTargetAtTime(rain * 0.068, t, 0.65);
    rainFilter?.frequency.setTargetAtTime(1050 + storm * 650, t, 0.8);
    leafGain?.gain.setTargetAtTime(rain * (0.018 + storm * 0.007), t, 0.7);
    leafFilter?.frequency.setTargetAtTime(2650 + storm * 650 + daylight * 250, t, 1);
    masterFilter?.frequency.setTargetAtTime(Math.max(4200, 18000 - snowNight * 12500 - mist * 1700), t, 1.4);
    auroraGain?.gain.setTargetAtTime(aurora * (0.003 + night * 0.007), t, 1.6);
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

  function clearSuspendTimer(): void {
    if (suspendTimer === null) return;
    clearTimeout(suspendTimer);
    suspendTimer = null;
  }

  function scheduleSuspend(context: AudioContext): void {
    clearSuspendTimer();
    if (typeof window === 'undefined') return;
    suspendTimer = window.setTimeout(() => {
      suspendTimer = null;
      if (disposed || !hidden || ac !== context) return;
      void context.suspend().catch(() => undefined);
    }, 500);
  }

  function releaseSource(source: AudioScheduledSourceNode): void {
    const index = sources.indexOf(source);
    if (index >= 0) sources.splice(index, 1);
  }

  function tone(frequency: number, at: number, duration: number, level: number, end = frequency, type: OscillatorType = 'sine'): void {
    if (disposed || !enabled || hidden || !ac || !master) return;
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
    sources.push(osc);
    osc.start(at);
    osc.stop(at + duration + 0.03);
    osc.onended = () => {
      releaseSource(osc);
      osc.disconnect();
      gain.disconnect();
    };
  }

  function thunder(): void {
    if (disposed || !enabled || hidden || !ac || ac.state !== 'running' || !master || !noiseBuffer) return;
    const t = ac.currentTime + 0.02;
    const duration = 2.5 + Math.random() * 0.9;
    const source = ac.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    source.playbackRate.value = 0.55;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(250, t);
    filter.frequency.exponentialRampToValueAtTime(95, t + duration);
    const gain = ac.createGain();
    const peak = 0.026 + Math.random() * 0.01;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.18);
    gain.gain.exponentialRampToValueAtTime(peak * 0.45, t + 0.75);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    sources.push(source);
    source.start(t, Math.random() * noiseBuffer.duration);
    source.stop(t + duration + 0.03);
    source.onended = () => {
      releaseSource(source);
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  function bird(): void {
    if (!enabled || hidden || !ac || ac.state !== 'running') return;
    const t = ac.currentTime + 0.02;
    const base = 1750 + Math.random() * 1250;
    const notes = Math.random() < 0.45 ? 2 : 1;
    for (let i = 0; i < notes; i++) {
      const f = base * (1 + i * 0.12);
      tone(f, t + i * 0.15, 0.12, 0.022 * daylight, f * 1.3);
    }
  }

  function cricket(): void {
    if (!enabled || hidden || !ac || ac.state !== 'running') return;
    const t = ac.currentTime + 0.02;
    const frequency = 3900 + Math.random() * 700;
    for (let i = 0; i < 3; i++) tone(frequency, t + i * 0.072, 0.042, 0.012 * (1 - daylight));
  }

  function startTimers(): void {
    stopTimers();
    if (disposed || !enabled || hidden || typeof window === 'undefined') return;
    timers.push(window.setInterval(() => {
      const chance = weather === 'clear' ? 0.3 : 0.12;
      if (enabled && !hidden && weather !== 'storm' && weather !== 'snow' && daylight > 0.3 && Math.random() < daylight * chance) bird();
    }, 2600));
    timers.push(window.setInterval(() => {
      if (enabled && !hidden && (weather === 'clear' || weather === 'mist') && daylight < 0.3 && Math.random() < (1 - daylight) * 0.5) cricket();
    }, 1200));
    timers.push(window.setInterval(() => {
      if (enabled && !hidden && weather === 'storm' && Math.random() < 0.3) thunder();
    }, 6800));
  }

  async function restore(context: AudioContext): Promise<void> {
    try {
      await context.resume();
    } catch {
      return;
    }
    if (disposed || !enabled || ac !== context) return;
    applyAmbience();
    if (hidden) {
      fade(0);
      scheduleSuspend(context);
      return;
    }
    fade(0.72);
    startTimers();
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
    if (hidden) {
      applyAmbience();
      fade(0);
      scheduleSuspend(context);
      return true;
    }
    try {
      if (context.state !== 'running') await context.resume();
    } catch {
      enabled = false;
      fade(0);
      return false;
    }
    if (disposed || !enabled || ac !== context) return false;
    applyAmbience();
    if (hidden) {
      fade(0);
      scheduleSuspend(context);
      return true;
    }
    fade(0.72);
    startTimers();
    return true;
  }

  function update(world: World): void {
    daylight = environmentAt(world.time).daylight;
    weather = world.weather.kind;
    aurora = Number.isFinite(world.aurora) ? Math.min(1, Math.max(0, world.aurora)) : 0;
    if (enabled) applyAmbience();
  }

  function chime(kind: 'divine' | 'birth' | 'death' | 'click' | 'bond' | 'milestone' | 'thunder'): void {
    if (!enabled || hidden || !ac || ac.state !== 'running') return;
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
    } else if (kind === 'bond') {
      tone(392, t, 0.75, 0.04, 440);
      tone(523.25, t + 0.12, 0.9, 0.035);
      tone(659.25, t + 0.26, 1, 0.025);
    } else if (kind === 'milestone') {
      tone(523.25, t, 0.85, 0.045);
      tone(659.25, t + 0.09, 0.95, 0.04);
      tone(783.99, t + 0.18, 1.1, 0.035);
      tone(1046.5, t + 0.32, 1.35, 0.025);
    } else if (kind === 'thunder') {
      thunder();
    } else {
      tone(740, t, 0.075, 0.035, 620, 'triangle');
    }
  }

  function setHidden(nextHidden: boolean): void {
    if (disposed || hidden === nextHidden) return;
    hidden = nextHidden;
    stopTimers();
    const context = ac;
    if (!context) return;
    if (hidden) {
      fade(0);
      scheduleSuspend(context);
      return;
    }
    clearSuspendTimer();
    if (enabled) void restore(context);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    enabled = false;
    stopTimers();
    clearSuspendTimer();
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
    masterFilter = null;
    windGain = null;
    windFilter = null;
    rainGain = null;
    rainFilter = null;
    leafGain = null;
    leafFilter = null;
    auroraGain = null;
    noiseBuffer = null;
  }

  return { toggle, update, chime, setHidden, dispose };
}
