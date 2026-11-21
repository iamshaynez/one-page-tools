import * as THREE from 'three';
import { barkDetailTexture, canopyDetailTexture, createWindMaterial, disposeMaterial } from './forest-art';
import type { WindMaterialPair, WindUniforms } from './forest-art';
import { createMushroomGeometry, createRockGeometry, createTreeGeometry } from './forest-assets';
import { DISCOVERIES, range, rng, terrainHeight } from './forest-core';

export class ForestLandmarks {
  readonly group = new THREE.Group();
  private barkMaterial: WindMaterialPair;
  private canopyMaterial: WindMaterialPair;
  private glowMaterial: THREE.MeshStandardMaterial;
  private stoneMaterial: THREE.MeshStandardMaterial;
  private glowLight: THREE.PointLight;
  private geometries = new Set<THREE.BufferGeometry>();

  constructor(wind: WindUniforms) {
    this.group.name = 'storybook-landmarks';
    const bark = barkDetailTexture(), leaves = canopyDetailTexture();
    this.barkMaterial = createWindMaterial(wind, 0.055, { roughness: 0.95, map: bark, bumpMap: bark, bumpScale: 0.12 }, 'bark');
    this.canopyMaterial = createWindMaterial(wind, 0.09, { roughness: 0.9, map: leaves, bumpMap: leaves, bumpScale: 0.16 }, 'canopy');
    this.glowMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, emissive: new THREE.Color('#37D6BA'), emissiveIntensity: 1.1 });
    this.stoneMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98 });
    const ancient = DISCOVERIES.find((d) => d.key === 'ancient')!;
    const tree = createTreeGeometry('broad', 11117, 0); this.geometries.add(tree.trunk); this.geometries.add(tree.canopy);
    const transform = new THREE.Matrix4().compose(
      new THREE.Vector3(ancient.pos.x, terrainHeight(ancient.pos.x, ancient.pos.z) - 0.18, ancient.pos.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2),
      new THREE.Vector3(1.45, 1.45, 1.45),
    );
    for (const [geometry, pair] of [[tree.trunk, this.barkMaterial], [tree.canopy, this.canopyMaterial]] as const) {
      const mesh = new THREE.Mesh(geometry, pair.material); mesh.applyMatrix4(transform); mesh.castShadow = mesh.receiveShadow = true; mesh.customDepthMaterial = pair.depthMaterial; this.group.add(mesh);
    }
    const glow = DISCOVERIES.find((d) => d.key === 'glow')!;
    const mushroom = createMushroomGeometry(11223, 0); this.geometries.add(mushroom);
    const count = 20, gm = new THREE.InstancedMesh(mushroom, this.glowMaterial, count), r = rng(11224), dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2 + range(r, -0.18, 0.18), rad = i < 4 ? range(r, 0.4, 1.3) : range(r, 1.5, 4.4);
      const x = glow.pos.x + Math.cos(a) * rad, z = glow.pos.z + Math.sin(a) * rad;
      dummy.position.set(x, terrainHeight(x, z) - 0.03, z); dummy.rotation.set(0, r() * Math.PI * 2, 0); dummy.scale.setScalar(i < 4 ? range(r, 0.9, 1.5) : range(r, 0.18, 0.58)); dummy.updateMatrix(); gm.setMatrixAt(i, dummy.matrix);
    }
    gm.instanceMatrix.needsUpdate = true; this.group.add(gm);
    this.glowLight = new THREE.PointLight(0x4be6c4, 3.5, 15, 1.7); this.glowLight.position.set(glow.pos.x, terrainHeight(glow.pos.x, glow.pos.z) + 1.2, glow.pos.z); this.group.add(this.glowLight);
    const stones = DISCOVERIES.find((d) => d.key === 'stones')!;
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2, x = stones.pos.x + Math.cos(a) * 3.2, z = stones.pos.z + Math.sin(a) * 3.2;
      const geometry = createRockGeometry(11300 + i, 0); this.geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, this.stoneMaterial); mesh.position.set(x, terrainHeight(x, z) - 0.1, z); mesh.rotation.set(range(r, -0.25, 0.25), r() * Math.PI * 2, range(r, -0.2, 0.2)); mesh.scale.setScalar(range(r, 1.3, 2.0)); mesh.castShadow = mesh.receiveShadow = true; this.group.add(mesh);
    }
  }
  setDay(day: number): void {
    const dusk = THREE.MathUtils.smoothstep(day, 0.62, 1);
    this.glowMaterial.emissiveIntensity = 0.35 + dusk * 1.15; this.glowLight.intensity = 0.8 + dusk * 3.2;
  }
  dispose(): void {
    this.group.traverse((object) => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    this.geometries.forEach((geometry) => geometry.dispose());
    disposeMaterial(this.barkMaterial.material); this.barkMaterial.depthMaterial.dispose();
    disposeMaterial(this.canopyMaterial.material); this.canopyMaterial.depthMaterial.dispose();
    disposeMaterial(this.glowMaterial); disposeMaterial(this.stoneMaterial);
  }
}
