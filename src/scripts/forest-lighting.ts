import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { FOREST_PALETTE, FOREST_SUN_AZIMUTH, forestDayLook } from './forest-art';
import type { ForestDayLook, ForestQualityProfile } from './forest-art';
import { DISCOVERIES, TRAILS, pathInfo, range, rng, terrainHeight } from './forest-core';

export function forestSunDirection(look: ForestDayLook, target = new THREE.Vector3()): THREE.Vector3 {
  const elevation = look.elevDeg * Math.PI / 180;
  return target.set(Math.cos(elevation) * Math.cos(FOREST_SUN_AZIMUTH), Math.sin(elevation), Math.cos(elevation) * Math.sin(FOREST_SUN_AZIMUTH)).normalize();
}

interface Beam { mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>; ground: THREE.Vector3; height: number; phase: number }
/** 天空、暖主光、冷补光、稳定阴影与有深度的林窗光束。 */
export class ForestLighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly rim: THREE.DirectionalLight;
  readonly fill: THREE.DirectionalLight;
  readonly sunDirection = new THREE.Vector3();
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private beams: Beam[] = [];
  private glades: { light: THREE.SpotLight; ground: THREE.Vector3 }[] = [];
  private look = forestDayLook(0.55);
  private target = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private renderer: THREE.WebGLRenderer, private profile: ForestQualityProfile) {
    scene.fog = new THREE.FogExp2(FOREST_PALETTE.fog, 0.011);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(320, 48, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
        uSunDir: { value: this.sunDirection }, uSunColor: { value: new THREE.Color() }, uStar: { value: 0 }, uTime: { value: 0 },
      },
      vertexShader: `varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop,uMid,uBottom,uSunDir,uSunColor;uniform float uStar,uTime;varying vec3 vDir;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        void main(){
          float h=clamp(vDir.y,-0.08,1.0);
          vec3 color=mix(uBottom,uMid,smoothstep(0.0,0.25,h));
          color=mix(color,uTop,smoothstep(0.18,0.76,h));
          float d=max(dot(vDir,normalize(uSunDir)),0.0);
          color+=uSunColor*(pow(d,900.0)*1.6+pow(d,22.0)*0.12)*(1.0-uStar*0.82);
          if(uStar>0.01&&vDir.y>0.03){
            vec2 p=vDir.xz/(vDir.y+0.35)*38.0;float s=step(0.9968,hash(floor(p)));
            color+=vec3(0.8,0.88,1.0)*s*uStar*(0.65+0.35*sin(uTime*2.0+hash(floor(p))*30.0));
          }
          gl_FragColor=vec4(color,1.0);
        }
      `,
    }));
    this.sky.renderOrder = -100; scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight(0xc5e0d8, 0x31483a, 0.88); scene.add(this.hemi);
    this.fill = new THREE.DirectionalLight(0xd8e7ce, 0.44); scene.add(this.fill, this.fill.target);
    this.sun = new THREE.DirectionalLight(0xffe1a8, 3.25);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(profile.shadowMap, profile.shadowMap);
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 150;
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -profile.shadowRadius;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = profile.shadowRadius;
    this.sun.shadow.bias = -0.00028; this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.camera.updateProjectionMatrix(); scene.add(this.sun, this.sun.target);
    this.rim = new THREE.DirectionalLight(0xffe7b8, 0.62); scene.add(this.rim, this.rim.target);
    this.buildBeams();
    this.buildGlades();
  }

  private buildGlades(): void {
    const anchors = [TRAILS[0].samples[4], TRAILS[0].samples[46]].slice(0, this.profile.name === 'low' ? 1 : 2);
    for (const anchor of anchors) {
      const ground = new THREE.Vector3(anchor.x, terrainHeight(anchor.x, anchor.z) + 0.1, anchor.z);
      const light = new THREE.SpotLight(0xffe1a8, 180, 27, 0.52, 0.92, 2);
      light.castShadow = false; this.scene.add(light, light.target); this.glades.push({ light, ground });
    }
  }

  private buildBeams(): void {
    const r = rng(10101), anchors: { x: number; z: number }[] = [];
    for (const index of [18, 38, 62, 88, 116, 138]) {
      const s = TRAILS[0].samples[Math.min(index, TRAILS[0].samples.length - 1)]; anchors.push({ x: s.x, z: s.z });
    }
    for (const key of ['meadow', 'fall', 'glow', 'ancient']) {
      const d = DISCOVERIES.find((item) => item.key === key)!; anchors.push({ x: d.pos.x + 2, z: d.pos.z - 1 });
    }
    anchors.slice(0, this.profile.beamCount).forEach((anchor, i) => {
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 }, uColor: { value: new THREE.Color('#FFE5AE') }, uOpacity: { value: 0.09 },
          uPhase: { value: r() * 10 }, uSunDir: { value: this.sunDirection },
        },
        vertexShader: /* glsl */`
          varying vec2 vUv;varying vec3 vWorld;varying vec3 vNormal;
          void main(){vUv=uv;vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*world;}
        `,
        fragmentShader: /* glsl */`
          uniform float uTime,uOpacity,uPhase;uniform vec3 uColor,uSunDir;
          varying vec2 vUv;varying vec3 vWorld;varying vec3 vNormal;
          void main(){
            vec3 viewDir=normalize(cameraPosition-vWorld);
            float facing=pow(abs(dot(normalize(vNormal),viewDir)),1.5);
            float vertical=smoothstep(0.0,0.15,vUv.y)*(1.0-smoothstep(0.82,1.0,vUv.y));
            float noise=0.78+0.22*sin(vWorld.y*1.7+uTime*0.42+uPhase);
            float toward=0.22+0.78*pow(max(dot(viewDir,-normalize(uSunDir)),0.0),2.0);
            float nearFade=smoothstep(0.4,3.0,distance(cameraPosition,vWorld));
            gl_FragColor=vec4(uColor,uOpacity*facing*vertical*noise*toward*nearFade);
          }
        `,
      });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, range(r, 1.3, 2.2), 1, 18, 1, true), material);
      mesh.renderOrder = 6;
      const ground = new THREE.Vector3(anchor.x + range(r, -1.2, 1.2), 0, anchor.z + range(r, -1.2, 1.2));
      ground.y = terrainHeight(ground.x, ground.z) + 0.08;
      this.scene.add(mesh); this.beams.push({ mesh, ground, height: range(r, 10, 16), phase: i * 0.7 });
    });
  }

  private layoutBeams(): void {
    for (const beam of this.beams) {
      beam.mesh.position.copy(beam.ground).addScaledVector(this.sunDirection, beam.height * 0.5);
      beam.mesh.quaternion.setFromUnitVectors(this.up, this.sunDirection);
      beam.mesh.scale.set(1, beam.height, 1);
    }
  }
  applyDay(day: number): ForestDayLook {
    this.look = forestDayLook(day); forestSunDirection(this.look, this.sunDirection);
    const u = this.sky.material.uniforms;
    u.uTop.value.copy(this.look.skyTop); u.uMid.value.copy(this.look.skyMid); u.uBottom.value.copy(this.look.skyBottom);
    u.uSunColor.value.copy(this.look.sunColor); u.uStar.value = this.look.star;
    this.sun.color.copy(this.look.sunColor); this.sun.intensity = this.look.sunIntensity;
    this.hemi.color.copy(this.look.hemiSky); this.hemi.groundColor.copy(this.look.hemiGround); this.hemi.intensity = this.look.hemiIntensity;
    this.rim.color.copy(this.look.rimColor); this.rim.intensity = this.look.rimIntensity;
    this.fill.color.copy(this.look.hemiSky).lerp(this.look.sunColor, 0.22); this.fill.intensity = 0.44 * (1 - this.look.star * 0.68);
    for (const glade of this.glades) {
      glade.light.color.copy(this.look.sunColor); glade.light.intensity = 180 * (1 - this.look.star * 0.88);
      glade.light.position.copy(glade.ground).addScaledVector(this.sunDirection, 12); glade.light.target.position.copy(glade.ground); glade.light.target.updateMatrixWorld();
    }
    const fog = this.scene.fog as THREE.FogExp2; fog.color.copy(this.look.fogColor); fog.density = this.look.fogDensity;
    this.renderer.setClearColor(this.look.fogColor, 1);
    for (const beam of this.beams) {
      beam.mesh.material.uniforms.uColor.value.copy(this.look.sunColor).lerp(this.look.skyMid, 0.18);
      beam.mesh.material.uniforms.uOpacity.value = 0.075 * (1 - this.look.star * 0.78);
    }
    this.layoutBeams();
    return this.look;
  }
  update(player: THREE.Vector3, time: number, dt: number): void {
    this.sky.position.copy(this.camera.position); this.sky.material.uniforms.uTime.value = time;
    const texel = this.profile.shadowRadius * 2 / this.profile.shadowMap;
    this.target.set(Math.round(player.x / texel) * texel, Math.round((player.y - 1.1) / texel) * texel, Math.round(player.z / texel) * texel);
    this.sun.position.copy(this.target).addScaledVector(this.sunDirection, 78); this.sun.target.position.copy(this.target); this.sun.target.updateMatrixWorld();
    this.rim.position.copy(this.target).addScaledVector(this.sunDirection, -38).add(new THREE.Vector3(0, 24, 0)); this.rim.target.position.copy(this.target); this.rim.target.updateMatrixWorld();
    this.fill.position.copy(this.target).add(new THREE.Vector3(-36, 24, -18)); this.fill.target.position.copy(this.target); this.fill.target.updateMatrixWorld();
    for (const beam of this.beams) beam.mesh.material.uniforms.uTime.value = time;
    const path = pathInfo(player.x, player.z);
    const openness = Number.isFinite(path.d) ? 1 - THREE.MathUtils.smoothstep(path.d, path.width + 0.5, path.width + 7) : 0.35;
    const targetExposure = this.look.exposure * (0.965 + openness * 0.065);
    this.renderer.toneMappingExposure += (targetExposure - this.renderer.toneMappingExposure) * Math.min(dt * 1.8, 1);
  }
  dispose(): void {
    this.sky.geometry.dispose(); this.sky.material.dispose();
    for (const beam of this.beams) { beam.mesh.geometry.dispose(); beam.mesh.material.dispose(); }
    for (const glade of this.glades) glade.light.dispose();
    this.sun.dispose(); this.rim.dispose(); this.fill.dispose();
  }
}

/** HDR → 接触 AO → 局部散射 → Bloom → 绘本调色 → 输出 → 显示空间抗锯齿/颗粒。 */
export class ForestPost {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private rays: ShaderPass;
  private grade: ShaderPass;
  private fxaa?: ShaderPass;
  private gtao?: GTAOPass;
  private display: ShaderPass;
  private beautyBloom = 1;
  private look = forestDayLook(0.55);
  private projected = new THREE.Vector3();
  private postEnabled = true;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private profile: ForestQualityProfile) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    if (profile.ao || new URLSearchParams(location.search).has('ao')) {
      this.gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
      this.gtao.blendIntensity = 0.32;
      this.gtao.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.4, thickness: 1.1, distanceFallOff: 1, scale: 1, samples: 8 });
      this.composer.addPass(this.gtao);
    }
    this.rays = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5) }, uStrength: { value: 0 }, uAspect: { value: 1 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;uniform vec2 uSun;uniform float uStrength,uAspect;varying vec2 vUv;
        void main(){
          vec3 base=texture2D(tDiffuse,vUv).rgb;if(uStrength<0.001){gl_FragColor=vec4(base,1.0);return;}
          vec2 toSun=uSun-vUv;vec3 acc=vec3(0.0);float weight=0.0;
          for(int i=0;i<8;i++){float t=float(i)/7.0;float w=1.0-t*0.9;vec3 s=texture2D(tDiffuse,vUv+toSun*t).rgb;acc+=max(s-vec3(0.72),vec3(0.0))*w;weight+=w;}
          float d=length((vUv-uSun)*vec2(uAspect,1.0));
          gl_FragColor=vec4(base+acc/max(weight,0.001)*exp(-d*2.8)*uStrength,1.0);
        }
      `,
    });
    this.composer.addPass(this.rays);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.42, 1.08); this.composer.addPass(this.bloom);
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uDay: { value: 0.55 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;uniform float uDay;varying vec2 vUv;
        void main(){
          vec3 c=max(texture2D(tDiffuse,vUv).rgb,vec3(0.0));float luma=dot(c,vec3(0.2126,0.7152,0.0722));
          c=mix(vec3(luma),c,1.12);
          float shadow=1.0-smoothstep(0.05,0.52,luma);float high=smoothstep(0.55,1.5,luma);
          c+=mix(vec3(-0.004,0.012,0.009),vec3(0.008,0.002,0.016),uDay)*shadow;
          c+=vec3(0.014,0.006,-0.006)*high*(1.0-uDay*0.5);
          gl_FragColor=vec4(max(c,vec3(0.0)),1.0);
        }
      `,
    });
    this.composer.addPass(this.grade); this.composer.addPass(new OutputPass());
    if (profile.fxaa) { this.fxaa = new ShaderPass(FXAAShader); this.composer.addPass(this.fxaa); }
    this.display = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;uniform float uTime;varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
        void main(){vec2 d=vUv-0.5;vec3 c=texture2D(tDiffuse,vUv).rgb;c*=1.0-smoothstep(0.18,0.72,dot(d,d))*0.11;c+=(hash(vUv*1517.0+fract(uTime)*7.7)-0.5)*0.009;gl_FragColor=vec4(c,1.0);}
      `,
    });
    this.composer.addPass(this.display);
  }
  setDay(look: ForestDayLook): void {
    this.look = look; this.grade.uniforms.uDay.value = look.day;
    this.applyBloom();
  }
  private applyBloom(): void {
    this.bloom.strength = this.look.bloomStrength * this.beautyBloom;
    this.bloom.threshold = this.look.bloomThreshold;
  }
  setBloom(value: number): void { this.beautyBloom = value; this.applyBloom(); }
  update(camera: THREE.PerspectiveCamera, sunDirection: THREE.Vector3, time: number): void {
    this.projected.copy(sunDirection).multiplyScalar(90).add(camera.position).project(camera);
    let strength = 0;
    if (this.projected.z < 1) {
      const ex = THREE.MathUtils.clamp((1.25 - Math.abs(this.projected.x)) / 0.35, 0, 1);
      const ey = THREE.MathUtils.clamp((1.25 - Math.abs(this.projected.y)) / 0.35, 0, 1);
      strength = 0.19 * ex * ey * (1 - this.look.star * 0.75) * this.beautyBloom;
      this.rays.uniforms.uSun.value.set(this.projected.x * 0.5 + 0.5, this.projected.y * 0.5 + 0.5);
      this.rays.uniforms.uAspect.value = camera.aspect;
    }
    this.rays.uniforms.uStrength.value = strength; this.display.uniforms.uTime.value = time;
  }
  setDebug(options: { noBloom?: boolean; noRays?: boolean; noAO?: boolean; noPost?: boolean }): void {
    if (options.noBloom) this.bloom.enabled = false;
    if (options.noRays) this.rays.enabled = false;
    if (options.noAO && this.gtao) this.gtao.enabled = false;
    this.postEnabled = !options.noPost;
  }
  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    const dpr = this.renderer.getPixelRatio();
    this.gtao?.setSize(Math.max(1, Math.floor(width * dpr * 0.5)), Math.max(1, Math.floor(height * dpr * 0.5)));
    this.bloom.setSize(Math.max(1, Math.floor(width * dpr * 0.65)), Math.max(1, Math.floor(height * dpr * 0.65)));
    this.fxaa?.material.uniforms.resolution.value.set(1 / (width * dpr), 1 / (height * dpr));
  }
  render(): void { if (this.postEnabled) this.composer.render(); else this.renderer.render(this.scene, this.camera); }
  dispose(): void {
    for (const pass of this.composer.passes) pass.dispose?.();
    this.composer.dispose();
  }
}
