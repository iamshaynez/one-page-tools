import * as THREE from 'three';
import { FOREST_PALETTE, canvasTexture, disposeMaterial } from './forest-art';
import type { ForestDayLook, ForestQualityProfile } from './forest-art';
import { TRAILS, WORLD_R, range, rng, scatter, smoothstep, terrainHeight } from './forest-core';

interface FlutterItem { p: THREE.Vector3; angle: number; speed: number; height: number }
export class ForestLife {
  readonly group = new THREE.Group();
  private pollen: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private fireflies: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private fireflyMax: number;
  private fireflyAmount = 1;
  private butterflies: THREE.InstancedMesh;
  private flutterItems: FlutterItem[] = [];
  private leaves: THREE.InstancedMesh;
  private leafItems: { x: number; y: number; z: number; scale: number; phase: number }[] = [];
  private dummy = new THREE.Object3D();
  private leafRandom = rng(1200);
  private day = 0.55;

  constructor(private profile: ForestQualityProfile) {
    this.group.name = 'storybook-life';
    this.pollen = this.buildPollen(profile.pollen);
    const fireflies = this.buildFireflies(profile.fireflies); this.fireflies = fireflies.points; this.fireflyMax = fireflies.max;
    this.butterflies = this.buildButterflies(profile.butterflies);
    this.leaves = this.buildLeaves(profile.leaves);
  }

  private buildPollen(count: number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const r = rng(71), positions = new Float32Array(count * 3), seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = range(r, -15, 15); positions[i * 3 + 1] = range(r, -6, 7); positions[i * 3 + 2] = range(r, -15, 15); seeds[i] = r();
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uDay: { value: 0.55 }, uPx: { value: 120 } },
      vertexShader: /* glsl */`
        uniform float uTime,uPx;attribute float aSeed;varying float vAlpha;
        void main(){vec3 p=position;p.x+=sin(uTime*(0.18+aSeed*0.25)+aSeed*40.0)*1.2;p.y+=sin(uTime*(0.13+aSeed*0.2)+aSeed*80.0)*0.7;vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=min(16.0,(0.55+aSeed)*uPx/max(-mv.z,1.0));vAlpha=0.25+0.75*(0.5+0.5*sin(uTime*(0.7+aSeed)+aSeed*90.0));}
      `,
      fragmentShader: /* glsl */`
        uniform float uDay;varying float vAlpha;
        void main(){float m=1.0-smoothstep(0.08,0.5,length(gl_PointCoord-0.5));vec3 c=mix(vec3(1.0,0.88,0.58),vec3(0.75,0.8,1.0),smoothstep(0.65,1.0,uDay));float dim=1.0-0.65*smoothstep(0.72,1.0,uDay);gl_FragColor=vec4(c,vAlpha*m*0.24*dim);}
      `,
    });
    const points = new THREE.Points(geometry, material); points.frustumCulled = false; this.group.add(points); return points;
  }

  private buildFireflies(count: number): { points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>; max: number } {
    const spots = scatter({ count, seed: 1723, minDist: 1.1, riverPad: 1.3, maxSlope: 0.65 });
    const r = rng(88), positions = new Float32Array(spots.length * 3), seeds = new Float32Array(spots.length);
    spots.forEach((p, i) => { positions[i * 3] = p.x; positions[i * 3 + 1] = terrainHeight(p.x, p.z) + range(r, 0.4, 2.4); positions[i * 3 + 2] = p.z; seeds[i] = r(); });
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uMix: { value: 0 }, uPx: { value: 200 } },
      vertexShader: /* glsl */`
        uniform float uTime,uPx;attribute float aSeed;varying float vAlpha;
        void main(){vec3 p=position;p.x+=sin(uTime*(0.3+aSeed*0.4)+aSeed*30.0)*0.8;p.y+=sin(uTime*(0.5+aSeed*0.3)+aSeed*60.0)*0.35;float blink=pow(max(sin(uTime*(1.2+aSeed*2.0)+aSeed*40.0),0.0),3.0);vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=min(14.0,(0.8+blink*1.8)*uPx/max(-mv.z,1.0));vAlpha=blink;}
      `,
      fragmentShader: `uniform float uMix;varying float vAlpha;void main(){float m=1.0-smoothstep(0.08,0.5,length(gl_PointCoord-0.5));gl_FragColor=vec4(vec3(0.68,1.0,0.46)*(1.1+vAlpha*1.3),vAlpha*m*uMix);}`,
    });
    const points = new THREE.Points(geometry, material); points.frustumCulled = false; this.group.add(points); return { points, max: spots.length };
  }

  private buildButterflies(count: number): THREE.InstancedMesh {
    const texture = canvasTexture(64, (g) => {
      g.translate(32, 32);
      for (const side of [-1, 1]) {
        g.save(); g.scale(side, 1);
        const gradient = g.createRadialGradient(10, -5, 1, 10, -5, 18);
        gradient.addColorStop(0, 'rgba(255,232,148,0.98)'); gradient.addColorStop(0.6, 'rgba(231,156,74,0.96)'); gradient.addColorStop(1, 'rgba(128,64,42,0)');
        g.fillStyle = gradient; g.beginPath(); g.ellipse(11, -6, 11, 9, -0.45, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(8, 7, 8, 6, 0.4, 0, Math.PI * 2); g.fill(); g.restore();
      }
      g.fillStyle = 'rgba(58,36,25,0.95)'; g.fillRect(-1.4, -13, 2.8, 26);
    });
    const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.25, side: THREE.DoubleSide, fog: true });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.25, 0.2), material, count);
    const r = rng(99), samples = TRAILS[0].samples;
    for (let i = 0; i < count; i++) {
      const s = samples[Math.floor(r() * samples.length)];
      this.flutterItems.push({ p: new THREE.Vector3(s.x + range(r, -4, 4), 0, s.z + range(r, -4, 4)), angle: r() * Math.PI * 2, speed: range(r, 0.45, 0.9), height: range(r, 0.7, 1.8) });
      this.flutterItems[i].p.y = terrainHeight(s.x, s.z) + this.flutterItems[i].height;
    }
    mesh.frustumCulled = false; this.group.add(mesh); return mesh;
  }

  private buildLeaves(count: number): THREE.InstancedMesh {
    const geometry = new THREE.PlaneGeometry(0.12, 0.2);
    const material = new THREE.MeshBasicMaterial({ color: '#C38C4D', side: THREE.DoubleSide, fog: true });
    const mesh = new THREE.InstancedMesh(geometry, material, count), r = rng(1200);
    for (let i = 0; i < count; i++) this.leafItems.push({ x: range(r, -24, 24), y: range(r, 2, 11), z: range(r, -24, 24), scale: range(r, 0.45, 1.2), phase: r() * 9 });
    mesh.frustumCulled = false; this.group.add(mesh); return mesh;
  }

  private updateButterflies(dt: number, time: number): void {
    this.flutterItems.forEach((item, i) => {
      item.angle += Math.sin(time * 0.31 + i * 2.6) * dt * 1.4;
      item.p.x += Math.cos(item.angle) * item.speed * dt; item.p.z += Math.sin(item.angle) * item.speed * dt;
      if (Math.hypot(item.p.x, item.p.z) > WORLD_R) item.angle += Math.PI;
      const targetY = terrainHeight(item.p.x, item.p.z) + item.height + Math.sin(time * 1.7 + i * 3.1) * 0.25;
      item.p.y += (targetY - item.p.y) * Math.min(dt * 2, 1);
      this.dummy.position.copy(item.p); this.dummy.rotation.set(0, -item.angle, Math.sin(time * 18 + i) * 0.12);
      const flap = 0.3 + Math.abs(Math.sin(time * 16 * item.speed + i * 7)); this.dummy.scale.set(flap, 1, 1); this.dummy.updateMatrix(); this.butterflies.setMatrixAt(i, this.dummy.matrix);
    });
    this.butterflies.instanceMatrix.needsUpdate = true;
  }
  private updateLeaves(dt: number, time: number, player: THREE.Vector3): void {
    this.leafItems.forEach((leaf, i) => {
      leaf.y -= dt * (0.3 + leaf.scale * 0.2); leaf.x += Math.sin(time * 0.9 + leaf.phase) * dt * 0.45; leaf.z += Math.cos(time * 0.7 + leaf.phase) * dt * 0.35;
      const worldX = player.x + leaf.x, worldZ = player.z + leaf.z;
      if (player.y - 1.45 + leaf.y < terrainHeight(worldX, worldZ)) { leaf.x = range(this.leafRandom, -14, 14); leaf.z = range(this.leafRandom, -14, 14); leaf.y = range(this.leafRandom, 6, 11); }
      this.dummy.position.set(player.x + leaf.x, player.y - 1.45 + leaf.y, player.z + leaf.z);
      this.dummy.rotation.set(time * (0.8 + leaf.scale) + leaf.phase, time * 0.6 + leaf.phase, Math.sin(time * 2 + leaf.phase) * 0.8); this.dummy.scale.setScalar(leaf.scale); this.dummy.updateMatrix(); this.leaves.setMatrixAt(i, this.dummy.matrix);
    });
    this.leaves.instanceMatrix.needsUpdate = true;
  }
  update(dt: number, time: number, player: THREE.Vector3): void {
    this.pollen.material.uniforms.uTime.value = time; this.pollen.material.uniforms.uDay.value = this.day; this.pollen.position.set(player.x, player.y - 0.4, player.z);
    this.fireflies.material.uniforms.uTime.value = time;
    this.fireflies.geometry.setDrawRange(0, Math.floor(this.fireflyMax * this.fireflyAmount));
    this.fireflies.material.uniforms.uMix.value = smoothstep(0.72, 0.95, this.day) * this.fireflyAmount;
    this.updateButterflies(dt, time); this.updateLeaves(dt, time, player);
  }
  setDay(look: ForestDayLook, day: number): void {
    this.day = day; this.pollen.material.uniforms.uDay.value = day;
    this.fireflies.material.uniforms.uMix.value = smoothstep(0.72, 0.95, day) * this.fireflyAmount;
    void look;
  }
  setFireflyAmount(value: number): void { this.fireflyAmount = THREE.MathUtils.clamp(value, 0, 1); }
  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        if (object instanceof THREE.InstancedMesh) object.dispose();
        object.geometry.dispose();
        const material = object.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach(disposeMaterial); else disposeMaterial(material);
      }
    });
  }
}
