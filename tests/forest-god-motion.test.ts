import { describe, expect, it } from 'vitest';
import type { WeatherKind } from '../src/scripts/forest-god-content';
import {
  createWeatherVisual, damp, interpolatePosition, lerp, updateWeatherVisual,
} from '../src/scripts/forest-god-motion';
import type { WeatherVisual } from '../src/scripts/forest-god-motion';

describe('forest god motion interpolation', () => {
  it('lerps coordinates and clamps interpolation alpha at both snapshots', () => {
    const previous = { x: -10, y: 20 };
    const current = { x: 10, y: 40 };

    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(interpolatePosition(previous, current, 0.25)).toEqual({ x: -5, y: 25 });
    expect(interpolatePosition(previous, current, -1)).toEqual(previous);
    expect(interpolatePosition(previous, current, 2)).toEqual(current);
    expect(interpolatePosition(previous, current, NaN)).toEqual(previous);
  });

  it('damps identically across different frame rates', () => {
    const start = 0.2;
    const target = 0.9;
    const tau = 0.3;
    let stepped = start;
    for (let frame = 0; frame < 240; frame += 1) {
      stepped = damp(stepped, target, 1 / 240, tau);
    }

    const single = damp(start, target, 1, tau);
    expect(stepped).toBeCloseTo(single, 12);
    expect(single).toBeCloseTo(target + (start - target) * Math.exp(-1 / tau), 12);
  });

  it('does not advance with non-positive dt and can snap for reduced motion', () => {
    expect(damp(0.2, 0.9, 0, 0.3)).toBe(0.2);
    expect(damp(0.2, 0.9, -1, 0.3)).toBe(0.2);
    expect(damp(0.2, 0.9, 1 / 60, 0)).toBe(0.9);
    expect(damp(0.2, 0.9, 1 / 60, -1)).toBe(0.9);
  });
});

describe('forest god weather visuals', () => {
  it('creates an independent, fully cleared visual state', () => {
    const a = createWeatherVisual();
    const b = createWeatherVisual();
    expect(a).toEqual({ cloud: 0, rain: 0, snow: 0, mist: 0, storm: 0, aurora: 0, gust: 0 });
    expect(a).not.toBe(b);
  });

  it('reaches every weather target, including channels that must fade out', () => {
    const cases: Array<[WeatherKind, Omit<WeatherVisual, 'aurora'>]> = [
      ['clear', { cloud: 0, rain: 0, snow: 0, mist: 0, storm: 0, gust: 0 }],
      ['rain', { cloud: 0.65, rain: 0.85, snow: 0, mist: 0, storm: 0, gust: 0 }],
      ['storm', { cloud: 1, rain: 1, snow: 0, mist: 0, storm: 1, gust: 1 }],
      ['mist', { cloud: 0.4, rain: 0, snow: 0, mist: 1, storm: 0, gust: 0 }],
      ['snow', { cloud: 0.7, rain: 0, snow: 0.9, mist: 0, storm: 0, gust: 0 }],
    ];

    for (const [weather, target] of cases) {
      const visual: WeatherVisual = { cloud: 1, rain: 1, snow: 1, mist: 1, storm: 1, aurora: 1, gust: 1 };
      const result = updateWeatherVisual(visual, weather, 0, 1_000_000);
      expect(result, weather).toBe(visual);
      expect(visual, weather).toEqual({ ...target, aurora: 0 });
    }
  });

  it('fades aurora independently while weather continues to change', () => {
    const lit = createWeatherVisual();
    const dark = createWeatherVisual();
    updateWeatherVisual(lit, 'rain', 1, 0.5);
    updateWeatherVisual(dark, 'rain', 0, 0.5);

    expect(lit.aurora).toBeGreaterThan(0);
    expect(lit.aurora).toBeLessThan(1);
    expect(dark.aurora).toBe(0);
    expect(lit.cloud).toBe(dark.cloud);
    expect(lit.rain).toBe(dark.rain);

    const beforeFade = lit.aurora;
    updateWeatherVisual(lit, 'storm', 0, 0.5);
    expect(lit.aurora).toBeGreaterThan(0);
    expect(lit.aurora).toBeLessThan(beforeFade);
    expect(lit.storm).toBeGreaterThan(0);
  });

  it('keeps every channel finite and clamped after a very large dt', () => {
    const visual: WeatherVisual = {
      cloud: NaN, rain: Infinity, snow: -Infinity, mist: 4, storm: -3, aurora: NaN, gust: 2,
    };
    updateWeatherVisual(visual, 'storm', 2, 1_000_000_000);

    for (const value of Object.values(visual)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(visual).toEqual({ cloud: 1, rain: 1, snow: 0, mist: 0, storm: 1, aurora: 1, gust: 1 });
    expect(damp(0, 1, 1_000_000_000, 0.45)).toBe(1);
  });

  it('returns the same object without advancing weather when dt is not positive', () => {
    const visual: WeatherVisual = { cloud: 0.2, rain: 0.3, snow: 0.4, mist: 0.5, storm: 0.6, aurora: 0.7, gust: 0.8 };
    const before = { ...visual };
    expect(updateWeatherVisual(visual, 'storm', 0, 0)).toBe(visual);
    expect(visual).toEqual(before);
    updateWeatherVisual(visual, 'clear', 1, -2);
    expect(visual).toEqual(before);
  });
});
