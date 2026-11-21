import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FOREST_PALETTE } from './forest-art';
import { lerp, range, rng } from './forest-core';
import type { LodLevel } from './forest-core';

export type TreeSpecies = 'broad' | 'birch' | 'conifer';
export interface TreeGeometry {
  trunk: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  height: number;
}

const C = (hex: string) => new THREE.Color(hex);
function withUV(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  return geo;
}
function nonIndexed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  return geo.index ? geo.toNonIndexed() : geo;
}
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((p) => withUV(nonIndexed(p)));
  const merged = mergeGeometries(prepared)!;
  return merged;
}
function coherent(v: THREE.Vector3, seed: number): number {
  return Math.sin(v.x * 8.17 + v.y * 5.31 + v.z * 6.73 + seed * 0.113) * 0.5 + 0.5;
}
function jitter(geo: THREE.BufferGeometry, seed: number, amount: number, freq = 1.7): THREE.BufferGeometry {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = coherent(v.clone().multiplyScalar(freq), seed) - 0.5;
    const k = 1 + n * amount;
    p.setXYZ(i, v.x * k, v.y * (1 + n * amount * 0.35), v.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}
function setBend(geo: THREE.BufferGeometry, height = 1): THREE.BufferGeometry {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const bend = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) bend[i] = THREE.MathUtils.clamp(p.getY(i) / Math.max(0.01, height), 0, 1.35);
  geo.setAttribute('aBend', new THREE.BufferAttribute(bend, 1));
  return geo;
}
function paint(geo: THREE.BufferGeometry, painter: (v: THREE.Vector3, n: THREE.Vector3, color: THREE.Color) => void, bendHeight?: number): THREE.BufferGeometry {
  withUV(geo);
  const p = geo.attributes.position as THREE.BufferAttribute;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const normal = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), color = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); n.fromBufferAttribute(normal, i); color.setRGB(1, 1, 1);
    painter(v, n, color);
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return setBend(geo, bendHeight ?? Math.max(0.01, geo.boundingBox?.max.y ?? 1));
}
function flatPaint(geo: THREE.BufferGeometry, color: THREE.Color, variance = 0.04, seed = 0): THREE.BufferGeometry {
  return paint(geo, (v, _n, out) => {
    out.copy(color).multiplyScalar(1 - variance + coherent(v, seed) * variance * 2);
  });
}
function blob(detail: number, radius: number, seed: number, amount = 0.12): THREE.BufferGeometry {
  const geo = jitter(new THREE.IcosahedronGeometry(radius, detail), seed, amount);
  // 叶团是柔软球簇，不用合并后的面法线把它变成矿石。
  const p = geo.attributes.position as THREE.BufferAttribute;
  const normals = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); normals[i * 3] = v.x; normals[i * 3 + 1] = v.y; normals[i * 3 + 2] = v.z; }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}
function transformed(geo: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx): THREE.BufferGeometry {
  geo.scale(sx, sy, sz); geo.translate(x, y, z); return geo;
}

/** 沿 Catmull-Rom 曲线扫掠的锥化网格，用于曲干、枝条、根与菌柄。 */
function sweep(points: THREE.Vector3[], r0: number, r1: number, radial = 10, segments = 8, flare = 0): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const center = curve.getPointAt(t);
    const radius = lerp(r0, r1, t) * (1 + flare * Math.exp(-t * 10));
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      const normal = frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      const p = center.clone().addScaledVector(normal, radius);
      positions.push(p.x, p.y, p.z); uvs.push(j / radial, t);
      if (i < segments && j < radial) {
        const a0 = i * (radial + 1) + j, b0 = a0 + radial + 1;
        indices.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices); geo.computeVertexNormals();
  return geo;
}

function paintBark(geo: THREE.BufferGeometry, height: number, birch = false): THREE.BufferGeometry {
  const shadow = C(birch ? '#777365' : FOREST_PALETTE.barkShadow);
  const base = C(birch ? FOREST_PALETTE.birch : FOREST_PALETTE.bark);
  const light = C(birch ? '#F0EBD8' : FOREST_PALETTE.barkLight);
  const moss = C(FOREST_PALETTE.moss);
  return paint(geo, (v, n, out) => {
    const c = coherent(v, 94);
    out.copy(base).lerp(light, THREE.MathUtils.clamp(v.y / height * 0.32 + n.y * 0.14 + c * 0.16, 0, 0.62));
    out.lerp(shadow, (1 - Math.max(0, n.y)) * 0.12);
    if (birch) {
      const mark = Math.pow(Math.max(0, Math.sin(v.y * 15.5 + coherent(v, 18) * 5)), 12);
      out.lerp(C(FOREST_PALETTE.birchMark), mark * 0.72);
    } else {
      const groove = 0.88 + 0.12 * Math.sin(Math.atan2(v.z, v.x) * 9 + v.y * 0.8);
      out.multiplyScalar(groove);
      const mossK = (1 - THREE.MathUtils.smoothstep(v.y, 0.35, 2.0)) * THREE.MathUtils.smoothstep(c + n.y * 0.25, 0.46, 0.82);
      out.lerp(moss, mossK * 0.8);
    }
  }, height);
}
function paintCanopy(geo: THREE.BufferGeometry, height: number, birch = false): THREE.BufferGeometry {
  const shadow = C(FOREST_PALETTE.canopyShadow);
  const base = C(birch ? '#78934A' : FOREST_PALETTE.canopy);
  const light = C(birch ? '#C2C97A' : FOREST_PALETTE.canopyLight);
  const tip = C(FOREST_PALETTE.canopyTip);
  return paint(geo, (v, n, out) => {
    const y = THREE.MathUtils.clamp(v.y / height, 0, 1);
    const facing = THREE.MathUtils.clamp(n.y * 0.5 + 0.5, 0, 1);
    const grain = coherent(v, 312);
    out.copy(shadow).lerp(base, THREE.MathUtils.clamp(y * 1.35 + facing * 0.24, 0, 1));
    out.lerp(light, THREE.MathUtils.clamp((y - 0.48) * 1.4 + facing * 0.32, 0, 0.75));
    out.lerp(tip, Math.max(0, facing - 0.78) * 0.34);
    out.multiplyScalar(0.95 + grain * 0.1);
  }, height);
}

function broadOrBirch(seed: number, lod: LodLevel, birch: boolean): TreeGeometry {
  const r = rng(seed);
  const height = birch ? range(r, 9.5, 12.5) : range(r, 10.5, 14.5);
  const leanX = range(r, -0.75, 0.75), leanZ = range(r, -0.65, 0.65);
  const trunkRadius = birch ? range(r, 0.32, 0.44) : range(r, 0.55, 0.78);
  const trunkParts: THREE.BufferGeometry[] = [];
  trunkParts.push(sweep([
    new THREE.Vector3(0, -0.08, 0),
    new THREE.Vector3(leanX * 0.18, height * 0.28, leanZ * 0.12),
    new THREE.Vector3(leanX * 0.62, height * 0.58, leanZ * 0.55),
    new THREE.Vector3(leanX, height * 0.78, leanZ),
  ], trunkRadius, trunkRadius * 0.28, lod === 0 ? 12 : lod === 1 ? 8 : 6, lod === 0 ? 10 : lod === 1 ? 6 : 4, birch ? 0.25 : 0.5));

  const rootCount = lod === 2 ? 3 : 5 + Math.floor(r() * 3);
  for (let i = 0; i < rootCount; i++) {
    const a = i / rootCount * Math.PI * 2 + range(r, -0.25, 0.25);
    const length = range(r, birch ? 1.0 : 1.5, birch ? 2.0 : 2.9);
    const side = range(r, -0.28, 0.28);
    trunkParts.push(sweep([
      new THREE.Vector3(Math.cos(a) * trunkRadius * 0.3, 0.35, Math.sin(a) * trunkRadius * 0.3),
      new THREE.Vector3(Math.cos(a + side) * length * 0.52, 0.18, Math.sin(a + side) * length * 0.52),
      new THREE.Vector3(Math.cos(a + side * 1.4) * length, -0.12, Math.sin(a + side * 1.4) * length),
    ], trunkRadius * 0.36, 0.025, lod === 0 ? 8 : lod === 1 ? 6 : 4, lod === 0 ? 6 : lod === 1 ? 4 : 3));
  }

  const crown = rng(seed + 2001), fullLargeCount = 8 + Math.floor(crown() * 5);
  const largeCount = lod === 2 ? 7 : fullLargeCount;
  const centers: { p: THREE.Vector3; radius: number }[] = [];
  const crownBase = height * (birch ? 0.52 : 0.48);
  for (let i = 0; i < largeCount; i++) {
    const a = i * 2.39996 + range(crown, -0.35, 0.35);
    const ring = i < 3 ? range(crown, 0.2, 1.0) : range(crown, 1.0, birch ? 1.8 : 2.5);
    const y = crownBase + (i / fullLargeCount) * height * 0.28 + range(crown, -0.55, 0.65);
    const p = new THREE.Vector3(leanX * 0.8 + Math.cos(a) * ring, y, leanZ * 0.8 + Math.sin(a) * ring);
    const radius = range(crown, birch ? 0.85 : 1.05, birch ? 1.45 : 1.75) * (i > fullLargeCount - 3 ? 0.82 : 1);
    centers.push({ p, radius });
    if (i < (lod === 0 ? 7 : lod === 1 ? 4 : 2)) {
      const start = new THREE.Vector3(leanX * 0.45, crownBase * 0.9, leanZ * 0.45);
      const mid = start.clone().lerp(p, 0.55); mid.y -= 0.35;
      trunkParts.push(sweep([start, mid, p], trunkRadius * 0.34, 0.055, lod === 0 ? 8 : lod === 1 ? 6 : 4, lod === 0 ? 6 : lod === 1 ? 4 : 2));
    }
  }

  const canopyParts: THREE.BufferGeometry[] = [];
  centers.forEach(({ p, radius }, i) => {
    const shape = rng(seed + 2500 + i);
    canopyParts.push(transformed(blob(lod === 0 ? 2 : lod === 1 ? 1 : 0, radius, seed + i, 0.17), p.x, p.y, p.z, 1, range(shape, 0.82, 1.08), 1));
  });
  const mediumR = rng(seed + 3001), fullMediumCount = 62 + Math.floor(mediumR() * 26);
  const mediumCount = lod === 0 ? fullMediumCount : lod === 1 ? 26 : 0;
  const mediumCenters: { p: THREE.Vector3; radius: number }[] = [];
  for (let i = 0; i < mediumCount; i++) {
    const parent = centers[Math.floor(mediumR() * centers.length)];
    const dir = new THREE.Vector3(range(mediumR, -1, 1), range(mediumR, -0.65, 1), range(mediumR, -1, 1)).normalize();
    const radius = range(mediumR, 0.25, birch ? 0.44 : 0.57);
    const p = parent.p.clone().addScaledVector(dir, parent.radius * range(mediumR, 0.84, 1.02));
    mediumCenters.push({ p, radius });
    canopyParts.push(transformed(blob(lod === 0 ? 1 : 0, radius, seed + 100 + i, 0.18), p.x, p.y, p.z, 1, range(mediumR, 0.8, 1.12), 1));
  }
  const leafR = rng(seed + 4001), fullMicroCount = 650 + Math.floor(leafR() * 220);
  const microCount = lod === 0 ? fullMicroCount : lod === 1 ? 180 : 0;
  const sources = mediumCenters.length ? mediumCenters : centers;
  for (let i = 0; i < microCount; i++) {
    const pool = leafR() < 0.58 ? centers : sources;
    const parent = pool[Math.floor(leafR() * pool.length)];
    const dir = new THREE.Vector3(range(leafR, -1, 1), range(leafR, -0.55, 1.2), range(leafR, -1, 1)).normalize();
    const p = parent.p.clone().addScaledVector(dir, parent.radius * range(leafR, 0.88, 1.02));
    const size = range(leafR, birch ? 0.06 : 0.072, birch ? 0.115 : 0.15);
    canopyParts.push(transformed(blob(0, size, seed + 1000 + i, 0.08), p.x, p.y, p.z, 1, range(leafR, 0.52, 0.82), 1));
  }
  const trunk = paintBark(mergeParts(trunkParts), height, birch);
  const canopy = paintCanopy(mergeParts(canopyParts), height, birch);
  return { trunk, canopy, height };
}

function conifer(seed: number, lod: LodLevel): TreeGeometry {
  const r = rng(seed), height = range(r, 11, 15);
  const trunkParts = [sweep([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, height * 0.45, -0.15), new THREE.Vector3(-0.1, height * 0.88, 0.1),
  ], 0.52, 0.07, lod === 0 ? 11 : 8, lod === 0 ? 10 : 6, 0.4)];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + r() * 0.3;
    trunkParts.push(sweep([new THREE.Vector3(0, 0.28, 0), new THREE.Vector3(Math.cos(a) * 0.9, 0.12, Math.sin(a) * 0.9), new THREE.Vector3(Math.cos(a) * 1.8, -0.1, Math.sin(a) * 1.8)], 0.2, 0.02, 6, 4));
  }
  const canopyParts: THREE.BufferGeometry[] = [];
  const pads: { p: THREE.Vector3; radius: number }[] = [];
  const layers = 9;
  for (let layer = 0; layer < layers; layer++) {
    const t = layer / layers;
    const y = height * (0.28 + t * 0.67);
    const ringR = (1 - t) * 2.35 + 0.25;
    const count = layer > layers - 3 ? 2 : 4;
    for (let j = 0; j < count; j++) {
      const a = j / count * Math.PI * 2 + layer * 1.37 + r() * 0.25;
      const p = new THREE.Vector3(Math.cos(a) * ringR * 0.55, y + range(r, -0.2, 0.2), Math.sin(a) * ringR * 0.55);
      const radius = ringR * range(r, 0.65, 0.9);
      pads.push({ p, radius });
      canopyParts.push(transformed(blob(lod === 0 ? 1 : 0, radius, seed + layer * 8 + j, 0.14), p.x, p.y, p.z, 1, 0.48, 1));
    }
  }
  const micro = lod === 0 ? 360 : lod === 1 ? 80 : 0;
  for (let i = 0; i < micro; i++) {
    const parent = pads[Math.floor(r() * pads.length)];
    const dir = new THREE.Vector3(range(r, -1, 1), range(r, -0.25, 1), range(r, -1, 1)).normalize();
    const p = parent.p.clone().addScaledVector(dir, parent.radius * range(r, 0.72, 0.98));
    canopyParts.push(transformed(blob(0, range(r, 0.06, 0.12), seed + 900 + i, 0.06), p.x, p.y, p.z, 1, 0.65, 1));
  }
  return { trunk: paintBark(mergeParts(trunkParts), height), canopy: paintCanopy(mergeParts(canopyParts), height), height };
}

export function createTreeGeometry(species: TreeSpecies, seed: number, lod: LodLevel): TreeGeometry {
  if (species === 'conifer') return conifer(seed, lod);
  return broadOrBirch(seed, lod, species === 'birch');
}

function leafBlade(length: number, width: number, bend: number, segments: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, length, 1, segments);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + length / 2) / length;
    p.setX(i, p.getX(i) * (1 - t * 0.88));
    p.setY(i, p.getY(i) + length / 2);
    p.setZ(i, t * t * bend);
  }
  geo.computeVertexNormals();
  return geo;
}
export function createGrassClump(seed: number, lod: LodLevel): THREE.BufferGeometry {
  const r = rng(seed), parts: THREE.BufferGeometry[] = [];
  const count = lod === 2 ? 3 : 3 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const h = range(r, 0.11, i === 0 && r() > 0.82 ? 0.34 : 0.22);
    const blade = leafBlade(h, range(r, 0.025, 0.055), range(r, 0.025, 0.085), lod === 0 ? 2 : 1);
    blade.rotateX(range(r, -0.35, 0.35)); blade.rotateY(i / count * Math.PI * 2 + r() * 0.4);
    blade.translate(range(r, -0.06, 0.06), 0, range(r, -0.06, 0.06));
    parts.push(blade);
  }
  const geo = mergeParts(parts);
  const root = C(FOREST_PALETTE.mossShadow), tip = C(FOREST_PALETTE.grassLight);
  return paint(geo, (v, n, out) => {
    out.copy(root).lerp(C(FOREST_PALETTE.grass), THREE.MathUtils.clamp(v.y / 0.22, 0, 1));
    out.lerp(tip, THREE.MathUtils.clamp(v.y / 0.28 + n.y * 0.12, 0, 0.75));
  }, 0.28);
}
export function createRoundleaf(seed: number, lod: LodLevel): THREE.BufferGeometry {
  const r = rng(seed), parts: THREE.BufferGeometry[] = [];
  const count = lod === 2 ? 3 : 4 + Math.floor(r() * 2);
  for (let i = 0; i < count; i++) {
    const leaf = leafBlade(range(r, 0.16, 0.3), range(r, 0.09, 0.16), 0.035, lod === 0 ? 2 : 1);
    leaf.rotateX(range(r, 0.75, 1.18)); leaf.rotateY(i / count * Math.PI * 2 + r() * 0.4);
    parts.push(leaf);
  }
  return flatPaint(mergeParts(parts), C(FOREST_PALETTE.broadLeaf), 0.12, seed);
}

export function createDaisyGeometry(seed: number, lod: LodLevel): THREE.BufferGeometry {
  const r = rng(seed), parts: THREE.BufferGeometry[] = [];
  const h = range(r, 0.58, 0.82);
  const stem = sweep([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.025, h * 0.55, 0), new THREE.Vector3(0, h, 0.015)], 0.018, 0.011, lod === 0 ? 7 : 5, lod === 0 ? 5 : 3);
  parts.push(flatPaint(stem, C(FOREST_PALETTE.grass), 0.04, seed));
  const petalCount = lod === 2 ? 8 : 10 + Math.floor(r() * 5);
  for (let i = 0; i < petalCount; i++) {
    const a = i / petalCount * Math.PI * 2 + range(r, -0.06, 0.06);
    const petal = new THREE.SphereGeometry(1, lod === 0 ? 8 : 5, lod === 0 ? 5 : 3);
    petal.scale(range(r, 0.14, 0.19), range(r, 0.015, 0.026), range(r, 0.045, 0.068));
    petal.translate(0.16, 0, 0); petal.rotateZ(range(r, -0.08, 0.14)); petal.rotateY(a); petal.translate(0, h, 0);
    parts.push(flatPaint(petal, C(i % 3 ? FOREST_PALETTE.petal : FOREST_PALETTE.petalLight), 0.025, seed + i));
  }
  const heart = new THREE.SphereGeometry(0.095, lod === 0 ? 12 : 7, lod === 0 ? 7 : 4);
  heart.scale(1, 0.48, 1); heart.translate(0, h + 0.035, 0);
  parts.push(flatPaint(heart, C(FOREST_PALETTE.pollenLight), 0.08, seed + 30));
  for (let i = 0; i < 4; i++) {
    const leaf = leafBlade(range(r, 0.22, 0.34), 0.11, 0.04, lod === 0 ? 2 : 1);
    leaf.rotateX(0.95); leaf.rotateY(i / 4 * Math.PI * 2 + r()); leaf.translate(0, h * (0.12 + i * 0.09), 0);
    parts.push(flatPaint(leaf, C(FOREST_PALETTE.broadLeaf), 0.08, seed + 50 + i));
  }
  return setBend(mergeParts(parts), h);
}

export function createMushroomGeometry(seed: number, lod: LodLevel): THREE.BufferGeometry {
  const r = rng(seed), parts: THREE.BufferGeometry[] = [];
  const h = range(r, 0.72, 0.96), capR = range(r, 0.44, 0.58);
  const stem = sweep([new THREE.Vector3(0, 0, 0), new THREE.Vector3(range(r, -0.08, 0.08), h * 0.5, 0.02), new THREE.Vector3(0, h, 0)], capR * 0.18, capR * 0.12, lod === 0 ? 10 : 7, lod === 0 ? 7 : 4, 0.35);
  parts.push(flatPaint(stem, C(FOREST_PALETTE.stem), 0.05, seed));
  const profile = [
    new THREE.Vector2(0, capR * 0.62), new THREE.Vector2(capR * 0.28, capR * 0.58), new THREE.Vector2(capR * 0.62, capR * 0.4),
    new THREE.Vector2(capR * 0.9, capR * 0.14), new THREE.Vector2(capR, 0), new THREE.Vector2(capR * 0.97, -capR * 0.07), new THREE.Vector2(capR * 0.88, -capR * 0.09),
  ];
  const cap = new THREE.LatheGeometry(profile, lod === 0 ? 28 : lod === 1 ? 18 : 12);
  cap.translate(0, h, 0);
  parts.push(paint(cap, (v, n, out) => {
    out.copy(C(FOREST_PALETTE.mushroomShadow)).lerp(C(FOREST_PALETTE.mushroom), THREE.MathUtils.clamp(n.y * 0.5 + 0.5, 0, 1));
    out.lerp(C(FOREST_PALETTE.mushroomLight), Math.max(0, n.y) * 0.55);
  }));
  if (lod < 2) {
    const under = new THREE.CircleGeometry(capR * 0.88, lod === 0 ? 28 : 16);
    under.rotateX(Math.PI / 2); under.translate(0, h - capR * 0.075, 0);
    parts.push(flatPaint(under, C('#C7BBA1'), 0.03, seed + 3));
    const gills = lod === 0 ? 28 : 16;
    for (let i = 0; i < gills; i++) {
      const a = i / gills * Math.PI * 2;
      const g = new THREE.BufferGeometry();
      const w = 0.009;
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        Math.cos(a) * capR * 0.12, h - capR * 0.09, Math.sin(a) * capR * 0.12,
        Math.cos(a - w) * capR * 0.83, h - capR * 0.085, Math.sin(a - w) * capR * 0.83,
        Math.cos(a + w) * capR * 0.83, h - capR * 0.085, Math.sin(a + w) * capR * 0.83,
      ], 3));
      parts.push(flatPaint(g, C('#A99D86'), 0, i));
    }
  }
  return setBend(mergeParts(parts), h + capR * 0.62);
}

export function createFernGeometry(seed: number, lod: LodLevel): THREE.BufferGeometry {
  const r = rng(seed), parts: THREE.BufferGeometry[] = [];
  const fronds = lod === 2 ? 4 : 7;
  for (let f = 0; f < fronds; f++) {
    const a = f / fronds * Math.PI * 2 + r() * 0.25;
    const pairs = lod === 0 ? 7 : 4;
    for (let j = 0; j < pairs; j++) {
      const t = (j + 1) / (pairs + 1);
      for (const side of [-1, 1]) {
        const leaf = leafBlade((1 - t * 0.65) * 0.2, (1 - t * 0.5) * 0.07, 0.025, 1);
        leaf.rotateX(1.05); leaf.rotateY(a + side * (0.55 + t * 0.25));
        leaf.translate(Math.cos(a) * t * 0.28, t * 0.65, Math.sin(a) * t * 0.28);
        parts.push(leaf);
      }
    }
  }
  return flatPaint(mergeParts(parts), C('#3F6B3C'), 0.12, seed);
}

export function createRockGeometry(seed: number, lod: LodLevel): THREE.BufferGeometry {
  const geo = jitter(new THREE.DodecahedronGeometry(0.65, lod === 0 ? 1 : 0), seed, 0.28, 2.1);
  geo.scale(1, 0.72, 0.86); geo.translate(0, 0.32, 0);
  const stone = C('#637065'), dark = C('#35473F'), moss = C(FOREST_PALETTE.mossLight);
  return paint(geo, (v, n, out) => {
    out.copy(dark).lerp(stone, coherent(v, seed) * 0.5 + 0.25);
    const k = THREE.MathUtils.smoothstep(n.y + coherent(v, seed + 4) * 0.4, 0.48, 0.96);
    out.lerp(moss, k * 0.78);
  }, 0.3);
}

/** 将许多共享几何高效烘成单个区块网格，避免每株植物一个 draw call。 */
export class GeometryBatch {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private uvs: number[] = [];
  private bends: number[] = [];
  private v = new THREE.Vector3();
  private n = new THREE.Vector3();
  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, tint?: THREE.Color, bendScale = 1): void {
    const p = geo.attributes.position as THREE.BufferAttribute;
    const normal = geo.attributes.normal as THREE.BufferAttribute | undefined;
    const color = geo.attributes.color as THREE.BufferAttribute | undefined;
    const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
    const bend = geo.attributes.aBend as THREE.BufferAttribute | undefined;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const count = geo.index ? geo.index.count : p.count;
    for (let k = 0; k < count; k++) {
      const i = geo.index ? geo.index.getX(k) : k;
      this.v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.positions.push(this.v.x, this.v.y, this.v.z);
      if (normal) this.n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize(); else this.n.set(0, 1, 0);
      this.normals.push(this.n.x, this.n.y, this.n.z);
      const cr = color ? color.getX(i) : 1, cg = color ? color.getY(i) : 1, cb = color ? color.getZ(i) : 1;
      this.colors.push(cr * (tint?.r ?? 1), cg * (tint?.g ?? 1), cb * (tint?.b ?? 1));
      this.uvs.push(uv?.getX(i) ?? 0, uv?.getY(i) ?? 0);
      this.bends.push((bend?.getX(i) ?? 0) * bendScale);
    }
  }
  get empty(): boolean { return this.positions.length === 0; }
  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setAttribute('aBend', new THREE.Float32BufferAttribute(this.bends, 1));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  }
}
