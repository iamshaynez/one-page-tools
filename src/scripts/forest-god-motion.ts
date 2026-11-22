import type { WeatherKind } from './forest-god-content';

export interface WeatherVisual {
  cloud: number;
  rain: number;
  snow: number;
  mist: number;
  storm: number;
  aurora: number;
  gust: number;
}

type WeatherTargets = Omit<WeatherVisual, 'aurora'>;

const WEATHER_TAU = 0.45;
const AURORA_TAU = 1.4;

const WEATHER_TARGETS: Record<WeatherKind, WeatherTargets> = {
  clear: { cloud: 0, rain: 0, snow: 0, mist: 0, storm: 0, gust: 0 },
  rain: { cloud: 0.65, rain: 0.85, snow: 0, mist: 0, storm: 0, gust: 0 },
  storm: { cloud: 1, rain: 1, snow: 0, mist: 0, storm: 1, gust: 1 },
  mist: { cloud: 0.4, rain: 0, snow: 0, mist: 1, storm: 0, gust: 0 },
  snow: { cloud: 0.7, rain: 0, snow: 0.9, mist: 0, storm: 0, gust: 0 },
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return value === Infinity ? 1 : 0;
  return Math.min(1, Math.max(0, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Exponential damping with a time constant in seconds. A non-positive tau snaps to the target. */
export function damp(current: number, target: number, dt: number, tau: number): number {
  if (!(dt > 0)) return current;
  if (!(tau > 0)) return target;
  if (dt === Infinity) return target;
  if (tau === Infinity) return current;
  return lerp(current, target, -Math.expm1(-dt / tau));
}

export function interpolatePosition(
  previous: { x: number; y: number },
  current: { x: number; y: number },
  alpha: number,
): { x: number; y: number } {
  const t = clamp01(alpha);
  return { x: lerp(previous.x, current.x, t), y: lerp(previous.y, current.y, t) };
}

export function createWeatherVisual(): WeatherVisual {
  return { cloud: 0, rain: 0, snow: 0, mist: 0, storm: 0, aurora: 0, gust: 0 };
}

/** Mutates and returns visual. Aurora has its own intensity and slower fade, independent of weather. */
export function updateWeatherVisual(
  visual: WeatherVisual,
  weather: WeatherKind,
  aurora: number,
  dt: number,
): WeatherVisual {
  const target = WEATHER_TARGETS[weather];
  const settle = (current: number, destination: number): number => (
    clamp01(damp(clamp01(current), destination, dt, WEATHER_TAU))
  );

  visual.cloud = settle(visual.cloud, target.cloud);
  visual.rain = settle(visual.rain, target.rain);
  visual.snow = settle(visual.snow, target.snow);
  visual.mist = settle(visual.mist, target.mist);
  visual.storm = settle(visual.storm, target.storm);
  visual.gust = settle(visual.gust, target.gust);
  visual.aurora = clamp01(damp(clamp01(visual.aurora), clamp01(aurora), dt, AURORA_TAU));
  return visual;
}
