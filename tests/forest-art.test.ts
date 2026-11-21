import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITY_PROFILES, forestDayLook } from '../src/scripts/forest-art';
import {
  GeometryBatch, createDaisyGeometry, createGrassClump, createMushroomGeometry, createTreeGeometry,
} from '../src/scripts/forest-assets';

function expectFiniteGeometry(geometry: THREE.BufferGeometry) {
  for (const attribute of Object.values(geometry.attributes)) {
    const array = (attribute as THREE.BufferAttribute).array;
    let finite = true;
    for (let i = 0; i < array.length; i++) if (!Number.isFinite(array[i])) { finite = false; break; }
    expect(finite).toBe(true);
  }
  geometry.computeBoundingBox();
  expect(geometry.boundingBox).not.toBeNull();
}
const triangles = (geometry: THREE.BufferGeometry) => (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;

describe('《深林》英雄资产与画质预算', () => {
  it('阔叶树三档高度一致、几何有限、面数严格递减', () => {
    const high = createTreeGeometry('broad', 5100, 0);
    const medium = createTreeGeometry('broad', 5100, 1);
    const low = createTreeGeometry('broad', 5100, 2);
    expect(high.height).toBeCloseTo(medium.height, 10);
    expect(high.height).toBeCloseTo(low.height, 10);
    const h = triangles(high.trunk) + triangles(high.canopy);
    const m = triangles(medium.trunk) + triangles(medium.canopy);
    const l = triangles(low.trunk) + triangles(low.canopy);
    expect(h).toBeGreaterThan(m);
    expect(m).toBeGreaterThan(l);
    expect(l).toBeLessThan(1800);
    for (const geometry of [high.trunk, high.canopy, medium.trunk, medium.canopy, low.trunk, low.canopy]) expectFiniteGeometry(geometry);
  });

  it('近景草是低草毯，花菌有立体厚度且实例风权重有效', () => {
    const grass = createGrassClump(6200, 0); grass.computeBoundingBox();
    expect(grass.boundingBox!.max.y).toBeLessThan(0.4);
    expect(grass.attributes.aBend.count).toBeGreaterThan(0);
    const daisy = createDaisyGeometry(6400, 0); daisy.computeBoundingBox();
    expect(daisy.boundingBox!.max.y - daisy.boundingBox!.min.y).toBeGreaterThan(0.5);
    expect(triangles(daisy)).toBeGreaterThan(200);
    const mushroom = createMushroomGeometry(6500, 0); mushroom.computeBoundingBox();
    expect(mushroom.boundingBox!.max.y).toBeGreaterThan(0.9);
    expect(triangles(mushroom)).toBeGreaterThan(300);
    for (const geometry of [grass, daisy, mushroom]) expectFiniteGeometry(geometry);
  });

  it('GeometryBatch 正确烘焙矩阵、颜色和顶点数', () => {
    const source = createGrassClump(6201, 1);
    const batch = new GeometryBatch();
    const matrix = new THREE.Matrix4().makeTranslation(3, 4, 5);
    batch.add(source, matrix);
    const baked = batch.build();
    expect(baked.attributes.position.count).toBe(source.attributes.position.count);
    expect(baked.attributes.color.count).toBe(source.attributes.position.count);
    const p = baked.attributes.position as THREE.BufferAttribute;
    let found = false;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - 3) < 2 && Math.abs(p.getZ(i) - 5) < 2) { found = true; break; }
    expect(found).toBe(true);
    expectFiniteGeometry(baked);
  });

  it('三档数量与时段亮度契约明确', () => {
    expect(QUALITY_PROFILES.high.treeCount).toBeGreaterThanOrEqual(780);
    expect(QUALITY_PROFILES.medium.treeCount).toBeLessThan(QUALITY_PROFILES.high.treeCount);
    expect(QUALITY_PROFILES.low.treeCount).toBeLessThan(QUALITY_PROFILES.medium.treeCount);
    const day = forestDayLook(0.55), dusk = forestDayLook(1);
    expect(dusk.waterLight).toBeLessThan(day.waterLight * 0.3);
    expect(dusk.bloomThreshold).toBeGreaterThan(day.bloomThreshold);
    expect(dusk.exposure).toBeLessThan(day.exposure);
  });
});
