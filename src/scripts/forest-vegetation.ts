import * as THREE from 'three';
import {
  DISCOVERIES, WORLD_R, TRAILS, SPAWN, chunkCoord, chunkSeed, groundcoverDensityAt, lodWithHysteresis,
  moistureAt, pathInfo, range, riverInfo, riverWidth, rng, scatter, slopeAt, terrainHeight,
} from './forest-core';
import type { LodLevel } from './forest-core';
import { barkDetailTexture, canopyDetailTexture, createWindMaterial, disposeMaterial } from './forest-art';
import type { ForestQualityProfile, WindMaterialPair, WindUniforms } from './forest-art';
import {
  GeometryBatch, createDaisyGeometry, createFernGeometry, createGrassClump, createMushroomGeometry,
  createRockGeometry, createRoundleaf, createTreeGeometry,
} from './forest-assets';
import type { TreeGeometry, TreeSpecies } from './forest-assets';

interface TreeSpot { x: number; z: number; scale: number; rotation: number; tint: number }
interface TreeChunk {
  center: THREE.Vector3;
  levels: { trunk: THREE.InstancedMesh; canopy: THREE.InstancedMesh }[];
  lod: LodLevel;
}
interface GroundChunk {
  center: THREE.Vector3;
  meshes: THREE.Mesh[];
  lod: LodLevel;
  grassVertices: number[];
  totalVertices: number[];
}
interface FloraAnchor { x: number; z: number; kind: 'daisy' | 'mushroom'; seed: number }
interface Cluster { x: number; z: number; seed: number; hero: boolean }

const tmpObject = new THREE.Object3D();
const tmpColor = new THREE.Color();
function matrixAt(x: number, y: number, z: number, rotation: number, scale: number, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  tmpObject.position.set(x, y, z); tmpObject.rotation.set(0, rotation, 0); tmpObject.scale.set(scale * sx, scale * sy, scale * sz); tmpObject.updateMatrix();
  return tmpObject.matrix.clone();
}
function chunkKey(cx: number, cz: number): string { return `${cx},${cz}`; }

/** 树林与地被的空间分块运行时。近景保细节，远景保轮廓，区块自行视锥剔除。 */
export class ForestVegetation {
  readonly group = new THREE.Group();
  private treeChunks = new Map<string, TreeChunk>();
  private groundChunks = new Map<string, GroundChunk>();
  private treeAssets: TreeGeometry[][] = [];
  private grass: THREE.BufferGeometry[][] = [[], [], []];
  private roundleaf: THREE.BufferGeometry[][] = [[], [], []];
  private daisies: THREE.BufferGeometry[][] = [[], [], []];
  private mushrooms: THREE.BufferGeometry[][] = [[], [], []];
  private ferns: THREE.BufferGeometry[][] = [[], [], []];
  private rocks: THREE.BufferGeometry[][] = [[], [], []];
  private barkMaterial: WindMaterialPair;
  private canopyMaterial: WindMaterialPair;
  private groundMaterial: WindMaterialPair;
  private anchors: FloraAnchor[] = [];
  private clusters: Cluster[] = [];
  private density = 1;
  private treeTotal = 0;
  private lastCenter = new THREE.Vector3(Infinity, 0, Infinity);

  constructor(private profile: ForestQualityProfile, private wind: WindUniforms) {
    this.group.name = 'storybook-vegetation';
    const barkDetail = barkDetailTexture();
    this.barkMaterial = createWindMaterial(wind, 0.055, { roughness: 0.96, map: barkDetail, bumpMap: barkDetail, bumpScale: 0.12 });
    const leafDetail = canopyDetailTexture();
    this.canopyMaterial = createWindMaterial(wind, 0.13, { roughness: 0.9, map: leafDetail, bumpMap: leafDetail, bumpScale: 0.16 }, 'canopy');
    this.groundMaterial = createWindMaterial(wind, 0.055, { roughness: 0.94, side: THREE.DoubleSide });
    this.buildAssetLibrary();
    this.buildAnchors();
    this.buildTrees();
  }

  private buildAssetLibrary(): void {
    // 0–3 为阔叶变体，4 为白桦，5 为针叶树；全部按 LOD 共享几何。
    for (let variant = 0; variant < 4; variant++) {
      this.treeAssets[variant] = [];
      for (let lod = 0; lod < 3; lod++) this.treeAssets[variant][lod] = createTreeGeometry('broad', 5100 + variant * 977, lod as LodLevel);
    }
    for (const [index, species, seed] of [[4, 'birch', 6101], [5, 'conifer', 6202]] as const) {
      this.treeAssets[index] = [];
      for (let lod = 0; lod < 3; lod++) this.treeAssets[index][lod] = createTreeGeometry(species, seed, lod as LodLevel);
    }
    for (let lod = 0; lod < 3; lod++) {
      for (let i = 0; i < 4; i++) {
        this.grass[lod][i] = createGrassClump(6200 + lod * 40 + i, lod as LodLevel);
        this.roundleaf[lod][i] = createRoundleaf(6300 + lod * 40 + i, lod as LodLevel);
        this.daisies[lod][i] = createDaisyGeometry(6400 + lod * 40 + i, lod as LodLevel);
        this.mushrooms[lod][i] = createMushroomGeometry(6500 + lod * 40 + i, lod as LodLevel);
        this.ferns[lod][i] = createFernGeometry(6600 + lod * 40 + i, lod as LodLevel);
        this.rocks[lod][i] = createRockGeometry(6700 + lod * 40 + i, lod as LodLevel);
      }
    }
  }

  private buildAnchors(): void {
    const samples = TRAILS[0].samples;
    const r = rng(7401);
    for (const [j, index] of [10, 23, 37, 52, 70, 94, 118].entries()) {
      const s = samples[Math.min(index, samples.length - 1)];
      const before = samples[Math.max(0, index - 1)], after = samples[Math.min(samples.length - 1, index + 1)];
      const dx = after.x - before.x, dz = after.z - before.z, len = Math.hypot(dx, dz) || 1;
      const side = j % 2 ? 1 : -1;
      const nx = -dz / len * side, nz = dx / len * side;
      this.anchors.push({ x: s.x + nx * (s.width + 0.75), z: s.z + nz * (s.width + 0.75), kind: 'daisy', seed: 7500 + j });
      if (j < 6) this.anchors.push({ x: s.x - nx * range(r, 3.0, 4.6), z: s.z - nz * range(r, 3.0, 4.6), kind: 'mushroom', seed: 7600 + j });
    }
    for (const a of this.anchors) if (a.kind === 'mushroom') this.clusters.push({ x: a.x, z: a.z, seed: a.seed, hero: true });
    // 出生画面的两个前景记忆点：右下主雏菊、左侧主菌群，位置由相机基向量确定。
    const forward = { x: -Math.sin(SPAWN.yaw), z: -Math.cos(SPAWN.yaw) };
    const right = { x: -forward.z, z: forward.x };
    const heroDaisy = { x: SPAWN.x + forward.x * 4.4 + right.x * 1.75, z: SPAWN.z + forward.z * 4.4 + right.z * 1.75 };
    this.anchors.push({ ...heroDaisy, kind: 'daisy', seed: 7681 });
    this.anchors.push({ x: SPAWN.x + forward.x * 10.5 - right.x * 1.9, z: SPAWN.z + forward.z * 10.5 - right.z * 1.9, kind: 'daisy', seed: 7682 });
    this.clusters.push({ x: SPAWN.x + forward.x * 3.8 - right.x * 2.25, z: SPAWN.z + forward.z * 3.8 - right.z * 2.25, seed: 7691, hero: true });
    const meadow = DISCOVERIES.find((d) => d.key === 'meadow')!;
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.35, radius = i % 2 ? 7.5 : 5.2;
      this.anchors.push({ x: meadow.pos.x + Math.cos(a) * radius, z: meadow.pos.z + Math.sin(a) * radius, kind: 'daisy', seed: 7700 + i });
    }
    const wild = scatter({
      count: this.profile.name === 'high' ? 64 : 42, seed: 7711, minDist: 5.5, riverPad: 1.8, maxSlope: 0.58,
      filter: (x, z) => pathInfo(x, z).d > pathInfo(x, z).width + 1.2 && !DISCOVERIES.some((d) => Math.hypot(x - d.pos.x, z - d.pos.z) < 4),
    });
    wild.forEach((p, i) => this.clusters.push({ x: p.x, z: p.z, seed: 7800 + i, hero: false }));
  }

  private heroTrees(): TreeSpot[] {
    const out: TreeSpot[] = [], samples = TRAILS[0].samples, r = rng(7901);
    for (let i = 4; i < 72; i += 5) {
      const s = samples[i], before = samples[i - 1], after = samples[i + 1];
      const dx = after.x - before.x, dz = after.z - before.z, len = Math.hypot(dx, dz) || 1;
      for (const side of [-1, 1]) {
        if (r() < 0.18) continue;
        const offset = range(r, 5.4, 8.8);
        const x = s.x - dz / len * offset * side, z = s.z + dx / len * offset * side;
        const river = riverInfo(x, z);
        if (Math.hypot(x, z) > WORLD_R - 5 || river.d < riverWidth(river.t) + 3.0 || slopeAt(x, z) > 0.6) continue;
        out.push({ x, z, scale: range(r, 0.95, 1.32), rotation: r() * Math.PI * 2, tint: range(r, 0.94, 1.05) });
      }
    }
    return out;
  }

  private buildTrees(): void {
    const heroes = this.heroTrees();
    const spots = [...heroes];
    const random = rng(8001);
    const generated = scatter({
      count: Math.max(0, this.profile.treeCount - heroes.length), seed: 8002, minDist: 2.15, riverPad: 2.8, maxSlope: 0.61, maxSlopeRiver: true,
      filter: (x, z) => {
        const path = pathInfo(x, z);
        if (path.d < path.width + 2.3) return false;
        if (heroes.some((p) => Math.hypot(x - p.x, z - p.z) < 3.8)) return false;
        return !DISCOVERIES.some((d) => {
          const clearing = d.key === 'ancient' ? 20 : d.key === 'meadow' ? 16 : d.key === 'stones' ? 12 : 6;
          return Math.hypot(x - d.pos.x, z - d.pos.z) < clearing;
        });
      },
    });
    for (const p of generated) spots.push({ x: p.x, z: p.z, scale: range(random, 0.65, 1.13), rotation: random() * Math.PI * 2, tint: range(random, 0.91, 1.06) });
    this.treeTotal = spots.length;
    const groups = new Map<string, TreeSpot[]>();
    for (const spot of spots) {
      const cx = chunkCoord(spot.x, this.profile.chunkSize), cz = chunkCoord(spot.z, this.profile.chunkSize);
      const key = chunkKey(cx, cz);
      const list = groups.get(key); if (list) list.push(spot); else groups.set(key, [spot]);
    }
    for (const [key, list] of groups) {
      const [cx, cz] = key.split(',').map(Number);
      const hash = chunkSeed(cx, cz, 81);
      const biome = moistureAt((cx + 0.5) * this.profile.chunkSize, (cz + 0.5) * this.profile.chunkSize);
      const species: TreeSpecies = hash % 11 < 7 || biome > 0.72 ? 'broad' : hash % 11 < 9 ? 'birch' : 'conifer';
      const variant = species === 'broad' ? hash % 4 : species === 'birch' ? 1 : 2;
      const speciesIndex = species === 'broad' ? variant : species === 'birch' ? 4 : 5;
      const chunk: TreeChunk = {
        center: new THREE.Vector3((cx + 0.5) * this.profile.chunkSize, 0, (cz + 0.5) * this.profile.chunkSize), levels: [], lod: 2,
      };
      for (let lod = 0; lod < 3; lod++) {
        const asset = this.treeAssets[speciesIndex][lod];
        const trunk = new THREE.InstancedMesh(asset.trunk, this.barkMaterial.material, list.length);
        const canopy = new THREE.InstancedMesh(asset.canopy, this.canopyMaterial.material, list.length);
        for (let i = 0; i < list.length; i++) {
          const p = list[i], matrix = matrixAt(p.x, terrainHeight(p.x, p.z) - 0.04, p.z, p.rotation, p.scale);
          trunk.setMatrixAt(i, matrix); canopy.setMatrixAt(i, matrix);
          tmpColor.setRGB(p.tint * 0.98, p.tint, p.tint * 0.96);
          trunk.setColorAt(i, tmpColor); canopy.setColorAt(i, tmpColor);
        }
        trunk.instanceMatrix.needsUpdate = canopy.instanceMatrix.needsUpdate = true;
        if (trunk.instanceColor) trunk.instanceColor.needsUpdate = true;
        if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
        trunk.castShadow = canopy.castShadow = false;
        trunk.receiveShadow = canopy.receiveShadow = true;
        trunk.customDepthMaterial = this.barkMaterial.depthMaterial;
        canopy.customDepthMaterial = this.canopyMaterial.depthMaterial;
        trunk.computeBoundingSphere(); canopy.computeBoundingSphere();
        trunk.visible = canopy.visible = lod === 2;
        this.group.add(trunk, canopy);
        chunk.levels.push({ trunk, canopy });
      }
      this.treeChunks.set(key, chunk);
    }
  }

  private addCluster(batch: GeometryBatch, low: GeometryBatch, cluster: Cluster, lodDetail: number): void {
    const r = rng(cluster.seed);
    const count = cluster.hero ? 9 : 7;
    for (let i = 0; i < count; i++) {
      const a = i === 0 ? 0 : r() * Math.PI * 2;
      const radius = i === 0 ? 0 : range(r, 0.45, cluster.hero ? 2.0 : 1.5);
      const x = cluster.x + Math.cos(a) * radius, z = cluster.z + Math.sin(a) * radius;
      const scale = i === 0 ? (cluster.hero ? range(r, 1.65, 2.25) : range(r, 1.0, 1.4)) : i < 4 ? range(r, 0.48, 0.85) : range(r, 0.12, 0.32);
      const variant = Math.floor(r() * 4);
      const matrix = matrixAt(x, terrainHeight(x, z) - 0.025, z, r() * Math.PI * 2, scale, range(r, 0.9, 1.12), 1, range(r, 0.9, 1.12));
      batch.add(this.mushrooms[lodDetail][variant], matrix);
      if (i < 4) low.add(this.mushrooms[2][variant], matrix);
    }
  }

  private buildGroundChunk(cx: number, cz: number): GroundChunk {
    const size = this.profile.chunkSize, x0 = cx * size, z0 = cz * size;
    const seed = chunkSeed(cx, cz, 117), r = rng(seed);
    const high = new GeometryBatch(), low = new GeometryBatch();
    let highGrassVertices = 0, lowGrassVertices = 0;
    const step = this.profile.name === 'high' ? 0.5 : this.profile.name === 'medium' ? 0.59 : 0.69;
    let accepted = 0;
    const midStride = this.profile.name === 'high' ? 2 : 3;
    for (let x = x0 + step * 0.5; x < x0 + size; x += step) for (let z = z0 + step * 0.5; z < z0 + size; z += step) {
      const px = x + range(r, -step * 0.42, step * 0.42), pz = z + range(r, -step * 0.42, step * 0.42);
      if (Math.hypot(px, pz) > WORLD_R + 2) continue;
      const density = groundcoverDensityAt(px, pz);
      if (r() > density / this.profile.grassDensity) continue;
      const variant = Math.floor(r() * 4), leaf = r() < 0.3;
      const scale = range(r, leaf ? 0.95 : 0.72, leaf ? 1.55 : 1.32), rotation = r() * Math.PI * 2;
      const matrix = matrixAt(px, terrainHeight(px, pz) - 0.025, pz, rotation, scale);
      const source = leaf ? this.roundleaf[0][variant] : this.grass[0][variant];
      high.add(source, matrix, undefined, leaf ? 0.65 : 1);
      highGrassVertices += source.index ? source.index.count : source.attributes.position.count;
      if (accepted % midStride === 0) {
        const lowSource = leaf ? this.roundleaf[2][variant] : this.grass[2][variant];
        low.add(lowSource, matrixAt(px, terrainHeight(px, pz) - 0.025, pz, rotation, scale * 1.28), undefined, 0.7);
        lowGrassVertices += lowSource.index ? lowSource.index.count : lowSource.attributes.position.count;
      }
      accepted++;
    }

    // 花、菌、蕨和苔石附在同一批次；先草后装饰，使草密滑杆只裁草的部分。
    const flowerAnchors = this.anchors.filter((a) => a.kind === 'daisy' && chunkCoord(a.x, size) === cx && chunkCoord(a.z, size) === cz);
    for (const anchor of flowerAnchors) {
      const ar = rng(anchor.seed);
      for (let i = 0; i < 11; i++) {
        const a = ar() * Math.PI * 2, rad = i < 2 ? ar() * 0.35 : range(ar, 0.35, 1.55);
        const x = anchor.x + Math.cos(a) * rad, z = anchor.z + Math.sin(a) * rad;
        const scale = i < 2 ? range(ar, 1.05, 1.3) : i < 7 ? range(ar, 0.48, 0.75) : range(ar, 0.22, 0.4);
        const variant = Math.floor(ar() * 4), matrix = matrixAt(x, terrainHeight(x, z), z, ar() * Math.PI * 2, scale);
        high.add(this.daisies[0][variant], matrix);
        if (i < 5) low.add(this.daisies[2][variant], matrix);
      }
    }
    const meadow = DISCOVERIES.find((d) => d.key === 'meadow')!;
    for (let i = 0; i < 38; i++) {
      const x = range(r, x0, x0 + size), z = range(r, z0, z0 + size);
      const path = pathInfo(x, z), nearMeadow = Math.hypot(x - meadow.pos.x, z - meadow.pos.z) < 20;
      if (!nearMeadow && (path.d > path.width + 5 || r() < 0.52)) continue;
      if (path.d < path.width + 0.35 || riverInfo(x, z).d < riverWidth(riverInfo(x, z).t) + 1.2) continue;
      const scale = nearMeadow ? range(r, 0.32, 0.76) : range(r, 0.2, 0.5);
      const variant = Math.floor(r() * 4), matrix = matrixAt(x, terrainHeight(x, z), z, r() * Math.PI * 2, scale);
      high.add(this.daisies[0][variant], matrix);
      if (i % midStride === 0) low.add(this.daisies[2][variant], matrix);
    }
    for (const cluster of this.clusters) if (chunkCoord(cluster.x, size) === cx && chunkCoord(cluster.z, size) === cz) this.addCluster(high, low, cluster, 0);
    for (let i = 0; i < 24; i++) {
      const x = range(r, x0, x0 + size), z = range(r, z0, z0 + size);
      if (moistureAt(x, z) < 0.5 || pathInfo(x, z).d < pathInfo(x, z).width + 0.6) continue;
      const variant = Math.floor(r() * 4), matrix = matrixAt(x, terrainHeight(x, z), z, r() * Math.PI * 2, range(r, 0.65, 1.35));
      high.add(this.ferns[0][variant], matrix);
      if (i % (this.profile.name === 'high' ? 2 : 4) === 0) low.add(this.ferns[2][variant], matrix);
    }
    for (let i = 0; i < 5; i++) {
      const x = range(r, x0, x0 + size), z = range(r, z0, z0 + size);
      const path = pathInfo(x, z);
      if (path.d < path.width + 0.8 || riverInfo(x, z).d < riverWidth(riverInfo(x, z).t) + 0.5) continue;
      const variant = Math.floor(r() * 4), matrix = matrixAt(x, terrainHeight(x, z) - 0.1, z, r() * Math.PI * 2, range(r, 0.25, 0.75), range(r, 0.8, 1.4), 1, range(r, 0.8, 1.3));
      high.add(this.rocks[0][variant], matrix);
      if (i === 0) low.add(this.rocks[2][variant], matrix);
    }

    const meshes: THREE.Mesh[] = [], grassVertices: number[] = [], totalVertices: number[] = [];
    for (const [batch, grassCount] of [[high, highGrassVertices], [low, lowGrassVertices]] as const) {
      const geometry = batch.build();
      const mesh = new THREE.Mesh(geometry, this.groundMaterial.material);
      mesh.receiveShadow = true; mesh.castShadow = false; mesh.visible = false;
      mesh.userData.grassVertices = grassCount;
      mesh.userData.totalVertices = geometry.attributes.position.count;
      this.group.add(mesh); meshes.push(mesh);
      grassVertices.push(grassCount); totalVertices.push(geometry.attributes.position.count);
    }
    return {
      center: new THREE.Vector3(x0 + size * 0.5, 0, z0 + size * 0.5), meshes, lod: 1, grassVertices, totalVertices,
    };
  }

  private applyGroundDensity(chunk: GroundChunk): void {
    chunk.meshes.forEach((mesh, i) => {
      const grass = Math.floor(chunk.grassVertices[i] * this.density / 3) * 3;
      const decorations = chunk.totalVertices[i] - chunk.grassVertices[i];
      mesh.geometry.setDrawRange(0, grass + decorations);
    });
  }

  update(player: THREE.Vector3, force = false): void {
    if (!force && this.lastCenter.distanceToSquared(player) < 1.2) return;
    this.lastCenter.copy(player);
    const size = this.profile.chunkSize;
    for (const chunk of this.treeChunks.values()) {
      const distance = Math.hypot(player.x - chunk.center.x, player.z - chunk.center.z);
      const lod = lodWithHysteresis(distance, chunk.lod, this.profile.nearDistance, this.profile.midDistance);
      const farCut = this.profile.name === 'high' ? 125 : this.profile.name === 'medium' ? 95 : 72;
      const inRange = distance < farCut;
      if (lod !== chunk.lod || force) {
        chunk.lod = lod;
      }
      chunk.levels.forEach((level, i) => {
        level.trunk.visible = level.canopy.visible = inRange && i === lod;
        level.trunk.castShadow = level.canopy.castShadow = inRange && i === 0 && distance < this.profile.nearDistance;
      });
    }
    const minX = chunkCoord(player.x - this.profile.groundRadius - size, size), maxX = chunkCoord(player.x + this.profile.groundRadius + size, size);
    const minZ = chunkCoord(player.z - this.profile.groundRadius - size, size), maxZ = chunkCoord(player.z + this.profile.groundRadius + size, size);
    for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) {
      const centerX = (cx + 0.5) * size, centerZ = (cz + 0.5) * size;
      const distance = Math.hypot(player.x - centerX, player.z - centerZ);
      if (distance > this.profile.groundRadius + size * 0.75 || Math.hypot(centerX, centerZ) > WORLD_R + size) continue;
      const key = chunkKey(cx, cz);
      let chunk = this.groundChunks.get(key);
      if (!chunk) { chunk = this.buildGroundChunk(cx, cz); this.groundChunks.set(key, chunk); this.applyGroundDensity(chunk); }
      const lod: LodLevel = distance < this.profile.nearDistance + 7 ? 0 : 1;
      chunk.lod = lod;
      chunk.meshes.forEach((mesh, i) => { mesh.visible = i === lod; });
    }
    for (const [key, chunk] of this.groundChunks) {
      if (Math.hypot(player.x - chunk.center.x, player.z - chunk.center.z) > this.profile.groundRadius + size * 1.5) {
        for (const mesh of chunk.meshes) { this.group.remove(mesh); mesh.geometry.dispose(); }
        this.groundChunks.delete(key);
      }
    }
  }

  setGrassDensity(value: number): void {
    this.density = THREE.MathUtils.clamp(value, 0, 1);
    for (const chunk of this.groundChunks.values()) this.applyGroundDensity(chunk);
  }
  getStats(): { trees: number; treeChunks: number; groundChunks: number; visibleGroundTriangles: number } {
    let visibleGroundTriangles = 0;
    for (const chunk of this.groundChunks.values()) for (const mesh of chunk.meshes) if (mesh.visible) visibleGroundTriangles += Math.min(mesh.geometry.drawRange.count, mesh.geometry.attributes.position.count) / 3;
    return { trees: this.treeTotal, treeChunks: this.treeChunks.size, groundChunks: this.groundChunks.size, visibleGroundTriangles: Math.round(visibleGroundTriangles) };
  }
  dispose(): void {
    this.group.traverse((object) => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    for (const chunk of this.groundChunks.values()) for (const mesh of chunk.meshes) mesh.geometry.dispose();
    for (const family of this.treeAssets) for (const asset of family) { asset.trunk.dispose(); asset.canopy.dispose(); }
    for (const library of [this.grass, this.roundleaf, this.daisies, this.mushrooms, this.ferns, this.rocks]) for (const lod of library) for (const geo of lod) geo.dispose();
    for (const pair of [this.barkMaterial, this.canopyMaterial, this.groundMaterial]) { disposeMaterial(pair.material); pair.depthMaterial.dispose(); }
  }
}
