import * as THREE from 'three';
import { FOREST_PALETTE, canvasTexture, disposeMaterial } from './forest-art';
import type { ForestQualityProfile } from './forest-art';
import { GeometryBatch } from './forest-assets';
import {
  TRAILS, TERRAIN_SIZE, WORLD_R, clamp01, makeNoise2, moistureAt, pathInfo, range, riverInfo,
  riverWidth, rng, slopeAt, smoothstep, terrainHeight,
} from './forest-core';

const C = (hex: string) => new THREE.Color(hex);
function groundNoiseTexture(): THREE.Texture {
  const n = makeNoise2(8841);
  const texture = canvasTexture(128, (g, size) => {
    const image = g.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = Math.floor((n.fbm(x / 18, y / 18, 4) * 0.72 + n.fbm(x / 5, y / 5, 2) * 0.28) * 255);
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v; image.data[i + 3] = 255;
    }
    g.putImageData(image, 0, 0);
  }, false);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(44, 44);
  return texture;
}

export class ForestTerrain {
  readonly group = new THREE.Group();
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];

  constructor(profile: ForestQualityProfile) {
    this.group.name = 'storybook-terrain';
    const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, profile.terrainSegments, profile.terrainSegments);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const noise = makeNoise2(8801);
    const grassA = C(FOREST_PALETTE.mossShadow), grassB = C(FOREST_PALETTE.moss), grassLight = C(FOREST_PALETTE.mossLight);
    const pathA = C(FOREST_PALETTE.path), pathLight = C(FOREST_PALETTE.pathLight);
    const rock = C('#69746A'), wet = C('#354C42'), sand = C('#A99B73');
    const color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = terrainHeight(x, z);
      pos.setY(i, h);
      const slope = slopeAt(x, z), moisture = moistureAt(x, z), river = riverInfo(x, z);
      const patch = noise.fbm(x * 0.055, z * 0.055, 3), broad = noise.fbm(x * 0.014 + 4, z * 0.014 - 7, 4);
      color.copy(grassA).lerp(grassB, clamp01(patch * 0.65 + moisture * 0.45));
      color.lerp(grassLight, smoothstep(0.62, 0.88, broad) * 0.42);
      color.lerp(rock, smoothstep(0.48, 0.8, slope) * 0.82);
      const shore = 1 - smoothstep(riverWidth(river.t) + 0.5, riverWidth(river.t) + 5.5, river.d);
      color.lerp(sand, shore * (1 - moisture * 0.3) * 0.55);
      color.lerp(wet, smoothstep(riverWidth(river.t) + 1.2, riverWidth(river.t) - 0.8, river.d) * 0.75);
      const path = pathInfo(x, z);
      if (Number.isFinite(path.d)) {
        const pathMask = 1 - smoothstep(path.width * 0.72, path.width + 0.85, path.d);
        const center = 1 - smoothstep(0, path.width, path.d);
        color.lerp(pathA, pathMask * 0.88);
        color.lerp(pathLight, pathMask * center * (0.16 + patch * 0.18));
      }
      color.multiplyScalar(0.9 + patch * 0.17);
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const bump = groundNoiseTexture(); this.textures.push(bump);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0, bumpMap: bump, bumpScale: 0.075 });
    this.materials.push(material);
    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true; terrain.castShadow = false;
    this.group.add(terrain);
    this.buildTrailRibbons();
    this.buildLeafLitter();
  }

  private buildTrailRibbons(): void {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.materials.push(material);
    const path = C(FOREST_PALETTE.path), light = C(FOREST_PALETTE.pathLight), edge = C(FOREST_PALETTE.moss);
    const across = [-1.16, -1, -0.72, 0, 0.72, 1, 1.16];
    TRAILS.forEach((trail, trailIndex) => {
      const positions: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
      trail.samples.forEach((sample, i) => {
        const before = trail.samples[Math.max(0, i - 1)], after = trail.samples[Math.min(trail.samples.length - 1, i + 1)];
        const dx = after.x - before.x, dz = after.z - before.z, len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len;
        across.forEach((a, j) => {
          const wobble = Math.sin(i * 1.73 + j * 4.1) * 0.035;
          const x = sample.x + nx * (sample.width * a + wobble), z = sample.z + nz * (sample.width * a + wobble);
          const y = terrainHeight(x, z) + 0.038 + trailIndex * 0.004;
          positions.push(x, y, z); uvs.push((a + 1.2) / 2.4, i * 0.12);
          const edgeK = smoothstep(0.76, 1.16, Math.abs(a));
          const centerK = 1 - Math.abs(a);
          const color = path.clone().lerp(light, centerK * (0.12 + 0.07 * Math.sin(i * 0.43))).lerp(edge, edgeK * 0.74);
          colors.push(color.r, color.g, color.b);
          if (i < trail.samples.length - 1 && j < across.length - 1) {
            const a0 = i * across.length + j, b0 = a0 + across.length;
            indices.push(a0, a0 + 1, b0, b0, a0 + 1, b0 + 1);
          }
        });
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices); geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true;
      this.group.add(mesh);
    });
  }

  private buildLeafLitter(): void {
    const r = rng(9011), batch = new GeometryBatch();
    const base = new THREE.PlaneGeometry(0.1, 0.18, 1, 1);
    base.rotateX(-Math.PI / 2);
    const colors = [C('#B98A4F'), C('#D0A65E'), C('#7E713D'), C('#95613F')];
    const colored = colors.map((color) => {
      const geo = base.clone();
      const array = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < geo.attributes.position.count; i++) { array[i * 3] = color.r; array[i * 3 + 1] = color.g; array[i * 3 + 2] = color.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(array, 3));
      return geo;
    });
    for (let i = 0; i < 740; i++) {
      const trail = TRAILS[Math.floor(r() * TRAILS.length)];
      const sample = trail.samples[Math.floor(r() * trail.samples.length)];
      const a = r() * Math.PI * 2, rad = range(r, 0, sample.width * 1.4);
      const x = sample.x + Math.cos(a) * rad, z = sample.z + Math.sin(a) * rad;
      if (Math.hypot(x, z) > WORLD_R) continue;
      const object = new THREE.Object3D();
      object.position.set(x, terrainHeight(x, z) + 0.055, z); object.rotation.set(0, r() * Math.PI * 2, 0); object.scale.setScalar(range(r, 0.55, 1.45)); object.updateMatrix();
      batch.add(colored[i % colored.length], object.matrix);
    }
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    this.materials.push(material);
    const mesh = new THREE.Mesh(batch.build(), material); mesh.receiveShadow = true;
    this.group.add(mesh);
    base.dispose(); colored.forEach((g) => g.dispose());
  }

  dispose(): void {
    this.group.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    this.materials.forEach(disposeMaterial); this.textures.forEach((t) => t.dispose());
  }
}
