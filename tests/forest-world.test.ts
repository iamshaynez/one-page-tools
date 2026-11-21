import { describe, expect, it } from 'vitest';
import {
  DISCOVERIES, FALL_T, TRAILS, WORLD_R, chunkSeed, groundcoverDensityAt, lodWithHysteresis,
  pathInfo, riverPoint, riverWaterLevel, waterLevelAt,
} from '../src/scripts/forest-core';

describe('《深林》道路、分块与水位契约', () => {
  it('所有小径采样点都能被空间索引找回，路心草密度为零', () => {
    for (const trail of TRAILS) {
      for (const sample of trail.samples) {
        const info = pathInfo(sample.x, sample.z);
        expect(info.d).toBeLessThan(0.08);
        expect(TRAILS.some((item) => item.id === info.trail)).toBe(true);
        expect(groundcoverDensityAt(sample.x, sample.z)).toBe(0);
      }
    }
  });

  it('地被密度有界，林内存在可种植区域', () => {
    let plantable = 0;
    for (let x = -90; x <= 90; x += 9) for (let z = -90; z <= 90; z += 9) {
      if (Math.hypot(x, z) > WORLD_R) continue;
      const density = groundcoverDensityAt(x, z);
      expect(density).toBeGreaterThanOrEqual(0);
      expect(density).toBeLessThanOrEqual(18);
      if (density > 1) plantable++;
    }
    expect(plantable).toBeGreaterThan(100);
  });

  it('LOD 近中远切换有滞回，不在边界抖动', () => {
    expect(lodWithHysteresis(23, 0)).toBe(0);
    expect(lodWithHysteresis(27, 0)).toBe(1);
    expect(lodWithHysteresis(20, 1)).toBe(1);
    expect(lodWithHysteresis(17, 1)).toBe(0);
    expect(lodWithHysteresis(60, 1)).toBe(2);
    expect(lodWithHysteresis(54, 2)).toBe(2);
    expect(lodWithHysteresis(50, 2)).toBe(1);
  });

  it('区块种子确定且跨盐值解耦', () => {
    expect(chunkSeed(-3, 7, 1)).toBe(chunkSeed(-3, 7, 1));
    expect(chunkSeed(-3, 7, 1)).not.toBe(chunkSeed(-3, 7, 2));
    expect(chunkSeed(-3, 7, 1)).not.toBe(chunkSeed(3, 7, 1));
  });

  it('河心视觉水位与物理水位完全一致，瀑布发现点锚在真实崖脚', () => {
    for (const t of [0.1, 0.4, 0.612, 0.648, 0.9, 0.97]) {
      const p = riverPoint(t);
      expect(Math.abs(waterLevelAt(p.x, p.z) - riverWaterLevel(t))).toBeLessThan(0.02);
    }
    const fall = DISCOVERIES.find((d) => d.key === 'fall')!;
    const foot = riverPoint(FALL_T);
    expect(Math.hypot(fall.pos.x - foot.x, fall.pos.z - foot.z)).toBeLessThan(1e-9);
  });
});
