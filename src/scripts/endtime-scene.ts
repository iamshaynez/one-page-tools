/**
 * 《时间的尽头》场景 — 一座已死的巨钟，中心坍缩成奇点。
 *
 * 构图：事件视界（纯黑球 + 菲涅尔红晕 + 光子环）
 *   ← 吸积盘（差速旋转着色器，多普勒集束）
 *   ← ISCO 环 / 潮汐半径 / 能层（彭罗斯）
 *   ← 幽灵表盘（六十刻 + 十二罗马数字，熵死剥落）
 *   ← 钟之残骸（表针、陀螺环、断裂弧；潮汐拉伸撕裂）
 *   ← 余烬尘埃（GPU 螺旋）+ 霍金辐射（CPU 逃逸粒子，可接住）
 *   ← 远方星尘；引力透镜后期 + 红移调色 + 暗角颗粒。
 *
 * 理论交互：
 *   · 推近视界 → 引力时间膨胀（dτ/dt=√(1−rs/d)，HUD 双时钟）+ 引力红移
 *   · 按住 → 时间倒流；推到 t=0 继续按住 → 大反弹（新纪元）
 *   · 轻点蓝色逃逸光子 → 接住（霍金辐射）
 *   · 能层内点击残骸 → 彭罗斯弹弓（抽取转动能量）
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  rng, range, pick, ROMAN_CLOCK, handSpeed, handLengths,
  easeOutCubic, easeInCubic, easeInOutSine, clamp01,
  dilationFactor, redshiftFromDilation, tidalStretch, inErgosphere,
  entropySchedule, entropyState,
} from './endtime-core';

export type BouncePhase = 'idle' | 't0' | 'expand' | 'reform';

export interface SceneTick {
  reversal: number;        // 0 正流 … 1 逆流
  elapsed: number;         // 场景已存在秒数
  dilation: number;        // 你的固有时流速 dτ/dt
  phase: BouncePhase;
  t0Progress: number;      // t=0 凝滞进度（到 1 触发大反弹）
  bounceCount: number;     // 宇宙纪元
  photons: number;         // 已接住的霍金光子
  energy: number;          // 已抽取的彭罗斯能量
  entropy: number;         // 表盘熵死比例 0..1
}

export interface SceneAudio {
  bell(): void;
  reversal(on: boolean): void;
  ping(): void;                                // 接住光子
  whoosh(): void;                              // 彭罗斯弹弓
  boom(): void;                                // 大反弹
  dilation(d: number): void;                   // 时间膨胀 → 声音降调
}

export interface SceneOptions {
  audio?: Partial<SceneAudio>;
  onTick?(info: SceneTick): void;
  onReady?(): void;
  onFirstTouch?(): void;
  labels?: HTMLElement | null;                 // 学者模式标签容器
}

const VOID = 0x050507;
const RED = new THREE.Color('#ce1432');
const HORIZON_R = 6.3;
const TIDAL_R = 13;
const ERGO_IN = 11.5, ERGO_OUT = 16.5;
const ENTROPY_DURATION = 480;                  // 表盘在 8 分钟观看后全部剥落
const ENTROPY_FALL = 3.5;                      // 每个元素坠落时长

/** 通幅噪声（GLSL 里的老朋友） */
const GLSL_NOISE = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 19.7; a *= 0.55; }
    return v;
  }
`;

// ---------------------------------------------------------------------------
// 纹理：罗马数字铭牌（canvas 生成，零素材）
// ---------------------------------------------------------------------------
function numeralTexture(text: string): THREE.Texture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  g.font = '700 126px "Noto Serif SC", Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255, 170, 80, 0.95)';
  g.shadowBlur = 34;
  g.fillStyle = '#ffd9a0';
  g.fillText(text, S / 2, S / 2 + 6);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255, 251, 240, 1)';
  g.fillText(text, S / 2, S / 2 + 6);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 深处的暗红辉光（径向渐变贴片，最便宜的体积感） */
function glowTexture(inner: string, outer: string): THREE.Texture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------
export function createScene(canvas: HTMLCanvasElement, opts: SceneOptions = {}) {
  const quality = (matchMedia('(pointer: coarse)').matches || innerWidth < 720) ? 'low' : 'high';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const audio = opts.audio ?? {};

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(VOID, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  const DPR = Math.min(devicePixelRatio || 1, quality === 'low' ? 1.75 : 2);
  renderer.setPixelRatio(DPR);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(VOID, 0.0075);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  camera.position.set(0, 30, 132); // 开场远景，入场时推近

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.enablePan = false;
  controls.minDistance = 15;   // 时间膨胀戏剧区间：dτ/dt ≈ 0.23
  controls.maxDistance = 110;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 2.45;
  controls.rotateSpeed = 0.55;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.3;
  controls.target.set(0, 1.2, 0);
  controls.enabled = false; // 入场动画结束再交还

  // ---- 灯光：暖主光 + 漆红逆光 + 跟随指针的烛光 ----
  scene.add(new THREE.AmbientLight(0x241d18, 2.4));
  const key = new THREE.DirectionalLight(0xffe2b8, 2.6);
  key.position.set(24, 26, 14);
  scene.add(key);
  const rim = new THREE.PointLight(RED.clone().lerp(new THREE.Color('#ff5a4a'), 0.5), 160, 120, 1.8);
  rim.position.set(-6, -8, -20);
  scene.add(rim);
  const candle = new THREE.PointLight(0xffd9a8, 60, 90, 1.9);
  candle.position.set(18, 10, 18);
  scene.add(candle);

  // ---- 深处的暗红辉光 ----
  const abyss = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,84,70,0.55)', 'rgba(120,18,24,0.28)'),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.34,
  }));
  abyss.scale.setScalar(150);
  scene.add(abyss);

  // ============================ 奇点 ============================
  const holeGroup = new THREE.Group(); // 大反弹时整体缩放
  scene.add(holeGroup);

  // 事件视界：纯黑球
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(HORIZON_R, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  holeGroup.add(horizon);

  // 菲涅尔红晕（呼吸的视界）
  const rimMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: {
      uTime: { value: 0 },
      uReversal: { value: 0 },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uReversal; uniform float uFade;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
        float breathe = 0.82 + 0.18 * sin(uTime * 0.9);
        vec3 deep = vec3(0.45, 0.03, 0.07);
        vec3 hot  = vec3(1.0, 0.42, 0.2);
        vec3 col = mix(deep, hot, f * (0.55 + 0.45 * uReversal)) * (1.2 + 1.4 * uReversal);
        // 加性混合 (SRC_ALPHA, ONE)：alpha 只乘一次，rgb 不再预乘
        gl_FragColor = vec4(col, f * breathe * uFade);
      }
    `,
  });
  const rimShell = new THREE.Mesh(new THREE.SphereGeometry(8.4, 48, 36), rimMat);
  holeGroup.add(rimShell);

  // 光子环：引力透镜的戏仿，永远面向镜头
  const photonMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    uniforms: { uTime: { value: 0 }, uReversal: { value: 0 }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uReversal; uniform float uFade;
      varying vec2 vUv;
      void main() {
        vec2 d = vUv - 0.5;
        float r = length(d) * 2.0;
        float ring = exp(-pow((r - 0.82) * 22.0, 2.0));
        float breathe = 0.75 + 0.25 * sin(uTime * 0.9 + 1.2);
        float a = ring * breathe * (0.62 + 0.5 * uReversal) * uFade;
        vec3 col = mix(vec3(1.0, 0.55, 0.28), vec3(1.0, 0.9, 0.72), ring);
        gl_FragColor = vec4(col * 1.3, a);
      }
    `,
  });
  const photonRing = new THREE.Mesh(new THREE.PlaneGeometry(15.5, 15.5), photonMat);
  photonRing.renderOrder = 5;
  scene.add(photonRing);

  // ============================ 盘面 ============================
  const diskGroup = new THREE.Group();
  diskGroup.rotation.set(-0.42, 0, 0.16);
  scene.add(diskGroup);

  const DISK_IN = 9.6, DISK_OUT = 30;

  const diskMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uDiskTime: { value: 0 },
      uInner: { value: DISK_IN },
      uOuter: { value: DISK_OUT },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uDiskTime;
      varying vec3 vPos;
      void main() {
        vPos = position;
        // 盘面轻微翘曲，像被引力揉皱
        float warp = sin(position.x * 0.22 + uDiskTime * 0.32) * cos(position.y * 0.19 - uDiskTime * 0.21);
        vec3 p = position + vec3(0.0, 0.0, warp * 0.9);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uDiskTime; uniform float uInner; uniform float uOuter; uniform float uFade;
      varying vec3 vPos;
      ${GLSL_NOISE}
      void main() {
        float r = length(vPos.xy);
        float rn = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
        float theta = atan(vPos.y, vPos.x);
        // 差速旋转：内缘狂转，外缘凝滞
        float spin = uDiskTime * 14.0 * pow(max(r, 1.0), -1.5);
        // 噪声在圆域采样（cos/sin），差速旋转自然剪切成螺旋流线，且无 atan 接缝
        float ang = theta + spin;
        vec2 dom = vec2(cos(ang), sin(ang));
        float streaks = fbm(dom * (2.2 + rn * 5.5) + vec2(rn * 3.0, -uDiskTime * 0.05));
        streaks = pow(streaks, 1.8) * 1.9;
        float filaments = fbm(vec2(dom.x * 2.0, dom.y * 2.0) * (3.0 + rn * 9.0) + 7.3);
        float density = clamp(streaks * 0.75 + filaments * 0.45, 0.0, 1.6);
        // 径向热度剖面：内白热、中琥珀、外深红
        float heat = pow(1.0 - rn, 2.1);
        vec3 col = mix(vec3(0.55, 0.04, 0.06), vec3(1.0, 0.55, 0.16), smoothstep(0.3, 0.85, 1.0 - rn));
        col = mix(col, vec3(1.0, 0.96, 0.86), pow(1.0 - rn, 8.0));
        col *= (0.48 + 0.5 * heat);
        // 多普勒集束：转过来的一侧亮得多更白更实，背离的一侧压暗偏红
        float beam = sin(theta - uDiskTime * 0.05);
        float beaming = max(1.0 + 0.9 * beam, 0.05);
        col = mix(col, vec3(1.0, 0.97, 0.9), max(beam, 0.0) * heat * 0.6);
        col = mix(col, vec3(0.72, 0.16, 0.06), max(-beam, 0.0) * 0.4);
        // 内外缘羽化（迎面一侧的盘更「实」，背离侧更稀薄）
        float edge = smoothstep(0.0, 0.05, rn) * (1.0 - smoothstep(0.8, 1.0, rn));
        float alpha = clamp(density * edge * (0.38 + 0.42 * heat) * (0.68 + 0.32 * (beam + 1.0) * 0.5), 0.0, 0.9);
        gl_FragColor = vec4(col * beaming, alpha * uFade);
      }
    `,
  });
  const disk = new THREE.Mesh(new THREE.RingGeometry(DISK_IN, DISK_OUT, 220, 8), diskMat);
  disk.renderOrder = 2;
  diskGroup.add(disk);

  // ---- ISCO：最内稳定圆轨道的细环（盘的内缘就是它） ----
  const iscoRing = new THREE.Mesh(
    new THREE.RingGeometry(DISK_IN - 0.08, DISK_IN + 0.12, 180),
    new THREE.MeshBasicMaterial({
      color: 0xffe8c8, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  diskGroup.add(iscoRing);

  // ---- 能层环带（彭罗斯）：有残骸驶入时脉亮 ----
  const ergoMat = new THREE.MeshBasicMaterial({
    color: 0xff9a5c, transparent: true, opacity: 0.045,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const ergoBand = new THREE.Mesh(new THREE.RingGeometry(ERGO_IN, ERGO_OUT, 160), ergoMat);
  diskGroup.add(ergoBand);

  // ============================ 幽灵表盘（熵死） ============================
  const gold = new THREE.MeshStandardMaterial({
    color: 0xe0bc72, metalness: 0.88, roughness: 0.34,
    emissive: 0xc07020, emissiveIntensity: 2.2,
  });
  const goldBright = new THREE.MeshStandardMaterial({
    color: 0xf0cf86, metalness: 0.85, roughness: 0.3,
    emissive: 0xd88a2e, emissiveIntensity: 4.0,
  });
  const dial = new THREE.Group();
  diskGroup.add(dial);
  const TICKS = quality === 'low' ? 60 : 90;
  const tickGeo = new THREE.BoxGeometry(0.09, 0.8, 0.09);
  const tickBig = new THREE.BoxGeometry(0.3, 3.6, 0.16);
  const tickMeshes = new THREE.InstancedMesh(tickGeo, gold, TICKS);
  const bigTickMeshes = new THREE.InstancedMesh(tickBig, goldBright, 12);
  dial.add(tickMeshes, bigTickMeshes);

  // 十二罗马数字铭牌
  const numeralGroup = new THREE.Group();
  diskGroup.add(numeralGroup);
  const numeralMats: THREE.MeshBasicMaterial[] = [];
  ROMAN_CLOCK.forEach((num, i) => {
    const mat = new THREE.MeshBasicMaterial({
      map: numeralTexture(num),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 1,
      side: THREE.DoubleSide,
    });
    numeralMats.push(mat);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 6.6), mat);
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    plaque.position.set(Math.cos(a) * 36, Math.sin(a) * 36, 0);
    plaque.rotation.z = a + Math.PI / 2; // 沿切向站立
    plaque.rotation.x = -Math.PI / 2;
    numeralGroup.add(plaque);
  });

  // ---- 熵死时刻表与矩阵复原数据 ----
  const seedRng = rng(20261117);
  interface EntropyItem {
    basePos: THREE.Vector3;
    baseQuat: THREE.Quaternion;
    detachAt: number;
    lastP: number;
    plaque?: THREE.Mesh;              // 数字铭牌走网格而非实例矩阵
    mat?: THREE.MeshBasicMaterial;
  }
  const entropyRng = rng(4321);
  const FALL_SIGN = (i: number) => (i % 2 === 0 ? 1 : -1);
  const entropySys: { mesh: THREE.InstancedMesh; items: EntropyItem[] }[] = [];
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1);
    const mk = (mesh: THREE.InstancedMesh, count: number, radius: number): EntropyItem[] => {
      const items: EntropyItem[] = [];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        q.setFromAxisAngle(up, a + Math.PI / 2); // 刻度长轴沿径向
        const pos = new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0);
        m.compose(pos, q, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, m);
        items.push({ basePos: pos, baseQuat: q.clone(), detachAt: 0, lastP: 0 });
      }
      mesh.instanceMatrix.needsUpdate = true;
      return items;
    };
    entropySys.push({ mesh: tickMeshes, items: mk(tickMeshes, TICKS, 32.2) });
    entropySys.push({ mesh: bigTickMeshes, items: mk(bigTickMeshes, 12, 33.6) });
    // 数字铭牌走同一时刻表（每块一个条目，直接持有网格引用）
    numeralGroup.children.forEach((plaque, i) => {
      entropySys.push({
        mesh: null as unknown as THREE.InstancedMesh,
        items: [{
          basePos: plaque.position.clone(),
          baseQuat: plaque.quaternion.clone(),
          detachAt: 0,
          lastP: 0,
          plaque: plaque as THREE.Mesh,
          mat: numeralMats[i],
        }],
      });
    });
    const all = entropySys.flatMap((s) => s.items);
    const schedule = entropySchedule(all.length, ENTROPY_DURATION, entropyRng);
    all.forEach((item, i) => { item.detachAt = schedule[i]; });
  }

  let entropyTime = 0; // 前进=熵增，倒流=复原；大反弹归零
  const entM = new THREE.Matrix4(), entS = new THREE.Vector3();
  function updateEntropy() {
    let dirty = false;
    for (const sys of entropySys) {
      for (let i = 0; i < sys.items.length; i++) {
        const item = sys.items[i];
        const p = entropyState(item.detachAt, ENTROPY_FALL, entropyTime);
        if (Math.abs(p - item.lastP) < 0.004) continue;
        item.lastP = p;
        dirty = true;
        if (!sys.mesh) {
          // 数字铭牌：位置/透明度动画
          const plaque = item.plaque!;
          if (p <= 0) {
            plaque.position.copy(item.basePos);
            plaque.quaternion.copy(item.baseQuat);
            item.mat!.opacity = 1;
          } else if (p >= 1) {
            item.mat!.opacity = 0;
          } else {
            const baseR = item.basePos.length();
            const baseA = Math.atan2(item.basePos.y, item.basePos.x);
            const r = baseR + (8.5 - baseR) * easeInCubic(p);
            const a = baseA + p * 2.4 * FALL_SIGN(i);
            plaque.position.set(Math.cos(a) * r, Math.sin(a) * r, Math.sin(p * Math.PI) * 1.6);
            item.mat!.opacity = 1 - p * 0.95;
          }
          continue;
        }
        if (p <= 0) {
          entS.set(1, 1, 1);
          entM.compose(item.basePos, item.baseQuat, entS);
        } else if (p >= 1) {
          entS.setScalar(0.0001);
          entM.compose(item.basePos, item.baseQuat, entS);
        } else {
          const baseR = item.basePos.length();
          const baseA = Math.atan2(item.basePos.y, item.basePos.x);
          const r = baseR + (8.5 - baseR) * easeInCubic(p);
          const a = baseA + p * 2.4 * FALL_SIGN(i);
          const s = 1 - 0.75 * p;
          entS.setScalar(s);
          entM.compose(
            new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.sin(p * Math.PI) * 1.6),
            item.baseQuat,
            entS,
          );
        }
        sys.mesh.setMatrixAt(i, entM);
        sys.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    return dirty;
  }

  // ============================ 钟之残骸 ============================
  interface Drift {
    pivot: THREE.Group;      // 轨道倾斜
    carrier: THREE.Group;    // 位于轨道点，+X 指向径向（潮汐拉伸轴）
    obj: THREE.Group;        // 翻滚的残骸本体
    ergo: THREE.Sprite;      // 能层高亮
    orbitSpeed: number;
    tumble: THREE.Vector3;
    angle: number;
    radius: number;
    fall: number;
    bounceBase: number;      // 大反弹时的基准半径
    hands?: THREE.Object3D[];
    handSpeeds?: number[];
    spreadDirs?: number[];   // 潮汐撕裂：子件分离方向
    flungTo?: number;        // 彭罗斯弹弓目标半径
    spinBoost: number;       // 弹弓后的旋转爆发
  }
  const drifts: Drift[] = [];
  const shardsGroup = new THREE.Group();
  scene.add(shardsGroup);
  const shardMeshes: THREE.Mesh[] = []; // 彭罗斯点击拾取
  const HAND_SETS = quality === 'low' ? 6 : 9;
  const GYROS = quality === 'low' ? 3 : 5;
  const ARCS = quality === 'low' ? 2 : 4;

  const mkDrift = (obj: THREE.Group, extra?: Partial<Drift>): Drift => {
    const pivot = new THREE.Group();
    pivot.rotation.set(range(seedRng, -0.9, 0.9), range(seedRng, 0, Math.PI * 2), range(seedRng, -0.6, 0.6));
    const carrier = new THREE.Group();
    pivot.add(carrier);
    obj.rotation.set(seedRng() * Math.PI, seedRng() * Math.PI, seedRng() * Math.PI);
    carrier.add(obj);
    // 能层高亮光斑
    const ergo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,190,120,0.9)', 'rgba(255,120,60,0.3)'),
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
    }));
    ergo.scale.setScalar(4.2);
    obj.add(ergo);
    shardsGroup.add(pivot);
    const radius = range(seedRng, 15, 29);
    const d: Drift = {
      pivot,
      carrier,
      obj,
      ergo,
      orbitSpeed: pick(seedRng, [0.05, -0.04, 0.07, -0.06, 0.035, -0.08]) * 0.7,
      tumble: new THREE.Vector3(range(seedRng, -0.3, 0.3), range(seedRng, -0.4, 0.4), range(seedRng, -0.3, 0.3)),
      angle: seedRng() * Math.PI * 2,
      radius,
      fall: range(seedRng, 0.05, 0.16),
      bounceBase: radius,
      spinBoost: 0,
      ...extra,
    };
    return d;
  };

  // 表针三针组（时针/分针/秒针 + 表轴 hub）
  for (let i = 0; i < HAND_SETS; i++) {
    const clock = new THREE.Group();
    const r = range(seedRng, 2.0, 3.4);
    const lens = handLengths(r);
    const hands: THREE.Object3D[] = [];
    const speeds: number[] = [];
    const spreadDirs: number[] = [0]; // hub 不动
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 16), gold);
    hub.rotation.x = Math.PI / 2;
    clock.add(hub);
    ([
      [lens.hour, 0.16],
      [lens.minute, 0.11],
      [lens.second, 0.055],
    ] as const).forEach(([len, w], j) => {
      const geo = new THREE.BoxGeometry(w, len, w * 0.7);
      geo.translate(0, len / 2, 0);
      const hand = new THREE.Mesh(geo, gold);
      hand.rotation.z = j * 2.1 + seedRng();
      clock.add(hand);
      hands.push(hand);
      speeds.push(handSpeed(i * 3 + j) * (j === 2 ? 3.2 : 1));
      spreadDirs.push(j === 0 ? 1 : j === 1 ? -1 : 1.8);
    });
    drifts.push(mkDrift(clock, { hands, handSpeeds: speeds, spreadDirs }));
  }

  // 陀螺环（像被拆下的机芯）
  for (let i = 0; i < GYROS; i++) {
    const ringR = range(seedRng, 2.1, 4.3);
    const gyro = new THREE.Group();
    const dirs: number[] = [];
    for (let j = 0; j < 2 + Math.floor(seedRng() * 2); j++) {
      const t = new THREE.Mesh(
        new THREE.TorusGeometry(ringR * (1 - j * 0.22), 0.1 + j * 0.02, 10, 72),
        gold,
      );
      t.rotation.set(seedRng() * Math.PI, seedRng() * Math.PI, 0);
      gyro.add(t);
      dirs.push(j % 2 === 0 ? 1 + j * 0.4 : -(1 + j * 0.4));
    }
    drifts.push(mkDrift(gyro, { spreadDirs: dirs }));
  }

  // 断裂弧（碎掉的表圈）
  for (let i = 0; i < ARCS; i++) {
    const arcR = range(seedRng, 3.0, 5.6);
    const arc = new THREE.Group();
    arc.add(new THREE.Mesh(
      new THREE.TorusGeometry(arcR, 0.14, 10, 80, range(seedRng, Math.PI * 0.7, Math.PI * 1.6)),
      gold,
    ));
    drifts.push(mkDrift(arc, { spreadDirs: [0] }));
  }

  // 拾取列表（不含光斑）
  drifts.forEach((d) => d.obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) shardMeshes.push(o as THREE.Mesh);
  }));

  // ============================ 余烬尘埃（GPU 螺旋） ============================
  const EMBERS = quality === 'low' ? 3200 : 7500;
  const R_MIN = 9.8, R_MAX = 44; // 内界在盘内缘之外：不遮蔽事件视界的黑色剪影
  const emberGeo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(EMBERS * 3);
    const aSeed = new Float32Array(EMBERS);
    const aR0 = new Float32Array(EMBERS);
    const aAngle0 = new Float32Array(EMBERS);
    const aRadial = new Float32Array(EMBERS);
    const aYOff = new Float32Array(EMBERS);
    const aSize = new Float32Array(EMBERS);
    for (let i = 0; i < EMBERS; i++) {
      aSeed[i] = seedRng();
      aR0[i] = R_MIN + Math.pow(seedRng(), 0.95) * (R_MAX - R_MIN);
      aAngle0[i] = seedRng() * Math.PI * 2;
      aRadial[i] = range(seedRng, 0.25, 0.85);
      aYOff[i] = (seedRng() - 0.5) * range(seedRng, 0.5, 5.5);
      aSize[i] = range(seedRng, 0.5, 2.1);
    }
    emberGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    emberGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    emberGeo.setAttribute('aR0', new THREE.BufferAttribute(aR0, 1));
    emberGeo.setAttribute('aAngle0', new THREE.BufferAttribute(aAngle0, 1));
    emberGeo.setAttribute('aRadial', new THREE.BufferAttribute(aRadial, 1));
    emberGeo.setAttribute('aYOff', new THREE.BufferAttribute(aYOff, 1));
    emberGeo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  }
  const emberMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uDiskTime: { value: 0 },
      uRMin: { value: R_MIN },
      uRMax: { value: R_MAX },
      uPx: { value: DPR * 130 },
      uShockR: { value: -1 },
      uShockAmp: { value: 0 },
      uShockCenter: { value: new THREE.Vector2(999, 999) },
      uExpand: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uDiskTime, uRMin, uRMax, uPx, uShockR, uShockAmp, uExpand;
      uniform vec2 uShockCenter;
      attribute float aSeed, aR0, aAngle0, aRadial, aYOff, aSize;
      varying float vAlpha; varying vec3 vColor; varying vec2 vRadial;
      void main() {
        // 与 endtime-core.spiralState 同一公式：锯齿式坠落 + 开普勒差速
        float cycle = (uRMax - uRMin) / aRadial;
        float phase = mod(uDiskTime * 0.55 + aSeed * cycle, cycle);
        float fallen = aR0 - aRadial * phase;
        float r = fallen <= uRMin ? uRMax : fallen;
        float theta = aAngle0 + 10.0 * pow(max(r, 1.0), -1.5) * uDiskTime * 3.0;
        // 湍流抖动
        theta += sin(uDiskTime * (0.4 + aSeed) + aSeed * 40.0) * 0.05;
        // 大反弹：全体向外飞散
        r *= 1.0 + 2.4 * uExpand;
        vec2 xy = vec2(cos(theta), sin(theta)) * r;
        vRadial = normalize(xy + 0.001);
        // 涟漪：从点击处荡开一圈推挤与增亮
        float shockD = distance(xy, uShockCenter);
        float wave = exp(-pow((shockD - uShockR) * 0.55, 2.0)) * uShockAmp;
        xy += vRadial * wave * 2.2;
        vec3 p = vec3(xy, aYOff * (1.0 + 0.2 * sin(uDiskTime * 0.3 + aSeed * 20.0)));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float rn = clamp((r - uRMin) / (uRMax - uRMin), 0.0, 1.0);
        // 坠到内缘即熄灭（最后一小段焚亮后消失，不越过视界）
        float horizonFade = smoothstep(0.0, 0.05, rn);
        float deathGlow = smoothstep(0.16, 0.05, rn) * horizonFade;
        float birth = smoothstep(0.0, 0.05, 1.0 - rn);
        float twinkle = 0.72 + 0.28 * sin(uDiskTime * (1.5 + aSeed * 3.0) + aSeed * 90.0);
        vColor = mix(vec3(0.68, 0.1, 0.05), vec3(1.0, 0.72, 0.34), 1.0 - rn);
        vColor = mix(vColor, vec3(1.0, 0.92, 0.75), deathGlow);
        vAlpha = min(twinkle * (0.3 + 0.6 * (1.0 - rn)) * birth * horizonFade * (1.0 + deathGlow * 1.2 + wave * 2.2), 0.85);
        vAlpha *= 1.0 - 0.82 * uExpand;
        gl_PointSize = aSize * uPx / max(-mv.z, 1.0) * (1.0 + deathGlow * 0.8 + wave);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha; varying vec3 vColor; varying vec2 vRadial;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        // 视界近旁的潮汐拉长：沿径向把光点抻成短线
        float along = dot(d, vRadial);
        float perp = dot(d, vec2(-vRadial.y, vRadial.x));
        float squash = 0.34 + 0.66 * clamp(vAlpha * 1.4, 0.0, 1.0);
        float m = smoothstep(0.5, 0.06, length(vec2(along * squash, perp)));
        gl_FragColor = vec4(vColor * 1.25, vAlpha * m);
      }
    `,
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.frustumCulled = false;
  diskGroup.add(embers);

  // 涟漪环（点击处的可见波纹）
  const ripples: { mesh: THREE.Mesh; born: number }[] = [];
  const rippleMatProto = new THREE.MeshBasicMaterial({
    color: 0xffc98a, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });

  // ============================ 霍金辐射（逃逸光子） ============================
  // 视界会吐出辐射：蓝白微粒逆着引力向外漂，可被轻点「接住」。
  const HAWKING = quality === 'low' ? 90 : 180;
  interface Hawk { pos: THREE.Vector3; vel: THREE.Vector3; life: number; total: number; flare: number }
  const hawks: Hawk[] = [];
  const hawkGeo = new THREE.BufferGeometry();
  const hawkPos = new Float32Array(HAWKING * 3);
  const hawkAlpha = new Float32Array(HAWKING);
  const hawkSize = new Float32Array(HAWKING);
  hawkGeo.setAttribute('position', new THREE.BufferAttribute(hawkPos, 3));
  hawkGeo.setAttribute('aAlpha', new THREE.BufferAttribute(hawkAlpha, 1));
  hawkGeo.setAttribute('aSize', new THREE.BufferAttribute(hawkSize, 1));
  const hawkMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { uPx: { value: DPR * 130 } },
    vertexShader: /* glsl */ `
      uniform float uPx;
      attribute float aAlpha, aSize;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vA = aAlpha;
        gl_PointSize = aSize * uPx / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float m = smoothstep(0.5, 0.05, length(d));
        vec3 col = mix(vec3(0.62, 0.78, 1.0), vec3(0.95, 0.98, 1.0), m);
        gl_FragColor = vec4(col * 1.6, vA * m);
      }
    `,
  });
  const hawkPoints = new THREE.Points(hawkGeo, hawkMat);
  hawkPoints.frustumCulled = false;
  scene.add(hawkPoints);
  let hawkSpawnT = 0;
  let photonsCaught = 0;

  function spawnHawk() {
    if (hawks.length >= HAWKING) return;
    // 从视界边缘随机方向出发，略偏向盘面法向上下
    const a = seedRng() * Math.PI * 2;
    const up = (seedRng() - 0.5) * 1.2;
    const dir = new THREE.Vector3(Math.cos(a), up * 0.45, Math.sin(a)).normalize();
    const speed = range(seedRng, 1.4, 2.6);
    hawks.push({
      pos: dir.clone().multiplyScalar(HORIZON_R + 0.4),
      vel: dir.multiplyScalar(speed),
      life: range(seedRng, 5.5, 9.5),
      total: 9.5,
      flare: 0,
    });
  }

  // ============================ 远方星尘 ============================
  const STARS = quality === 'low' ? 900 : 1900;
  const starGeo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(STARS * 3);
    const seed2 = new Float32Array(STARS);
    for (let i = 0; i < STARS; i++) {
      const u = seedRng() * 2 - 1;
      const t = seedRng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = range(seedRng, 160, 380);
      pos[i * 3] = Math.cos(t) * s * R;
      pos[i * 3 + 1] = u * R;
      pos[i * 3 + 2] = Math.sin(t) * s * R;
      seed2[i] = seedRng();
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed2, 1));
  }
  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uPx: { value: DPR * 380 } },
    vertexShader: /* glsl */ `
      uniform float uTime, uPx;
      attribute float aSeed;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = 0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 1.4) + aSeed * 80.0);
        vA = 0.25 + 0.65 * tw * aSeed;
        gl_PointSize = (1.1 + aSeed * 1.8) * uPx / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float m = smoothstep(0.5, 0.05, length(d));
        vec3 col = mix(vec3(0.72, 0.74, 0.8), vec3(0.95, 0.85, 0.72), vA);
        gl_FragColor = vec4(col, vA * m);
      }
    `,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ============================ 后期链 ============================
  // 渲染 → 辉光 → 色调映射 → 引力透镜 → 调色（暗角/颗粒/色散/红移）
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight).multiplyScalar(quality === 'low' ? 0.6 : 0.75),
    0.72, 0.5, 0.35,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // 引力透镜：屏幕空间绕奇点向内拖拽采样，附三色色散（爱因斯坦环的戏仿）
  const lensPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uRadius: { value: 0.1 },
      uAspect: { value: 1.7 },
      uStrength: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uCenter; uniform float uRadius, uAspect, uStrength;
      varying vec2 vUv;
      // 采样点绕洞心向内拖拽：背景在剪影边缘被拉成环
      vec2 bend(vec2 uv, float f) {
        vec2 v = uv - uCenter;
        v.x *= uAspect;
        float r = max(length(v), 1e-4);
        float pull = uStrength * f / r;
        float r2 = max(r - pull, 0.015);
        vec2 dir = v / r;
        vec2 out_ = dir * (r2 - r);
        out_.x /= uAspect;
        return uv + out_;
      }
      void main() {
        if (uStrength < 1e-4) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
        vec3 col;
        col.r = texture2D(tDiffuse, bend(vUv, 1.06)).r;
        col.g = texture2D(tDiffuse, bend(vUv, 1.0)).g;
        col.b = texture2D(tDiffuse, bend(vUv, 0.94)).b;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  composer.addPass(lensPass);

  const finalPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uReversal: { value: 0 },
      uRedshift: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime, uReversal, uRedshift;
      varying vec2 vUv;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }
      void main() {
        vec2 d = vUv - 0.5;
        float r2 = dot(d, d);
        // 边缘轻微色散：逆流时加强
        vec2 off = d * r2 * (0.035 + 0.08 * uReversal);
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
        // 引力红移：靠近视界，世界沉入暗红
        col *= vec3(1.0, 1.0 - 0.38 * uRedshift, 1.0 - 0.6 * uRedshift);
        col *= 1.0 - 0.16 * uRedshift;
        // 暗角
        col *= 1.0 - smoothstep(0.18, 0.62, r2) * 0.42;
        // 胶片颗粒
        col += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 7.13) - 0.5) * 0.045;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  composer.addPass(finalPass);

  // ============================ 学者模式标签 ============================
  interface Label { el: HTMLDivElement; anchor: THREE.Object3D; world: THREE.Vector3 }
  const labels: Label[] = [];
  let scholar = false;
  if (opts.labels) {
    const defs: { text: string; parent: THREE.Object3D; pos: [number, number, number] }[] = [
      { text: '事件视界', parent: scene, pos: [-7.8, -2.8, 0] },
      { text: '光子球', parent: scene, pos: [7.4, 2.6, 0] },
      { text: '霍金辐射 · 逃逸的光', parent: scene, pos: [1.5, 11.5, -2] },
      { text: '潮汐撕裂半径', parent: diskGroup, pos: [-12.4, 5.2, 0.4] },
      { text: '能层 · 彭罗斯', parent: diskGroup, pos: [-10.7, -9.4, 0.4] },
      { text: 'ISCO · 最内稳定圆轨道', parent: diskGroup, pos: [9.2, 4.4, 0.4] },
      { text: '吸积盘 · 差速旋转', parent: diskGroup, pos: [-20.4, -4.6, 0.6] },
      { text: '余烬螺旋', parent: diskGroup, pos: [-12.6, 22.8, 0.8] },
      { text: '幽灵表盘 · 熵死中', parent: diskGroup, pos: [19.4, 25.6, 0.5] },
      { text: '钟之残骸', parent: diskGroup, pos: [9.4, -15.8, 0.8] },
    ];
    for (const def of defs) {
      const el = document.createElement('div');
      el.className = 'scholar-label';
      el.innerHTML = '<i></i><span></span>';
      el.querySelector('span')!.textContent = def.text;
      opts.labels.appendChild(el);
      const anchor = new THREE.Object3D();
      anchor.position.set(...def.pos);
      def.parent.add(anchor);
      labels.push({ el, anchor, world: new THREE.Vector3() });
    }
  }
  function setScholar(on: boolean) {
    scholar = on;
    opts.labels?.classList.toggle('on', on);
  }

  // ============================ 交互 ============================
  let reversalTarget = 0;
  let reversal = 0;
  let reversalEngaged = false;
  let reversalLatched = false;
  let diskTime = 0;
  let elapsed = 0;
  let shockR = -1, shockAmp = 0;
  const shockCenter = new THREE.Vector2(999, 999);
  let penroseCount = 0;
  let dilation = 1;
  let dilationSent = 1;

  // 大反弹状态机
  let phase: BouncePhase = 'idle';
  let t0Hold = 0;
  let uExpand = 0;
  let expandT = 0, reformT = 0;
  let bounceCount = 0;
  let flash = 0;

  const raycaster = new THREE.Raycaster();
  const diskPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1).applyEuler(diskGroup.rotation), 0);
  const hit = new THREE.Vector3();

  let pDown = false;
  let pMoved = 0;
  let pDownAt = 0;
  const pStart = { x: 0, y: 0 };
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let touched = false;

  const ndc = new THREE.Vector2();
  const setNdc = (x: number, y: number) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  };

  const engageReversal = () => {
    if (phase !== 'idle') return; // 大反弹进行中不接受新的倒流
    reversalEngaged = true;
    reversalTarget = 1;
    if (!reversalLatched) { reversalLatched = true; audio.reversal?.(true); }
  };
  const releaseReversal = () => {
    reversalEngaged = false;
    reversalTarget = 0;
    if (reversalLatched) { reversalLatched = false; audio.reversal?.(false); }
  };

  canvas.addEventListener('pointerdown', (e) => {
    pDown = true;
    pMoved = 0;
    pDownAt = performance.now();
    pStart.x = e.clientX; pStart.y = e.clientY;
    setNdc(e.clientX, e.clientY);
    if (!touched) { touched = true; opts.onFirstTouch?.(); }
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (pDown && pMoved < 9) engageReversal();
    }, 330);
  });
  canvas.addEventListener('pointermove', (e) => {
    pMoved = Math.max(pMoved, Math.hypot(e.clientX - pStart.x, e.clientY - pStart.y));
    setNdc(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (holdTimer) clearTimeout(holdTimer);
    if (!pDown) return;
    const quick = performance.now() - pDownAt < 300;
    if (reversalEngaged) {
      releaseReversal();
    } else if (quick && pMoved < 7) {
      routeTap(e.clientX, e.clientY);
    }
    pDown = false;
  });
  canvas.addEventListener('pointercancel', () => {
    if (holdTimer) clearTimeout(holdTimer);
    releaseReversal();
    pDown = false;
  });
  canvas.addEventListener('pointerleave', () => {
    if (holdTimer) clearTimeout(holdTimer);
    releaseReversal();
    pDown = false;
  });

  /** 轻点路由：接住霍金光子 → 彭罗斯弹弓 → 盘面涟漪 */
  function routeTap(x: number, y: number) {
    setNdc(x, y);
    raycaster.setFromCamera(ndc, camera);

    // 1) 霍金光子：找离射线最近的存活光子
    let best = -1, bestD = 2.1;
    for (let i = 0; i < hawks.length; i++) {
      const h = hawks[i];
      const a = hawkAlphaAt(h);
      if (a < 0.25) continue;
      const d = raycaster.ray.distanceToPoint(h.pos);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      const h = hawks[best];
      h.flare = 1;
      h.life = Math.min(h.life, 0.5); // 焚亮后谢幕
      photonsCaught++;
      spawnSparkRing(h.pos);
      audio.ping?.();
      return;
    }

    // 2) 彭罗斯弹弓：能层内的残骸
    const hits = raycaster.intersectObjects(shardMeshes, false);
    if (hits.length > 0) {
      const mesh = hits[0].object as THREE.Mesh;
      const drift = drifts.find((d) => {
        let found = false;
        d.obj.traverse((o) => { if (o === mesh) found = true; });
        return found;
      });
      if (drift && inErgosphere(drift.radius, ERGO_IN, ERGO_OUT)) {
        drift.flungTo = Math.min(drift.radius + 7.5, 34);
        drift.spinBoost = 6;
        drift.ergo.material.opacity = 1;
        penroseCount++;
        audio.whoosh?.();
        return;
      }
    }

    // 3) 盘面涟漪
    if (raycaster.ray.intersectPlane(diskPlane, hit)) {
      const local = diskGroup.worldToLocal(hit.clone());
      const r = Math.hypot(local.x, local.y);
      if (r < R_MAX + 4 && r > 2) {
        shockCenter.set(local.x, local.y);
        shockR = 0;
        shockAmp = reducedMotion ? 0.3 : 1;
        const mesh = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 96), rippleMatProto.clone());
        mesh.position.set(local.x, local.y, 0.2);
        mesh.renderOrder = 3;
        diskGroup.add(mesh);
        ripples.push({ mesh, born: elapsed });
        audio.bell?.();
      }
    }
  }

  function hawkAlphaAt(h: Hawk): number {
    const fadeIn = clamp01((h.total - h.life) / 0.7);
    const fadeOut = clamp01(h.life / 1.6);
    return fadeIn * fadeOut * (1 + h.flare * 1.5);
  }

  function spawnSparkRing(worldPos: THREE.Vector3) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 64), rippleMatProto.clone());
    (mesh.material as THREE.MeshBasicMaterial).color.set(0xbfe0ff);
    mesh.position.copy(worldPos);
    mesh.renderOrder = 3;
    scene.add(mesh);
    ripples.push({ mesh, born: elapsed });
  }

  // 空格键也能倒流（无障碍；不劫持按钮上的空格）
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    if ((e.target as HTMLElement)?.closest('button, a, input, textarea')) return;
    e.preventDefault();
    engageReversal();
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'Space') releaseReversal();
  });

  // 拖拽时暂停自转，松手 5 秒后恢复
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    if (idleTimer) clearTimeout(idleTimer);
  });
  controls.addEventListener('end', () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { controls.autoRotate = !reducedMotion; }, 5000);
  });

  // ---- 调试参数（无头验证各状态用，日常无害） ----
  // 注意：无头虚拟时间下 rAF 帧稀疏（dt 被钳制），DOM 定时器与场景时间脱钩，
  // 因此时间类状态一律按「场景时钟」调度或直接跳相位。
  const q = new URLSearchParams(location.search);
  const debugHooks: (() => void)[] = [];
  if (q.has('dive')) debugHooks.push(() => {
    const dist = camera.position.distanceTo(controls.target);
    if (dist > 18) {
      const dir = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(controls.target.clone().add(dir.multiplyScalar(16)));
    }
  });
  if (q.has('scholar')) debugHooks.push(() => setScholar(true)); // 首帧即开：无头帧稀疏时 transform 也能就位
  if (q.has('probe')) setInterval(() => {
    document.title = `r${reversal.toFixed(2)} e${+reversalEngaged} d${diskTime.toFixed(1)} ${phase} f${frameN} e${elapsed.toFixed(1)}`;
  }, 300);
  const holdMode = q.has('rewind') ? 1 : 0;
  let enteredDebugPhase = false;
  if (holdMode) {
    // 首帧立即全量倒流并钉住（无头帧稀疏，跳过一切阈值）
    debugHooks.push(() => {
      if (!enteredDebugPhase) {
        enteredDebugPhase = true;
        engageReversal();
      }
      reversal = 1;
      diskTime = 5.0; // 钉在正值：可见的逆向螺旋，但不抵达 t=0
      if (phase === 't0') { phase = 'idle'; t0Hold = 0; }
    });
  }
  if (q.has('t0')) debugHooks.push(() => {
    if (!enteredDebugPhase && phase === 'idle') {
      enteredDebugPhase = true;
      engageReversal();
      reversal = 1;
      reversalTarget = 1;
      diskTime = 0;
      phase = 't0';
      t0Hold = 2.55;
    }
    if (phase === 't0') t0Hold = Math.min(t0Hold, 2.55); // 钉在 85%，便于稳定观察
    if (phase === 'expand') { phase = 't0'; t0Hold = 2.55; } // 不触发反弹
  });
  if (q.has('bounce')) debugHooks.push(() => {
    if (!enteredDebugPhase) {
      enteredDebugPhase = true;
      diskTime = 0;
      reversal = 0.5;
      phase = 'expand';
      expandT = 1.4;
      bounceCount = 1;
      flash = 0.4;
      uExpand = easeOutCubic(clamp01(expandT / 3.5));
      for (const d of drifts) d.bounceBase = d.radius;
      entropyTime = 0;
      hawks.length = 0;
    }
    if (phase === 'expand' && expandT > 1.6) expandT = 1.4; // 钉在中段绽放
    if (phase === 'reform') { phase = 'expand'; expandT = 1.4; } // 不走出绽放段
  });
  if (q.has('age')) entropyTime = Number(q.get('age')) || 0;

  // ============================ 主循环 ============================
  const clock = new THREE.Clock();
  const camIntroFrom = camera.position.clone();
  const camIntroTo = new THREE.Vector3(-13.5, 14.5, 40);
  const skipIntro = reducedMotion || q.has('fast');
  let introT = skipIntro ? 1 : 0;
  let ready = false;
  let raf = 0;
  let frameN = 0; // 调试探针：实际执行帧数

  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const candleSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 34);
  const holeNdc = new THREE.Vector3();

  function frame() {
    raf = requestAnimationFrame(frame);
    frameN++;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    elapsed += dt;
    for (const h of debugHooks) h();

    // ---- 大反弹状态机 ----
    if (phase === 'idle') {
      diskTime += dt * (1 - 2.8 * reversal);
      if (diskTime < 0) {
        diskTime = 0;
        if (reversalEngaged) { phase = 't0'; t0Hold = 0; }
      }
    } else if (phase === 't0') {
      diskTime = 0;
      if (reversalEngaged) {
        t0Hold += dt;
        if (t0Hold >= 3) {
          phase = 'expand';
          expandT = 0;
          bounceCount++;
          entropyTime = 0;     // 新宇宙换一座新钟
          flash = 1;
          for (const d of drifts) d.bounceBase = d.radius;
          hawks.length = 0;
          releaseReversal();
          audio.boom?.();
        }
      } else {
        phase = 'idle'; // 松手：时间重新流动
      }
    } else if (phase === 'expand') {
      expandT += dt;
      uExpand = easeOutCubic(clamp01(expandT / 3.5));
      diskTime = 0;
      if (expandT >= 3.5) { phase = 'reform'; reformT = 0; }
    } else { // reform
      reformT += dt;
      uExpand = 1 - easeInOutSine(clamp01(reformT / 6));
      diskTime = 0;
      if (reformT >= 6) { phase = 'idle'; uExpand = 0; }
    }

    // ---- 倒流系数 / 熵时钟 ----
    reversal += (reversalTarget - reversal) * Math.min(dt * 2.6, 1);
    if (phase === 'idle') {
      entropyTime = Math.max(0, entropyTime + dt * (1 - 3.2 * reversal));
    }

    // ---- 引力时间膨胀（相机到视界的距离决定你的钟速） ----
    dilation = dilationFactor(camera.position.distanceTo(controls.target));
    const redshift = redshiftFromDilation(dilation);
    if (audio.dilation && Math.abs(dilation - dilationSent) > 0.02) {
      dilationSent = dilation;
      audio.dilation(dilation);
    }

    // ---- 入场推近 ----
    if (introT < 1) {
      introT = Math.min(introT + dt / 3.4, 1);
      const k = easeOutCubic(introT);
      camera.position.lerpVectors(camIntroFrom, camIntroTo, k);
      if (introT >= 1) controls.enabled = true;
    }
    controls.update();

    // ---- 奇点呼吸与大反弹缩放 ----
    const holeScale = 1 - 0.88 * uExpand;
    const breathe = 1 + 0.02 * Math.sin(t * 0.9);
    holeGroup.scale.setScalar(holeScale * breathe);
    rimMat.uniforms.uTime.value = t;
    rimMat.uniforms.uReversal.value = reversal;
    rimMat.uniforms.uFade.value = 1 - uExpand * 0.9;
    photonMat.uniforms.uTime.value = t;
    photonMat.uniforms.uReversal.value = reversal;
    photonMat.uniforms.uFade.value = 1 - uExpand * 0.85;
    photonRing.quaternion.copy(camera.quaternion);
    photonRing.scale.setScalar(holeScale);
    abyss.material.opacity = (0.34 + 0.3 * reversal + 0.07 * Math.sin(t * 0.9)) * (1 - uExpand);

    // ---- 盘面 / 幽灵表盘 / 熵死 ----
    diskMat.uniforms.uDiskTime.value = diskTime;
    diskMat.uniforms.uFade.value = 1 - uExpand * 0.88;
    emberMat.uniforms.uDiskTime.value = diskTime;
    emberMat.uniforms.uExpand.value = uExpand;
    iscoRing.material.opacity = 0.16 * (1 - uExpand);
    dial.rotation.z -= dt * 0.012 * (1 - 2 * reversal);
    numeralGroup.rotation.z = dial.rotation.z;
    updateEntropy();

    // ---- 涟漪推进 ----
    if (shockAmp > 0.001) {
      shockR += dt * 26;
      shockAmp *= Math.pow(0.32, dt);
      emberMat.uniforms.uShockR.value = shockR;
      emberMat.uniforms.uShockAmp.value = shockAmp;
      emberMat.uniforms.uShockCenter.value.copy(shockCenter);
    } else {
      emberMat.uniforms.uShockAmp.value = 0;
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      const age = elapsed - rp.born;
      const k = clamp01(age / 1.6);
      rp.mesh.scale.setScalar(1 + k * 30);
      (rp.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.55;
      if (k >= 1) {
        (rp.mesh.parent as THREE.Object3D).remove(rp.mesh);
        rp.mesh.geometry.dispose();
        (rp.mesh.material as THREE.Material).dispose();
        ripples.splice(i, 1);
      }
    }

    // ---- 残骸漂流 / 潮汐拉伸 / 彭罗斯 ----
    let ergoOccupied = false;
    for (const d of drifts) {
      const dir = 1 - 2 * reversal;
      d.angle += d.orbitSpeed * dir * dt * (1 + reversal * 1.6);
      if (d.flungTo !== undefined) {
        d.radius += (d.flungTo - d.radius) * Math.min(dt * 2.2, 1);
        if (Math.abs(d.flungTo - d.radius) < 0.1) d.flungTo = undefined;
      } else if (phase === 'expand' || phase === 'reform') {
        d.radius = d.bounceBase * (1 + 2.5 * uExpand);
      } else {
        d.radius -= d.fall * dt * (1 - 2.2 * reversal);
      }
      if (d.radius < 8.6) d.radius = 29;  // 坠入后重生
      if (d.radius > 34) d.radius = 34;

      d.carrier.position.set(Math.cos(d.angle) * d.radius, 0, Math.sin(d.angle) * d.radius);
      d.carrier.rotation.y = -d.angle; // carrier +X 指向径向
      // 潮汐拉伸：径向拉长、切向压扁（保体积）
      const st = tidalStretch(d.radius, TIDAL_R);
      d.carrier.scale.set(st, 1 / Math.sqrt(st), 1 / Math.sqrt(st));
      // 撕裂分离：子件沿径向散开
      if (d.spreadDirs) {
        const sep = (st - 1) * 1.6;
        d.obj.children.forEach((c, j) => {
          if (j >= (d.spreadDirs?.length ?? 0)) return;
          if (c === d.ergo) return;
          c.position.x = d.spreadDirs![Math.min(j, d.spreadDirs!.length - 1)] * sep;
        });
      }
      // 翻滚（弹弓时爆发）
      const boost = 1 + d.spinBoost;
      d.spinBoost *= Math.pow(0.3, dt);
      d.obj.rotation.x += d.tumble.x * dt * boost;
      d.obj.rotation.y += d.tumble.y * dt * boost;
      d.obj.rotation.z += d.tumble.z * dt * 0.5 * boost;
      // 表针：熵衰减慢下来，倒流时反向狂转
      if (d.hands && d.handSpeeds) {
        const decay = Math.exp(-elapsed / 90);
        for (let i = 0; i < d.hands.length; i++) {
          d.hands[i].rotation.z += d.handSpeeds[i] * dt * (decay * (1 - 3.4 * reversal) + reversal * -1.2);
        }
      }
      // 能层高亮
      const inZone = phase === 'idle' && inErgosphere(d.radius, ERGO_IN, ERGO_OUT);
      if (inZone) ergoOccupied = true;
      const target = inZone ? 0.42 + 0.22 * Math.sin(t * 7) : 0;
      const m = d.ergo.material;
      m.opacity += (target - m.opacity) * Math.min(dt * 6, 1);
    }
    ergoMat.opacity = (ergoOccupied ? 0.11 : 0.045) * (1 + 0.4 * Math.sin(t * 2.2)) * (1 - uExpand);

    // ---- 霍金辐射 ----
    if (phase === 'idle' && !reducedMotion) {
      hawkSpawnT += dt;
      const interval = quality === 'low' ? 0.5 : 0.28;
      while (hawkSpawnT > interval) {
        hawkSpawnT -= interval;
        spawnHawk();
      }
    }
    for (let i = hawks.length - 1; i >= 0; i--) {
      const h = hawks[i];
      h.life -= dt;
      // 倒流时辐射被收回视界
      h.pos.addScaledVector(h.vel, dt * (1 - 2.4 * reversal));
      h.flare *= Math.pow(0.2, dt);
      if (h.life <= 0 || h.pos.length() > 70) hawks.splice(i, 1);
    }
    for (let i = 0; i < HAWKING; i++) {
      if (i < hawks.length) {
        const h = hawks[i];
        hawkPos[i * 3] = h.pos.x; hawkPos[i * 3 + 1] = h.pos.y; hawkPos[i * 3 + 2] = h.pos.z;
        hawkAlpha[i] = Math.min(hawkAlphaAt(h), 1.2);
        hawkSize[i] = 0.5 + 0.5 * Math.min(hawkAlphaAt(h), 1) + h.flare * 1.4;
      } else {
        hawkAlpha[i] = 0;
      }
    }
    hawkGeo.attributes.position.needsUpdate = true;
    hawkGeo.attributes.aAlpha.needsUpdate = true;
    hawkGeo.attributes.aSize.needsUpdate = true;

    // ---- 星尘 ----
    starMat.uniforms.uTime.value = t;
    stars.rotation.y += dt * 0.004;

    // ---- 烛光追随指针 ----
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectSphere(candleSphere, tmpV)) {
      candle.position.lerp(tmpV, Math.min(dt * 3, 1));
    }
    candle.intensity = 60 + 14 * Math.sin(t * 1.3);

    // ---- 引力透镜：算出洞心的屏幕坐标与视半径 ----
    holeGroup.getWorldPosition(tmpV);
    tmpV.y += 1.2;
    tmpV.project(camera);
    if (tmpV.z < 1 && Math.abs(tmpV.x) < 1.4 && Math.abs(tmpV.y) < 1.4) {
      holeNdc.set(1, 0, 0).applyQuaternion(camera.quaternion); // 相机右向
      tmpV2.copy(holeGroup.getWorldPosition(tmpV2)).addScaledVector(holeNdc, HORIZON_R * holeScale);
      tmpV2.y += 1.2;
      tmpV2.project(camera);
      const ru = Math.hypot(tmpV2.x - tmpV.x, tmpV2.y - tmpV.y) * 0.5; // NDC→uv 半径
      lensPass.uniforms.uCenter.value.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5);
      lensPass.uniforms.uRadius.value = ru;
      const aspect = (canvas.clientWidth || innerWidth) / (canvas.clientHeight || innerHeight);
      lensPass.uniforms.uAspect.value = aspect;
      // 强度随视直径增长；洞占满屏幕时收敛（避免畸变失控）
      lensPass.uniforms.uStrength.value = Math.min(ru * 0.5, 0.06) * (1 + reversal * 0.25);
    } else {
      lensPass.uniforms.uStrength.value = 0;
    }

    // ---- 学者模式标签跟随 ----
    if (scholar && opts.labels) {
      const w = canvas.clientWidth || innerWidth;
      const h = canvas.clientHeight || innerHeight;
      for (const lb of labels) {
        lb.anchor.getWorldPosition(lb.world);
        lb.world.project(camera);
        if (lb.world.z > 1 || Math.abs(lb.world.x) > 1.2 || Math.abs(lb.world.y) > 1.2) {
          lb.el.style.opacity = '0';
        } else {
          lb.el.style.opacity = '1';
          lb.el.style.transform =
            `translate(${((lb.world.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-lb.world.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
        }
      }
    }

    // ---- 后期 ----
    finalPass.uniforms.uTime.value = t;
    finalPass.uniforms.uReversal.value = reversal;
    finalPass.uniforms.uRedshift.value = redshift;
    flash *= Math.pow(0.25, dt);
    bloom.strength = 0.72 + reversal * 0.5 + uExpand * 0.4 + flash * 2.6;
    composer.render();

    if (!ready) { ready = true; opts.onReady?.(); }
    // 熵死比例（供 HUD 状态行）
    let deadFrac = 0;
    {
      const all = entropySys.flatMap((s) => s.items);
      let dead = 0;
      for (const it of all) if (entropyTime > it.detachAt + ENTROPY_FALL * 0.7) dead++;
      deadFrac = all.length ? dead / all.length : 0;
    }
    opts.onTick?.({
      reversal,
      elapsed,
      dilation,
      phase,
      t0Progress: phase === 't0' ? clamp01(t0Hold / 3) : 0,
      bounceCount,
      photons: photonsCaught,
      energy: penroseCount,
      entropy: deadFrac,
    });
  }

  // ---- 尺寸 ----
  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  // ---- 标签页隐藏时暂停（Clock 不停表，恢复时 dt 有上限钳制） ----
  const onVis = () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) { raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVis);

  // ---- 上下文丢失 ----
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
  });

  raf = requestAnimationFrame(frame);

  return {
    setScholar,
    dispose() {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
      controls.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
    },
  };
}
