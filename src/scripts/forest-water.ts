import * as THREE from 'three';
import { FOREST_PALETTE, FOREST_SUN_AZIMUTH, canvasTexture, disposeMaterial, softDiscTexture } from './forest-art';
import type { ForestDayLook } from './forest-art';
import { FALL_CREST_T, FALL_T, makeNoise2, range, riverPoint, riverWaterLevel, riverWidth, rng, waterLevelAt } from './forest-core';

function waterNoise(): THREE.Texture {
  const n = makeNoise2(515);
  const texture = canvasTexture(256, (g, size) => {
    const image = g.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = (n.fbm(x / size * 7, y / size * 7, 4) * 0.7 + n.fbm(x / size * 19, y / size * 19, 3) * 0.3) * 255;
      const i = (y * size + x) * 4; image.data[i] = image.data[i + 1] = image.data[i + 2] = v; image.data[i + 3] = 255;
    }
    g.putImageData(image, 0, 0);
  }, false);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
const waterVertex = /* glsl */`
  varying vec2 vUv; varying vec3 vWorld;
  uniform float uTime;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y += sin(world.x * 0.42 + uTime * 1.25) * sin(world.z * 0.37 - uTime) * 0.018;
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

export class ForestWater {
  readonly group = new THREE.Group();
  readonly fallCenter: THREE.Vector3;
  private materials: THREE.ShaderMaterial[] = [];
  private textures: THREE.Texture[] = [];
  private mist: THREE.Sprite[] = [];
  private mistBase: number[] = [];
  private env = 1;
  private sunDir = new THREE.Vector3(1, 0.5, 0.2).normalize();

  constructor() {
    this.group.name = 'storybook-water';
    const noise = waterNoise(); this.textures.push(noise);
    const shared = {
      uTime: { value: 0 }, uEnv: { value: 1 }, uNoise: { value: noise },
      uSunDir: { value: this.sunDir }, uSky: { value: new THREE.Color(FOREST_PALETTE.skyLight) },
      uDeep: { value: new THREE.Color(FOREST_PALETTE.waterDeep) }, uBase: { value: new THREE.Color(FOREST_PALETTE.water) },
      uLight: { value: new THREE.Color(FOREST_PALETTE.waterLight) },
    };
    const riverMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, shared]), vertexShader: waterVertex,
      fragmentShader: /* glsl */`
        uniform float uTime, uEnv; uniform sampler2D uNoise;
        uniform vec3 uSunDir, uSky, uDeep, uBase, uLight;
        varying vec2 vUv; varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          float a = texture2D(uNoise, vWorld.xz * 0.075 + vec2(uTime * 0.025, -uTime * 0.08)).r;
          float b = texture2D(uNoise, vWorld.xz * 0.14 + vec2(-uTime * 0.018, uTime * 0.06)).r;
          vec3 normal = normalize(vec3((a - 0.5) * 0.26, 1.0, (b - 0.5) * 0.26));
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float edge = abs(vUv.x - 0.5) * 2.0;
          vec3 color = mix(uDeep, uBase, 0.42 + a * 0.32);
          color = mix(color, uLight, smoothstep(0.64, 1.0, edge) * 0.46);
          float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 2.4);
          color = mix(color, uSky, fresnel * 0.42);
          vec3 halfDir = normalize(viewDir + normalize(uSunDir));
          float spec = pow(max(dot(normal, halfDir), 0.0), 110.0);
          color += uLight * spec * 0.72 * uEnv;
          float foam = smoothstep(0.82, 0.98, edge) * smoothstep(0.48, 0.74, b);
          color = mix(color, uLight * 1.12, foam * 0.62);
          color *= 0.3 + 0.7 * uEnv;
          gl_FragColor = vec4(color, 0.84 + fresnel * 0.1);
          #include <fog_fragment>
        }
      `,
    });
    // merge 会克隆 uniform，恢复共享引用以便逐帧更新。
    for (const key of Object.keys(shared) as (keyof typeof shared)[]) riverMaterial.uniforms[key] = shared[key];
    this.materials.push(riverMaterial);
    this.group.add(new THREE.Mesh(this.riverGeometry(), riverMaterial));

    const crest = riverPoint(FALL_CREST_T), foot = riverPoint(FALL_T);
    const flowX = foot.x - crest.x, flowZ = foot.z - crest.z, flowLength = Math.hypot(flowX, flowZ) || 1;
    const impact = { x: crest.x + flowX / flowLength * 3.1, z: crest.z + flowZ / flowLength * 3.1 };
    const measuredImpactLevel = waterLevelAt(impact.x, impact.z);
    const impactLevel = Number.isFinite(measuredImpactLevel) ? measuredImpactLevel : riverWaterLevel(FALL_T);
    this.fallCenter = new THREE.Vector3(impact.x, impactLevel, impact.z);
    const fallMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, shared]),
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv; vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz;
          vec4 mvPosition = viewMatrix * world; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime, uEnv; uniform sampler2D uNoise;
        uniform vec3 uDeep, uBase, uLight;
        varying vec2 vUv; varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          float streakA = texture2D(uNoise, vec2(vUv.x * 4.5, vUv.y * 1.2 - uTime * 0.72)).r;
          float streakB = texture2D(uNoise, vec2(vUv.x * 10.0 + 2.7, vUv.y * 2.4 - uTime * 1.35)).r;
          float streak = streakA * 0.65 + streakB * 0.35;
          float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(0.0, 0.1, 1.0 - vUv.x);
          vec3 color = mix(uBase * 0.72, uLight, 0.34 + streak * 0.54);
          color = mix(color, uDeep, smoothstep(0.72, 1.0, vUv.y) * 0.24);
          float threads = pow(smoothstep(0.5, 0.82, streak), 2.0);
          float topFoam = (1.0 - smoothstep(0.0, 0.075, vUv.y)) * (0.45 + streak * 0.55);
          float bottomFoam = smoothstep(0.82, 1.0, vUv.y) * (0.35 + streakB * 0.65);
          color = mix(color, uLight * 1.28, clamp(threads * 0.34 + topFoam * 0.72 + bottomFoam * 0.58, 0.0, 0.9));
          color *= 0.24 + 0.76 * uEnv;
          float alpha = (0.68 + streak * 0.22 + threads * 0.1) * edge;
          gl_FragColor = vec4(color, alpha);
          #include <fog_fragment>
        }
      `,
    });
    for (const key of Object.keys(shared) as (keyof typeof shared)[]) fallMaterial.uniforms[key] = shared[key];
    this.materials.push(fallMaterial);
    const fall = new THREE.Mesh(this.fallGeometry(crest, foot, impact, impactLevel), fallMaterial); fall.renderOrder = 3;
    this.group.add(fall);
    this.buildFoam(noise, shared.uTime, impact, impactLevel);
    this.buildSpray(impact, impactLevel);
    this.buildFallDrops(crest, impact, impactLevel);
    this.buildMist(impact, impactLevel);
  }

  private riverGeometry(): THREE.BufferGeometry {
    const steps = 220, across = 8, positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, p = riverPoint(t), before = riverPoint(Math.max(0, t - 0.004)), after = riverPoint(Math.min(1, t + 0.004));
      let nx = -(after.z - before.z), nz = after.x - before.x; const len = Math.hypot(nx, nz) || 1; nx /= len; nz /= len;
      for (let j = 0; j <= across; j++) {
        const u = j / across, offset = (u - 0.5) * 2 * (riverWidth(t) + 0.65);
        positions.push(p.x + nx * offset, riverWaterLevel(t), p.z + nz * offset); uvs.push(u, t);
        if (i < steps && j < across) {
          const a = i * (across + 1) + j, b = a + across + 1;
          indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
  }

  private fallGeometry(crest: { x: number; z: number }, foot: { x: number; z: number }, impact: { x: number; z: number }, impactLevel: number): THREE.BufferGeometry {
    const vertical = 26, across = 20, positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const q = riverPoint(FALL_CREST_T + 0.004);
    let nx = -(q.z - crest.z), nz = q.x - crest.x; const len = Math.hypot(nx, nz) || 1; nx /= len; nz /= len;
    const flowX = foot.x - crest.x, flowZ = foot.z - crest.z, flowLen = Math.hypot(flowX, flowZ) || 1;
    for (let i = 0; i <= vertical; i++) {
      const v = i / vertical;
      const centerX = THREE.MathUtils.lerp(crest.x, impact.x, v);
      const centerZ = THREE.MathUtils.lerp(crest.z, impact.z, v);
      const fallT = v * 0.18 + v * v * 0.82;
      const y = THREE.MathUtils.lerp(riverWaterLevel(FALL_CREST_T), impactLevel, fallT) + Math.sin(v * Math.PI) * 0.12;
      const width = riverWidth(FALL_CREST_T) * (1 + v * 0.17);
      for (let j = 0; j <= across; j++) {
        const u = j / across, offset = (u - 0.5) * 2 * width;
        const ripple = Math.sin(u * Math.PI * 14 + v * 2.0) * 0.055;
        positions.push(centerX + nx * offset + flowX / flowLen * ripple, y + Math.sin(u * 18 + v * 7) * 0.025, centerZ + nz * offset + flowZ / flowLen * ripple); uvs.push(u, v);
        if (i < vertical && j < across) {
          const a = i * (across + 1) + j, b = a + across + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
  }

  private buildFoam(noise: THREE.Texture, time: { value: number }, impact: { x: number; z: number }, impactLevel: number): void {
    for (let i = 0; i < 3; i++) {
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: time, uNoise: { value: noise }, uEnv: { value: 1 }, uPhase: { value: i * 1.7 } },
        vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: /* glsl */`
          uniform float uTime,uEnv,uPhase; uniform sampler2D uNoise; varying vec2 vUv;
          void main(){
            float n=texture2D(uNoise,vec2(vUv.x*3.0+uPhase,vUv.y*2.0-uTime*0.24)).r;
            float pulse=0.5+0.5*sin(uTime*0.8+uPhase);
            float a=smoothstep(0.38,0.7,n)*(0.08+pulse*0.08)*uEnv;
            gl_FragColor=vec4(vec3(0.75,0.9,0.78)*(0.3+0.7*uEnv),a);
          }
        `,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(new THREE.RingGeometry(1.2 + i * 1.4, 4.6 + i * 1.8, 64), material);
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(impact.x, impactLevel + 0.06 + i * 0.01, impact.z); mesh.renderOrder = 5;
      this.group.add(mesh);
    }
  }

  private buildFallDrops(crest: { x: number; z: number }, impact: { x: number; z: number }, impactLevel: number): void {
    const count = 190, r = rng(9277), positions = new Float32Array(count * 3), seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = r();
    const q = riverPoint(FALL_CREST_T + 0.004);
    let nx = -(q.z - crest.z), nz = q.x - crest.x; const nLen = Math.hypot(nx, nz) || 1; nx /= nLen; nz /= nLen;
    const pixelRatio = Math.min(devicePixelRatio || 1, 1.75);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uEnv: { value: 1 }, uPx: { value: 150 * pixelRatio }, uMax: { value: 8 * pixelRatio } },
      vertexShader: /* glsl */`
        uniform float uTime,uPx,uMax;attribute float aSeed;varying float vAlpha;
        void main(){
          float life=fract(uTime*(0.32+aSeed*0.4)+aSeed*13.0);float side=fract(aSeed*37.0)*2.0-1.0;
          float width=${riverWidth(FALL_CREST_T).toFixed(3)}*(1.0+life*0.16);
          vec3 top=vec3(${crest.x.toFixed(3)},${riverWaterLevel(FALL_CREST_T).toFixed(3)},${crest.z.toFixed(3)});
          vec3 bottom=vec3(${impact.x.toFixed(3)},${impactLevel.toFixed(3)},${impact.z.toFixed(3)});
          float fallT=life*0.18+life*life*0.82;
          vec3 p=mix(top,bottom,vec3(life,fallT,life));p+=vec3(${nx.toFixed(4)},0.0,${nz.toFixed(4)})*side*width;
          vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=min(uMax,(0.7+aSeed*1.3)*uPx/max(-mv.z,1.0));vAlpha=(0.18+aSeed*0.28)*smoothstep(0.0,0.08,life);
        }
      `,
      fragmentShader: `uniform float uEnv;varying float vAlpha;void main(){float m=1.0-smoothstep(0.1,0.5,length(gl_PointCoord-0.5));gl_FragColor=vec4(vec3(0.72,0.9,0.8)*(0.25+0.75*uEnv),vAlpha*m*uEnv);}`,
    });
    this.materials.push(material); const points = new THREE.Points(geometry, material); points.frustumCulled = false; points.renderOrder = 4; this.group.add(points);
  }

  private buildSpray(impact: { x: number; z: number }, impactLevel: number): void {
    const count = 240, r = rng(9311), positions = new Float32Array(count * 3), seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = r();
    const pixelRatio = Math.min(devicePixelRatio || 1, 1.75);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uEnv: { value: 1 }, uPx: { value: 180 * pixelRatio }, uMax: { value: 12 * pixelRatio } },
      vertexShader: /* glsl */`
        uniform float uTime,uPx,uMax; attribute float aSeed; varying float vAlpha;
        void main(){
          float life=fract(uTime*(0.28+aSeed*0.45)+aSeed*9.0); float a=aSeed*41.0;
          vec3 p=vec3(${impact.x.toFixed(3)}+cos(a)*(0.5+aSeed*2.5)*life*1.7,
            ${(impactLevel + 0.25).toFixed(3)}+(1.4+aSeed*3.2)*(1.0-life*0.82),
            ${impact.z.toFixed(3)}+sin(a)*(0.5+aSeed*2.5)*life*1.7);
          vec4 mv=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*mv;
          gl_PointSize=min(uMax,(1.0+aSeed*2.0)*uPx/max(-mv.z,1.0)); vAlpha=(1.0-life)*0.34;
        }
      `,
      fragmentShader: `uniform float uEnv; varying float vAlpha; void main(){float m=1.0-smoothstep(0.08,0.5,length(gl_PointCoord-0.5));gl_FragColor=vec4(vec3(0.75,0.92,0.84)*(0.25+0.75*uEnv),vAlpha*m*uEnv);}`,
    });
    this.materials.push(material);
    const points = new THREE.Points(geometry, material); points.frustumCulled = false; this.group.add(points);
  }

  private buildMist(impact: { x: number; z: number }, impactLevel: number): void {
    const texture = softDiscTexture('220,239,224'); this.textures.push(texture);
    const r = rng(9401);
    for (let i = 0; i < 5; i++) {
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.18, color: 0xc4decf });
      const sprite = new THREE.Sprite(material);
      const base = impactLevel + 1.2 + i * 0.55;
      sprite.position.set(impact.x + range(r, -3.5, 3.5), base, impact.z + range(r, -2.5, 2.5));
      sprite.scale.setScalar(4 + i * 1.15); this.mistBase.push(base); this.mist.push(sprite); this.group.add(sprite);
    }
  }

  update(time: number): void {
    for (const material of this.materials) if (material.uniforms.uTime) material.uniforms.uTime.value = time;
    this.mist.forEach((sprite, i) => {
      sprite.position.y = this.mistBase[i] + Math.sin(time * 0.42 + i * 1.7) * 0.32;
      (sprite.material as THREE.SpriteMaterial).opacity = (0.12 + 0.045 * Math.sin(time * 0.6 + i)) * this.env;
    });
  }
  setDay(look: ForestDayLook): void {
    this.env = look.waterLight;
    this.sunDir.set(Math.cos(look.elevDeg * Math.PI / 180) * Math.cos(FOREST_SUN_AZIMUTH), Math.sin(look.elevDeg * Math.PI / 180), Math.cos(look.elevDeg * Math.PI / 180) * Math.sin(FOREST_SUN_AZIMUTH)).normalize();
    for (const material of this.materials) {
      if (material.uniforms.uEnv) material.uniforms.uEnv.value = this.env;
      if (material.uniforms.uSky) material.uniforms.uSky.value.copy(look.skyMid);
    }
  }
  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) object.geometry.dispose();
      if (object instanceof THREE.Sprite) disposeMaterial(object.material);
    });
    this.materials.forEach(disposeMaterial); this.textures.forEach((texture) => texture.dispose());
  }
}
