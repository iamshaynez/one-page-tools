/**
 * 《时间的尽头》场景 — 一座已死的巨钟，中心坍缩成奇点。
 *
 * 构图：事件视界（纯黑球 + 菲涅尔红晕 + 光子环）
 *   ← 吸积盘（差速旋转的着色器光环，金红渐层）
 *   ← 幽灵表盘（六十刻度 + 十二罗马数字，逆向缓行）
 *   ← 钟之残骸（表针三针组、陀螺环、断裂弧，倾斜轨道漂流）
 *   ← 余烬尘埃（GPU 螺旋，开普勒差速，坠入即焚）
 *   ← 远方星尘。
 * 交互：拖拽环视 · 滚轮推近 · 按住令时倒流 · 轻点荡开涟漪。
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
  easeOutCubic, clamp01,
} from './endtime-core';

export interface SceneTick {
  reversal: number;   // 0 正流 … 1 逆流
  elapsed: number;    // 场景已存在秒数
}

export interface SceneOptions {
  audio?: { bell(): void; reversal(on: boolean): void };
  onTick?(info: SceneTick): void;
  onReady?(): void;
  onFirstTouch?(): void;
}

const VOID = 0x050507;
const RED = new THREE.Color('#ce1432');

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
  controls.minDistance = 17;
  controls.maxDistance = 95;
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
    opacity: 0.85,
  }));
  abyss.scale.setScalar(150);
  abyss.material.opacity = 0.34;
  scene.add(abyss);

  // ============================ 奇点 ============================
  const singularity = new THREE.Group();
  scene.add(singularity);

  // 事件视界：纯黑球
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(6.3, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  singularity.add(horizon);

  // 菲涅尔红晕（呼吸的视界）
  const rimMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: {
      uTime: { value: 0 },
      uReversal: { value: 0 },
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
      uniform float uTime; uniform float uReversal;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
        float breathe = 0.82 + 0.18 * sin(uTime * 0.9);
        vec3 deep = vec3(0.45, 0.03, 0.07);
        vec3 hot  = vec3(1.0, 0.42, 0.2);
        vec3 col = mix(deep, hot, f * (0.55 + 0.45 * uReversal)) * (1.2 + 1.4 * uReversal);
        // 加性混合 (SRC_ALPHA, ONE)：alpha 只乘一次，rgb 不再预乘
        gl_FragColor = vec4(col, f * breathe);
      }
    `,
  });
  const rimShell = new THREE.Mesh(new THREE.SphereGeometry(8.4, 48, 36), rimMat);
  singularity.add(rimShell);

  // 光子环：引力透镜的戏仿，永远面向镜头
  const photonMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    uniforms: { uTime: { value: 0 }, uReversal: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uReversal;
      varying vec2 vUv;
      void main() {
        vec2 d = vUv - 0.5;
        float r = length(d) * 2.0;
        float ring = exp(-pow((r - 0.82) * 22.0, 2.0));
        float breathe = 0.75 + 0.25 * sin(uTime * 0.9 + 1.2);
        float a = ring * breathe * (0.62 + 0.5 * uReversal);
        vec3 col = mix(vec3(1.0, 0.55, 0.28), vec3(1.0, 0.9, 0.72), ring);
        gl_FragColor = vec4(col * 1.3, a);
      }
    `,
  });
  const photonRing = new THREE.Mesh(new THREE.PlaneGeometry(15.5, 15.5), photonMat);
  photonRing.renderOrder = 5;
  scene.add(photonRing);

  // ============================ 盘面（吸积盘 + 幽灵表盘） ============================
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
      uniform float uDiskTime; uniform float uInner; uniform float uOuter;
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
        gl_FragColor = vec4(col * beaming, alpha);
      }
    `,
  });
  const disk = new THREE.Mesh(new THREE.RingGeometry(DISK_IN, DISK_OUT, 220, 8), diskMat);
  disk.renderOrder = 2;
  diskGroup.add(disk);

  // ---- 幽灵表盘：六十细刻 + 十二粗刻（曾是一座钟的脸） ----
  const gold = new THREE.MeshStandardMaterial({
    color: 0xe0bc72, metalness: 0.88, roughness: 0.34,
    emissive: 0xc07020, emissiveIntensity: 2.2,
  });
  const dial = new THREE.Group();
  diskGroup.add(dial);
  const TICKS = quality === 'low' ? 60 : 90;
  const tickGeo = new THREE.BoxGeometry(0.09, 0.8, 0.09);
  const goldBright = new THREE.MeshStandardMaterial({
    color: 0xf0cf86, metalness: 0.85, roughness: 0.3,
    emissive: 0xd88a2e, emissiveIntensity: 4.0,
  });
  const tickBig = new THREE.BoxGeometry(0.3, 3.6, 0.16);
  const tickMeshes = new THREE.InstancedMesh(tickGeo, gold, TICKS);
  const bigTickMeshes = new THREE.InstancedMesh(tickBig, goldBright, 12);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1);
    // 刻度长轴沿径向（钟面分钟刻度的方向）：+π/2 把盒子的 y 轴转到半径方向
    for (let i = 0; i < TICKS; i++) {
      const a = (i / TICKS) * Math.PI * 2;
      q.setFromAxisAngle(up, a + Math.PI / 2);
      m.compose(new THREE.Vector3(Math.cos(a) * 32.2, Math.sin(a) * 32.2, 0), q, new THREE.Vector3(1, 1, 1));
      tickMeshes.setMatrixAt(i, m);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      q.setFromAxisAngle(up, a + Math.PI / 2);
      m.compose(new THREE.Vector3(Math.cos(a) * 33.6, Math.sin(a) * 33.6, 0), q, new THREE.Vector3(1, 1, 1));
      bigTickMeshes.setMatrixAt(i, m);
    }
  }
  dial.add(tickMeshes, bigTickMeshes);

  // ---- 十二罗马数字铭牌：躺卧在盘面上，随幽灵表盘缓行 ----
  const numeralGroup = new THREE.Group();
  diskGroup.add(numeralGroup);
  ROMAN_CLOCK.forEach((num, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const mat = new THREE.MeshBasicMaterial({
      map: numeralTexture(num),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 1,
      side: THREE.DoubleSide,
    });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 6.6), mat);
    plaque.position.set(Math.cos(a) * 36, Math.sin(a) * 36, 0);
    plaque.rotation.z = a + Math.PI / 2; // 沿切向躺卧
    plaque.rotation.x = -Math.PI / 2;    // 平贴盘面（盘面局部 xy 为平面）
    numeralGroup.add(plaque);
  });

  // ============================ 钟之残骸 ============================
  // 表针三针组、陀螺环、断裂弧——各自在倾斜轨道上漂流、缓慢坠落
  interface Drift {
    pivot: THREE.Group;
    orbitSpeed: number;
    tumble: THREE.Vector3;
    angle: number;
    radius: number;
    fall: number;          // 每秒坠落的半径
    hands?: THREE.Object3D[];
    handSpeeds?: number[];
  }
  const drifts: Drift[] = [];
  const shards = new THREE.Group();
  scene.add(shards);
  const seedRng = rng(20261117);
  const HAND_SETS = quality === 'low' ? 6 : 9;
  const GYROS = quality === 'low' ? 3 : 5;
  const ARCS = quality === 'low' ? 2 : 4;

  const mkDrift = (obj: THREE.Object3D, i: number, extra?: Partial<Drift>): Drift => {
    const pivot = new THREE.Group();
    pivot.rotation.set(range(seedRng, -0.9, 0.9), range(seedRng, 0, Math.PI * 2), range(seedRng, -0.6, 0.6));
    const radius = range(seedRng, 15, 29);
    const angle = seedRng() * Math.PI * 2;
    obj.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    obj.rotation.set(seedRng() * Math.PI, seedRng() * Math.PI, seedRng() * Math.PI);
    pivot.add(obj);
    shards.add(pivot);
    return {
      pivot,
      orbitSpeed: pick(seedRng, [0.05, -0.04, 0.07, -0.06, 0.035, -0.08]) * 0.7,
      tumble: new THREE.Vector3(range(seedRng, -0.3, 0.3), range(seedRng, -0.4, 0.4), range(seedRng, -0.3, 0.3)),
      angle,
      radius,
      fall: range(seedRng, 0.05, 0.16),
      ...extra,
    };
  };

  // 表针三针组（时针/分针/秒针，几何平移到绕一端旋转；带表轴 hub）
  for (let i = 0; i < HAND_SETS; i++) {
    const clock = new THREE.Group();
    const r = range(seedRng, 2.0, 3.4);
    const lens = handLengths(r);
    const hands: THREE.Object3D[] = [];
    const speeds: number[] = [];
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
    });
    const d = mkDrift(clock, i, { hands, handSpeeds: speeds });
    drifts.push(d);
  }

  // 陀螺环（像被拆下的机芯）
  for (let i = 0; i < GYROS; i++) {
    const ringR = range(seedRng, 2.1, 4.3);
    const gyro = new THREE.Group();
    for (let j = 0; j < 2 + Math.floor(seedRng() * 2); j++) {
      const t = new THREE.Mesh(
        new THREE.TorusGeometry(ringR * (1 - j * 0.22), 0.1 + j * 0.02, 10, 72),
        gold,
      );
      t.rotation.set(seedRng() * Math.PI, seedRng() * Math.PI, 0);
      gyro.add(t);
    }
    drifts.push(mkDrift(gyro, i));
  }

  // 断裂弧（碎掉的表圈）
  for (let i = 0; i < ARCS; i++) {
    const arcR = range(seedRng, 3.0, 5.6);
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(arcR, 0.14, 10, 80, range(seedRng, Math.PI * 0.7, Math.PI * 1.6)),
      gold,
    );
    drifts.push(mkDrift(arc, i));
  }

  // ============================ 余烬尘埃（GPU 螺旋） ============================
  const EMBERS = quality === 'low' ? 3200 : 7500;
  const R_MIN = 9.8, R_MAX = 44; // 内界在盘内缘之外：不遮蔽事件视界的黑色剪影
  const emberGeo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(EMBERS * 3); // 占位，真正位置在顶点着色器里算
    const aSeed = new Float32Array(EMBERS);
    const aR0 = new Float32Array(EMBERS);
    const aAngle0 = new Float32Array(EMBERS);
    const aRadial = new Float32Array(EMBERS);
    const aYOff = new Float32Array(EMBERS);
    const aSize = new Float32Array(EMBERS);
    for (let i = 0; i < EMBERS; i++) {
      aSeed[i] = seedRng();
      // 近均匀分布（内缘过度堆积会把中心堆成白块）
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
    },
    vertexShader: /* glsl */ `
      uniform float uDiskTime, uRMin, uRMax, uPx, uShockR, uShockAmp;
      uniform vec2 uShockCenter;
      attribute float aSeed, aR0, aAngle0, aRadial, aYOff, aSize;
      varying float vAlpha; varying vec3 vColor;
      void main() {
        // 与 endtime-core.spiralState 同一公式：锯齿式坠落 + 开普勒差速
        float cycle = (uRMax - uRMin) / aRadial;
        float phase = mod(uDiskTime * 0.55 + aSeed * cycle, cycle);
        float fallen = aR0 - aRadial * phase;
        float r = fallen <= uRMin ? uRMax : fallen;
        float theta = aAngle0 + 10.0 * pow(max(r, 1.0), -1.5) * uDiskTime * 3.0;
        // 湍流抖动
        theta += sin(uDiskTime * (0.4 + aSeed) + aSeed * 40.0) * 0.05;
        vec2 xy = vec2(cos(theta), sin(theta)) * r;
        // 涟漪：从点击处荡开一圈推挤与增亮
        float shockD = distance(xy, uShockCenter);
        float wave = exp(-pow((shockD - uShockR) * 0.55, 2.0)) * uShockAmp;
        xy += normalize(xy - uShockCenter + 0.001) * wave * 2.2;
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
        gl_PointSize = aSize * uPx / max(-mv.z, 1.0) * (1.0 + deathGlow * 0.8 + wave);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha; varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float m = smoothstep(0.5, 0.08, length(d));
        gl_FragColor = vec4(vColor * 1.25, vAlpha * m);
      }
    `,
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.frustumCulled = false; // 位置在 GPU 上算，包围盒失效
  diskGroup.add(embers);

  // 涟漪环（点击处的可见波纹）
  interface Ripple { mesh: THREE.Mesh; born: number; }
  const ripples: Ripple[] = [];
  const rippleMatProto = new THREE.MeshBasicMaterial({
    color: 0xffc98a, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });

  // ============================ 远方星尘 ============================
  const STARS = quality === 'low' ? 900 : 1900;
  const starGeo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(STARS * 3);
    const seed2 = new Float32Array(STARS);
    for (let i = 0; i < STARS; i++) {
      // 均匀球壳分布
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

  // ============================ 后期：辉光 + 暗角颗粒 ============================
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight).multiplyScalar(quality === 'low' ? 0.6 : 0.75),
    0.72, 0.5, 0.35,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass()); // 色调映射 + sRGB，之后的调色在显示空间上进行

  const finalPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uReversal: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime, uReversal;
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
        // 暗角
        col *= 1.0 - smoothstep(0.18, 0.62, r2) * 0.42;
        // 胶片颗粒
        col += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 7.13) - 0.5) * 0.045;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  composer.addPass(finalPass);

  // ============================ 交互 ============================
  let reversalTarget = 0;   // 目标（0/1）
  let reversal = 0;         // 平滑后的系数
  let diskTime = 0;         // 盘面时间（可倒流）
  let elapsed = 0;
  let shockR = -1, shockAmp = 0;
  const shockCenter = new THREE.Vector2(999, 999);
  let reversalEngaged = false;
  let reversalLatched = false; // 音效状态去抖

  const raycaster = new THREE.Raycaster();
  const diskPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1).applyEuler(diskGroup.rotation), 0);
  const hit = new THREE.Vector3();

  // 指针状态
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
    reversalEngaged = true;
    reversalTarget = 1;
    if (!reversalLatched) { reversalLatched = true; opts.audio?.reversal(true); }
  };
  const releaseReversal = () => {
    reversalEngaged = false;
    reversalTarget = 0;
    if (reversalLatched) { reversalLatched = false; opts.audio?.reversal(false); }
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
      spawnRipple(e.clientX, e.clientY);
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

  /** 点击处荡开涟漪：raycast 到盘面 */
  function spawnRipple(x: number, y: number) {
    setNdc(x, y);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(diskPlane, hit)) {
      // 转到余烬所在的盘面局部坐标
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
        opts.audio?.bell();
      }
    }
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

  // ============================ 主循环 ============================
  const clock = new THREE.Clock();
  const camIntroFrom = camera.position.clone();
  const camIntroTo = new THREE.Vector3(-13.5, 14.5, 40);
  const skipIntro = reducedMotion || new URLSearchParams(location.search).has('fast');
  let introT = skipIntro ? 1 : 0;
  let ready = false;
  let raf = 0;

  const tmpV = new THREE.Vector3();
  const candleSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 34);

  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    elapsed += dt;

    // 入场推近
    if (introT < 1) {
      introT = Math.min(introT + dt / 3.4, 1);
      const k = easeOutCubic(introT);
      camera.position.lerpVectors(camIntroFrom, camIntroTo, k);
      if (introT >= 1) { controls.enabled = true; }
    }

    // 倒流系数平滑
    reversal += (reversalTarget - reversal) * Math.min(dt * 2.6, 1);
    // 盘面时间：正流 +1.0/s，逆流 -1.8/s
    diskTime += dt * (1 - 2.8 * reversal);
    if (diskTime < 0) diskTime = 0; // 时间不允许早于尽头

    controls.update();

    // ---- 奇点呼吸 ----
    const breathe = 1 + 0.02 * Math.sin(t * 0.9);
    horizon.scale.setScalar(breathe);
    rimShell.scale.setScalar(breathe * (1 + reversal * 0.05));
    rimMat.uniforms.uTime.value = t;
    rimMat.uniforms.uReversal.value = reversal;
    photonMat.uniforms.uTime.value = t;
    photonMat.uniforms.uReversal.value = reversal;
    photonRing.quaternion.copy(camera.quaternion); // 永远面向镜头
    abyss.material.opacity = 0.6 + 0.3 * reversal + 0.07 * Math.sin(t * 0.9);

    // ---- 盘面 ----
    diskMat.uniforms.uDiskTime.value = diskTime;
    emberMat.uniforms.uDiskTime.value = diskTime;
    dial.rotation.z -= dt * 0.012 * (1 - 2 * reversal); // 幽灵表盘逆向缓行（倒流时随之回摆）
    numeralGroup.rotation.z = dial.rotation.z;

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
        diskGroup.remove(rp.mesh);
        rp.mesh.geometry.dispose();
        (rp.mesh.material as THREE.Material).dispose();
        ripples.splice(i, 1);
      }
    }

    // ---- 残骸漂流 ----
    for (const d of drifts) {
      const dir = 1 - 2 * reversal; // 倒流时反向公转
      d.angle += d.orbitSpeed * dir * dt * (1 + reversal * 1.6);
      d.radius -= d.fall * dt * (1 - 2.2 * reversal); // 倒流时被推回去
      if (d.radius < 8.6) d.radius = 29;      // 坠入后重生
      if (d.radius > 30) d.radius = 30;
      const obj = d.pivot.children[0];
      obj.position.set(Math.cos(d.angle) * d.radius, 0, Math.sin(d.angle) * d.radius);
      obj.rotation.x += d.tumble.x * dt;
      obj.rotation.y += d.tumble.y * dt;
      obj.rotation.z += d.tumble.z * dt * 0.5;
      // 表针：熵衰减慢下来，倒流时反向狂转
      if (d.hands && d.handSpeeds) {
        const decay = Math.exp(-elapsed / 90);
        for (let i = 0; i < d.hands.length; i++) {
          d.hands[i].rotation.z += d.handSpeeds[i] * dt * (decay * (1 - 3.4 * reversal) + reversal * -1.2);
        }
      }
    }

    // ---- 星尘 ----
    starMat.uniforms.uTime.value = t;
    stars.rotation.y += dt * 0.004;

    // ---- 烛光追随指针 ----
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectSphere(candleSphere, tmpV)) {
      candle.position.lerp(tmpV, Math.min(dt * 3, 1));
    }
    candle.intensity = 60 + 14 * Math.sin(t * 1.3);

    // ---- 后期 ----
    finalPass.uniforms.uTime.value = t;
    finalPass.uniforms.uReversal.value = reversal;
    bloom.strength = 0.95 + reversal * 0.5;
    composer.render();

    if (!ready) { ready = true; opts.onReady?.(); }
    opts.onTick?.({ reversal, elapsed });
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
