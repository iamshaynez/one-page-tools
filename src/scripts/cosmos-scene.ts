/**
 * 《宇宙漫游》场景 — 从地球出发的太阳系飞行
 *
 * 天体：太阳着色器（湍流光球 + 日冕）/ 八行星 + 冥王星（程序化纹理：条带、
 * 陨坑、大陆、冰盖、云层、大红斑）/ 土星环（卡西尼缝）/ 月球（潮汐锁定）。
 * 环境：小行星带（实例化）、柯伊伯带、银河带星野、宇宙尘（速度感）、
 * 流星雨、五个漂浮彩蛋（旅行者一号 / 黄金唱片 / B-612 玫瑰 / 钟表残骸 / 漂流瓶）。
 * 操控：WASD + 鼠标拖拽视角 + 滚轮调速；触屏双摇杆；行星导航坞自动导航。
 * 时间：真实历元驱动，五档流速（暂停 ~ 30天/秒）。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  rng, range, PLANETS, MOON, EGGS, byKey,
  bodyScenePos, moonScenePos, rotationAngle, kmToUnits, auToScene,
  SUN_SCENE_R, TIME_SCALES, joystickClamp, approachDist,
} from './cosmos-core';

export interface CosmosTick {
  speed: number;          // 航速（场景单位/秒）
  timeScaleIdx: number;
  simDays: number;        // 距 J2000 的天数
  nearest: string;
  nearestDist: number;
  eggsFound: number;
  eggsTotal: number;
  autopilot: string | null;
}

export interface CosmosEvents {
  onTick?(t: CosmosTick): void;
  onReady?(): void;
  onDiscover?(eggKey: string, name: string, line: string): void;
  onSelect?(key: string | null): void;
  onSpeedToast?(speed: number): void;
}

export interface CosmosOptions extends CosmosEvents {
  labels?: HTMLElement | null;
}

const EGG_STORE = 'opt-cosmos-eggs';

// ═══════════════════════════════════════════════════════════════
// 程序化纹理（可平铺经度方向）
// ═══════════════════════════════════════════════════════════════
function makeNoise(seed: number) {
  const r = rng(seed);
  const S = 256;
  const grid = new Float32Array(S * S);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const at = (x: number, y: number) => grid[((y % S + S) % S) * S + ((x % S + S) % S)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  const fbm = (x: number, y: number, oct = 4) => {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { v += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; }
    return v;
  };
  return { noise, fbm, r };
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
function mixHex(a: number, b: number, t: number): number {
  const ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255;
  const br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
  return ((ar + (br - ar) * t) << 16) | ((ag + (bg - ag) * t) << 8) | (ab + (bb - ab) * t);
}

/** 气态巨行星：条带 + 湍流 + 风暴椭圆斑 */
function bandsTexture(seed: number, palette: number[], opts: { spot?: string; spotColor?: number } = {}): THREE.Texture {
  const W = 512, H = 256;
  const n = makeNoise(seed);
  return canvasTex(W, H, (g) => {
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const warp = (n.fbm(u * 8, v * 22, 4) - 0.5) * 0.22
          + (n.fbm(u * 20 + 7, v * 40, 3) - 0.5) * 0.07;
        const band = v + warp;
        const pos = band * (palette.length - 1);
        const i = Math.max(0, Math.min(palette.length - 2, Math.floor(pos)));
        let c = mixHex(palette[i], palette[i + 1], pos - i);
        const lum = 0.86 + 0.3 * (n.fbm(u * 30, v * 50, 3) - 0.5);
        c = mixHex(c, 0xffffff, Math.max(0, lum - 1));
        c = mixHex(c, 0x000000, Math.max(0, 1 - lum) * 0.7);
        const o = (y * W + x) * 4;
        img.data[o] = c >> 16 & 255;
        img.data[o + 1] = c >> 8 & 255;
        img.data[o + 2] = c & 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    if (opts.spot) {
      const [sx, sy, sw, sh] = opts.spot.split(',').map(Number);
      g.save();
      g.translate(sx * W, sy * H);
      g.rotate(-0.08);
      g.scale((sw * W) / 2, (sh * H) / 2); // 椭圆半径 = 纹理宽高的比例
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      const sc = hex(opts.spotColor ?? 0xc1442e);
      grad.addColorStop(0, sc);
      grad.addColorStop(0.62, sc);
      grad.addColorStop(1, 'rgba(193,68,46,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, 1, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  });
}

/** 岩质行星：斑驳底色 + 陨坑 + 极冠 */
function rockyTexture(seed: number, base: number, accent: number, opts: { craters?: number; caps?: number; capColor?: number } = {}): THREE.Texture {
  const W = 512, H = 256;
  const n = makeNoise(seed);
  const craters = opts.craters ?? 90;
  return canvasTex(W, H, (g) => {
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const f = n.fbm(u * 10 + 3, v * 10, 5);
        let c = mixHex(base, accent, Math.min(1, Math.max(0, (f - 0.34) * 2.4)));
        if (opts.caps) {
          const lat = Math.abs(v - 0.5) * 2;
          const capT = Math.max(0, (lat - (1 - opts.caps * 0.35)) / (opts.caps * 0.35));
          c = mixHex(c, opts.capColor ?? 0xeef3f5, Math.min(1, capT * (0.8 + 0.4 * n.fbm(u * 14, v * 14, 3))));
        }
        const o = (y * W + x) * 4;
        img.data[o] = c >> 16 & 255;
        img.data[o + 1] = c >> 8 & 255;
        img.data[o + 2] = c & 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < craters; i++) {
      const cx = n.r() * W, cy = n.r() * H;
      const rad = 1 + Math.pow(n.r(), 2.6) * 14;
      const lat = Math.abs(cy / H - 0.5) * 2;
      if (opts.caps && lat > 1 - opts.caps * 0.3) continue;
      const grad = g.createRadialGradient(cx, cy, rad * 0.15, cx, cy, rad);
      grad.addColorStop(0, 'rgba(0,0,0,0.34)');
      grad.addColorStop(0.72, 'rgba(0,0,0,0.12)');
      grad.addColorStop(0.86, 'rgba(255,255,255,0.20)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, rad, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** 地球：海洋 / 大陆 / 冰盖（真实感的关键件） */
function earthTexture(seed: number, scale = 1): THREE.Texture {
  const W = Math.round(1024 * scale), H = Math.round(512 * scale);
  const n = makeNoise(seed);
  return canvasTex(W, H, (g) => {
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      const lat = Math.abs(v - 0.5) * 2;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const cont = n.fbm(u * 6 + 11, v * 6, 6) + 0.18 * Math.cos(v * Math.PI) - 0.09;
        const o = (y * W + x) * 4;
        let c: number;
        if (cont > 0.52) {
          const h = (cont - 0.52) / 0.3;
          c = h < 0.16 ? mixHex(0xc2b280, 0x3d6b3a, h / 0.16)
            : h < 0.6 ? mixHex(0x3d6b3a, 0x6b7d42, (h - 0.16) / 0.44)
            : mixHex(0x6b7d42, 0x8a7f6e, (h - 0.6) / 0.4);
          if (lat > 0.72) c = mixHex(c, 0xe8eef2, Math.min(1, (lat - 0.72) / 0.2));
          if (lat < 0.14) c = mixHex(c, 0x8f9a4e, 0.35); // 赤道雨林
        } else {
          const d = 0.52 - cont;
          c = d < 0.04 ? mixHex(0x2f6f8f, 0x123a5e, d / 0.04)
            : mixHex(0x123a5e, 0x0a2140, Math.min(1, (d - 0.04) / 0.3));
        }
        if (lat > 0.88) c = mixHex(c, 0xf0f5f8, Math.min(1, (lat - 0.88) / 0.08)); // 极冠
        img.data[o] = c >> 16 & 255;
        img.data[o + 1] = c >> 8 & 255;
        img.data[o + 2] = c & 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/** 云层（透明贴图） */
function cloudsTexture(seed: number): THREE.Texture {
  const W = 512, H = 256;
  const n = makeNoise(seed);
  return canvasTex(W, H, (g) => {
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const f = n.fbm(u * 7 + 31, v * 16, 5) * 0.7 + n.fbm(u * 22, v * 30, 3) * 0.3;
        const a = Math.max(0, (f - 0.52) * 2.2);
        const o = (y * W + x) * 4;
        img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255;
        img.data[o + 3] = Math.min(255, a * 255);
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/** 光环径向贴图（含卡西尼缝与恩克缝） */
function ringTexture(seed: number, tint: number): THREE.Texture {
  const W = 1024;
  const n = makeNoise(seed);
  return canvasTex(W, 16, (g) => {
    const img = g.createImageData(W, 16);
    for (let x = 0; x < W; x++) {
      const t = x / W; // 0 内缘 → 1 外缘
      let a = 0.75 + 0.25 * n.fbm(t * 60, 3, 4);
      // 主环结构：C 环淡 → B 环亮 → 卡西尼缝 → A 环 → 恩克缝 → 外淡出
      a *= t < 0.08 ? t / 0.08 : 1;
      if (t > 0.66 && t < 0.74) a *= 0.12 + 0.1 * n.fbm(t * 90, 1, 2); // 卡西尼缝
      if (t > 0.955 && t < 0.965) a *= 0.15;                            // 恩克缝
      if (t > 0.97) a *= Math.max(0, 1 - (t - 0.97) / 0.03);
      const bright = t > 0.25 && t < 0.66 ? 1.12 : 0.92;
      const c = mixHex(tint, 0xffffff, 0.25 * bright - 0.2);
      for (let y = 0; y < 16; y++) {
        const o = (y * W + x) * 4;
        img.data[o] = Math.min(255, (c >> 16 & 255) * bright);
        img.data[o + 1] = Math.min(255, (c >> 8 & 255) * bright);
        img.data[o + 2] = Math.min(255, (c & 255) * bright);
        img.data[o + 3] = Math.min(255, a * 235);
      }
    }
    g.putImageData(img, 0, 0);
  });
}

function glowTextureRGB(inner: string, outer: string): THREE.Texture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.4, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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

// ═══════════════════════════════════════════════════════════════
// 场景
// ═══════════════════════════════════════════════════════════════
interface BodyNode {
  key: string;
  group: THREE.Group;        // 日心位置
  axis: THREE.Group;         // 轴倾角
  mesh: THREE.Mesh;          // 自转
  radius: number;            // 场景单位
  pos: THREE.Vector3;
}

interface EggNode {
  key: string; name: string; line: string;
  group: THREE.Group;
  pos: THREE.Vector3;
  found: boolean;
  label: HTMLDivElement | null;
}

export function createCosmos(canvas: HTMLCanvasElement, opts: CosmosOptions = {}) {
  const quality = (matchMedia('(pointer: coarse)').matches || innerWidth < 720) ? 'low' : 'high';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x020208, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const DPR = Math.min(devicePixelRatio || 1, quality === 'low' ? 1.75 : 2);
  renderer.setPixelRatio(DPR);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 6000);
  const up = new THREE.Vector3(0, 1, 0);

  // ---- 灯光：太阳点光（decay 1 保证外行星仍可读）+ 微环境光 ----
  scene.add(new THREE.AmbientLight(0x28304a, 1.35));
  const sunLight = new THREE.PointLight(0xfff0dd, 190, 0, 1);
  scene.add(sunLight);

  // ---- 星野：两层层次 + 银河带 + 星云微光 ----
  const skyRng = rng(42);
  const sky = new THREE.Group();
  scene.add(sky);
  {
    const mkStars = (count: number, rMin: number, rMax: number, size: number, tint: [number, number, number]) => {
      const pos = new Float32Array(count * 3);
      const seeds = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const u = skyRng() * 2 - 1;
        const t = skyRng() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const R = range(skyRng, rMin, rMax);
        pos[i * 3] = Math.cos(t) * s * R;
        pos[i * 3 + 1] = u * R;
        pos[i * 3 + 2] = Math.sin(t) * s * R;
        seeds[i] = skyRng();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        uniforms: { uTime: { value: 0 }, uPx: { value: DPR * (220 + size * 90) }, uTint: { value: new THREE.Vector3(...tint) } },
        vertexShader: /* glsl */ `
          uniform float uTime, uPx;
          attribute float aSeed;
          varying float vA; varying float vSeed;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vSeed = aSeed;
            vA = 0.28 + 0.72 * (0.5 + 0.5 * sin(uTime * (0.5 + aSeed) + aSeed * 99.0));
            gl_PointSize = (0.8 + aSeed * 1.7) * uPx / max(-mv.z, 1.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTint;
          varying float vA; varying float vSeed;
          void main() {
            vec2 d = gl_PointCoord - 0.5;
            float m = smoothstep(0.5, 0.06, length(d));
            vec3 col = mix(uTint, vec3(1.0), vSeed * 0.45);
            gl_FragColor = vec4(col, vA * m * 0.85);
          }
        `,
      });
      return new THREE.Points(geo, mat);
    };
    sky.add(mkStars(quality === 'low' ? 2600 : 5200, 2200, 3400, 1, [0.72, 0.76, 0.86]));
    sky.add(mkStars(quality === 'low' ? 900 : 1800, 1800, 2600, 1.8, [0.95, 0.86, 0.74]));
    // 银河带：沿一条大圆聚集的暗星雾
    const bandN = quality === 'low' ? 2200 : 4600;
    const bpos = new Float32Array(bandN * 3);
    const bseed = new Float32Array(bandN);
    const bandTilt = 1.05; // 银道面相对黄道 ~60°
    for (let i = 0; i < bandN; i++) {
      const a = skyRng() * Math.PI * 2;
      const spread = (skyRng() + skyRng() + skyRng() - 1.5) * 0.22; // 近高斯
      const R = range(skyRng, 2400, 3200);
      const x = Math.cos(a), y = spread, z = Math.sin(a);
      const y2 = y * Math.cos(bandTilt) - z * Math.sin(bandTilt);
      const z2 = y * Math.sin(bandTilt) + z * Math.cos(bandTilt);
      bpos[i * 3] = x * R; bpos[i * 3 + 1] = y2 * R; bpos[i * 3 + 2] = z2 * R;
      bseed[i] = skyRng();
    }
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
    bgeo.setAttribute('aSeed', new THREE.BufferAttribute(bseed, 1));
    const bandMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { uPx: { value: DPR * 190 } },
      vertexShader: /* glsl */ `
        uniform float uPx;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vA = 0.16 + 0.28 * aSeed;
          gl_PointSize = (1.5 + aSeed * 2.8) * uPx / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float m = smoothstep(0.5, 0.05, length(d));
          gl_FragColor = vec4(vec3(0.66, 0.72, 0.9), vA * m * 1.35);
        }
      `,
    });
    sky.add(new THREE.Points(bgeo, bandMat));
    // 三片暗星云：银河带上的深空呼吸
    const nebulas: [string, string, number][] = [
      ['rgba(120,140,210,0.10)', 'rgba(60,80,150,0.05)', 900],
      ['rgba(200,150,130,0.08)', 'rgba(120,80,70,0.04)', 750],
      ['rgba(130,170,190,0.07)', 'rgba(60,100,120,0.035)', 650],
    ];
    nebulas.forEach(([inner, outer, scale], i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTextureRGB(inner, outer),
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9,
      }));
      const a = (i / nebulas.length) * Math.PI * 2 + 0.7;
      const y2 = Math.sin(a) * Math.sin(1.05);
      const z2 = Math.sin(a) * Math.cos(1.05);
      sp.position.set(Math.cos(a) * 2800, y2 * 2800, z2 * 2800);
      sp.scale.setScalar(scale);
      sky.add(sp);
    });
  }

  // ---- 太阳：湍流光球着色器 + 日冕 ----
  const sunMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main() {
        vN = normalMatrix * normal;
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      ${GLSL_NOISE}
      void main() {
        vec3 p = normalize(vP);
        float g1 = fbm(p.xy * 7.0 + uTime * 0.05);
        float g2 = fbm(p.yz * 13.0 - uTime * 0.035 + 4.7);
        float gran = 0.55 + 0.45 * (g1 * 0.6 + g2 * 0.4);
        // 边缘增亮（临边昏暗反转的戏剧化处理）
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        vec3 deep = vec3(0.98, 0.42, 0.05);
        vec3 hot  = vec3(1.0, 0.96, 0.86);
        vec3 col = mix(deep, hot, gran);
        col += vec3(1.0, 0.6, 0.2) * rim * 0.9;
        gl_FragColor = vec4(col * 1.5, 1.0);
      }
    `,
  });
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_SCENE_R, 64, 48), sunMat);
  const sunGroup = new THREE.Group();
  sunGroup.add(sunMesh);
  scene.add(sunGroup);
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTextureRGB('rgba(255,190,90,0.85)', 'rgba(255,120,30,0.28)'),
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85,
  }));
  corona.scale.setScalar(SUN_SCENE_R * 7.5);
  scene.add(corona);

  // ---- 行星 ----
  const bodies: BodyNode[] = [];
  const clickTargets: THREE.Mesh[] = [];
  const TEXGEN: Record<string, () => THREE.Texture> = {
    mercury: () => rockyTexture(11, 0x8a8580, 0x55504b, { craters: 130 }),
    venus: () => bandsTexture(21, [0xd9b77e, 0xc9a05e, 0xe3c88f, 0xb98f52, 0xd9b77e]),
    earth: () => earthTexture(31, quality === 'low' ? 0.5 : 1),
    mars: () => rockyTexture(41, 0xb5613c, 0x7a3a24, { craters: 70, caps: 0.24, capColor: 0xf0ece6 }),
    jupiter: () => bandsTexture(51, [0xe8d5b8, 0x7a5236, 0xf0e4cc, 0x8a5f3c, 0xe6d6b6, 0x6a4a34, 0xdcc8a6],
      { spot: '0.62,0.62,0.15,0.09', spotColor: 0xc1442e }),
    saturn: () => bandsTexture(61, [0xdcc69b, 0xba9c6c, 0xecdcb6, 0xc6a97c, 0xdcc69b]),
    uranus: () => bandsTexture(71, [0x9fd4d9, 0x8cc8cf, 0xace0e3, 0x93cdd3]),
    neptune: () => bandsTexture(81, [0x3b66c4, 0x2d4fa8, 0x5478d2, 0x3558b8],
      { spot: '0.32,0.6,0.1,0.06', spotColor: 0x1e3a80 }),
    pluto: () => rockyTexture(91, 0xbfae9a, 0x8a7a68, { craters: 40, caps: 0.3 }),
  };

  const planetMats: Record<string, THREE.MeshStandardMaterial> = {};
  for (const spec of PLANETS) {
    const radius = kmToUnits(spec.radiusKm);
    const group = new THREE.Group();
    const axis = new THREE.Group();
    axis.rotation.z = spec.tiltDeg * Math.PI / 180;
    const mat = new THREE.MeshStandardMaterial({
      map: TEXGEN[spec.key](),
      roughness: spec.kind === 'gas' || spec.kind === 'ice' ? 0.85 : 0.95,
      metalness: 0.02,
    });
    planetMats[spec.key] = mat;
    const segs = quality === 'low' ? 40 : 56;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segs, segs / 2), mat);
    axis.add(mesh);
    group.add(axis);
    scene.add(group);
    clickTargets.push(mesh);

    // 大气边缘辉光（地球蓝 / 金星米 / 火星微红）
    const atmoColor = spec.key === 'earth' ? 0x4f8fd9 : spec.key === 'venus' ? 0xd9c08a
      : spec.key === 'mars' ? 0xc07a5a : spec.key === 'jupiter' ? 0xc8a882
      : spec.kind === 'ice' ? 0x86d0d8 : null;
    if (atmoColor && quality !== 'low') {
      const atmo = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.045, 40, 24),
        new THREE.ShaderMaterial({
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
          uniforms: { uColor: { value: new THREE.Color(atmoColor) } },
          vertexShader: /* glsl */ `
            varying vec3 vN; varying vec3 vV;
            void main() {
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              vN = normalMatrix * normal; vV = -mv.xyz;
              gl_Position = projectionMatrix * mv;
            }
          `,
          fragmentShader: /* glsl */ `
            uniform vec3 uColor;
            varying vec3 vN; varying vec3 vV;
            void main() {
              float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.2);
              gl_FragColor = vec4(uColor, f * 0.55);
            }
          `,
        }),
      );
      axis.add(atmo);
    }

    // 地球：云层 + 月球
    if (spec.key === 'earth') {
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.018, 44, 26),
        new THREE.MeshStandardMaterial({ map: cloudsTexture(131), transparent: true, roughness: 1, depthWrite: false }),
      );
      clouds.name = 'earthClouds';
      axis.add(clouds);
      const moonMat = new THREE.MeshStandardMaterial({ map: rockyTexture(141, 0x9a9a96, 0x6b6b66, { craters: 150 }), roughness: 0.98 });
      const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(kmToUnits(MOON.radiusKm), 36, 20), moonMat);
      moonMesh.name = 'moon';
      scene.add(moonMesh);
      clickTargets.push(moonMesh);
    }

    // 土星环（真实内外径比例 1.3–2.3 R）与天王星细环
    if (spec.key === 'saturn' || spec.key === 'uranus') {
      const inner = radius * (spec.key === 'saturn' ? 1.32 : 1.65);
      const outer = radius * (spec.key === 'saturn' ? 2.32 : 1.95);
      const ringGeo = new THREE.RingGeometry(inner, outer, 180, 1);
      // 重映射 UV：u = 径向位置（默认是平面投影）
      {
        const p = ringGeo.attributes.position;
        const uv = ringGeo.attributes.uv;
        const v3 = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) {
          v3.fromBufferAttribute(p, i);
          const t = (v3.length() - inner) / (outer - inner);
          uv.setXY(i, t, (uv.getY(i) > 0.5 ? 1 : 0));
        }
      }
      const rmat = new THREE.MeshStandardMaterial({
        map: ringTexture(spec.key === 'saturn' ? 151 : 161, spec.key === 'saturn' ? 0xd9c9a5 : 0x9fd2d8),
        transparent: true,
        side: THREE.DoubleSide,
        roughness: 0.85,
        emissive: spec.key === 'saturn' ? 0x6a5c42 : 0x2a4448,
        emissiveIntensity: 0.45,
        opacity: spec.key === 'saturn' ? 1 : 0.42,
      });
      const ring = new THREE.Mesh(ringGeo, rmat);
      ring.rotation.x = Math.PI / 2;
      axis.add(ring);
    }

    bodies.push({ key: spec.key, group, axis, mesh, radius, pos: new THREE.Vector3() });
  }
  bodies.unshift({
    key: 'sun', group: sunGroup, axis: sunGroup, mesh: sunMesh, radius: SUN_SCENE_R, pos: new THREE.Vector3(0, 0, 0),
  });

  // ---- 轨道线（优雅细环） ----
  const orbitGroup = new THREE.Group();
  scene.add(orbitGroup);
  for (const spec of PLANETS) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) {
      const p = bodyScenePos(spec, (i / 160) * spec.periodDays);
      pts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x8a94a8, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
    }));
    orbitGroup.add(line);
  }

  // ---- 小行星带（实例化）+ 柯伊伯带 ----
  const beltGroup = new THREE.Group();
  scene.add(beltGroup);
  {
    const N = quality === 'low' ? 700 : 1500;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x776f66, roughness: 0.96 });
    const inst = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
    const rBelt = rng(2026);
    for (let i = 0; i < N; i++) {
      const a = rBelt() * Math.PI * 2;
      const r = range(rBelt, auToScene(2.15), auToScene(3.35));
      const y = (rBelt() + rBelt() - 1) * 3.2;
      e.set(rBelt() * Math.PI, rBelt() * Math.PI, rBelt() * Math.PI);
      q.setFromEuler(e);
      const sc = 0.06 + Math.pow(rBelt(), 2.2) * 0.5;
      s.setScalar(sc);
      m.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q, s);
      inst.setMatrixAt(i, m);
    }
    beltGroup.add(inst);

    // 柯伊伯带：外海王星的暗尘环
    const KN = quality === 'low' ? 1200 : 2600;
    const kpos = new Float32Array(KN * 3);
    for (let i = 0; i < KN; i++) {
      const a = rBelt() * Math.PI * 2;
      const r = range(rBelt, auToScene(32), auToScene(48));
      const y = (rBelt() + rBelt() - 1) * 26;
      kpos[i * 3] = Math.cos(a) * r; kpos[i * 3 + 1] = y; kpos[i * 3 + 2] = Math.sin(a) * r;
    }
    const kgeo = new THREE.BufferGeometry();
    kgeo.setAttribute('position', new THREE.BufferAttribute(kpos, 3));
    const kmat = new THREE.PointsMaterial({
      color: 0x5a6a8a, size: 0.5, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    scene.add(new THREE.Points(kgeo, kmat));
  }

  // ---- 宇宙尘：相机周围的包裹速度场 ----
  const DUST = quality === 'low' ? 220 : 420;
  const DUST_R = 130;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST * 3; i++) dustPos[i] = (Math.random() - 0.5) * 2 * DUST_R;
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0x9aa8c0, size: 0.35, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  // ---- 流星池 ----
  interface Meteor { line: THREE.Line; head: THREE.Sprite; vel: THREE.Vector3; life: number; total: number }
  const meteors: Meteor[] = [];
  const meteorMatProto = new THREE.LineBasicMaterial({
    color: 0xffe9c9, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending,
  });
  let meteorTimer = 1.5;
  function spawnMeteor(big = false) {
    const r = 60 + Math.random() * 90;
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(Math.random() * 2 - 1);
    const start = new THREE.Vector3(
      camera.position.x + r * Math.sin(b) * Math.cos(a),
      camera.position.y + r * Math.cos(b),
      camera.position.z + r * Math.sin(b) * Math.sin(a),
    );
    const dir = new THREE.Vector3(
      Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5,
    ).normalize();
    const speed = big ? 130 : 70 + Math.random() * 50;
    const total = big ? 2.2 : 1.1 + Math.random() * 0.7;
    const geo = new THREE.BufferGeometry().setFromPoints([start, start]);
    const line = new THREE.Line(geo, meteorMatProto.clone());
    const head = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTextureRGB('rgba(255,240,210,0.95)', 'rgba(255,170,90,0.35)'),
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    head.scale.setScalar(big ? 3.4 : 1.4);
    scene.add(line, head);
    meteors.push({ line, head, vel: dir.multiplyScalar(speed), life: total, total });
  }
  function updateMeteors(dt: number) {
    const camR = Math.hypot(camera.position.x, camera.position.z);
    const inBelt = camR > auToScene(2.0) && camR < auToScene(3.6);
    meteorTimer -= dt;
    if (meteorTimer <= 0) {
      spawnMeteor(Math.random() < 0.12);
      meteorTimer = inBelt ? 0.5 + Math.random() * 1.2 : 2.5 + Math.random() * 4;
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const mt = meteors[i];
      mt.life -= dt;
      const p = mt.line.geometry.attributes.position;
      const head = new THREE.Vector3().fromBufferAttribute(p, 0);
      head.addScaledVector(mt.vel, dt);
      const tail = head.clone().addScaledVector(mt.vel, -0.16);
      p.setXYZ(0, head.x, head.y, head.z);
      p.setXYZ(1, tail.x, tail.y, tail.z);
      p.needsUpdate = true;
      mt.head.position.copy(head);
      const fade = Math.min(1, mt.life / 0.4);
      (mt.line.material as THREE.LineBasicMaterial).opacity = 0.85 * fade;
      mt.head.material.opacity = fade;
      if (mt.life <= 0 || head.distanceTo(camera.position) > 320) {
        scene.remove(mt.line, mt.head);
        mt.line.geometry.dispose();
        (mt.line.material as THREE.Material).dispose();
        mt.head.material.dispose();
        meteors.splice(i, 1);
      }
    }
  }

  // ---- 彩蛋 ----
  const eggs: EggNode[] = [];
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd8b060, metalness: 0.9, roughness: 0.35, emissive: 0x6a4a10, emissiveIntensity: 0.5 });
  function makeEggModel(key: string): THREE.Group {
    const g = new THREE.Group();
    if (key === 'voyager1') {
      const dish = new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), goldMat);
      dish.rotation.x = Math.PI;
      g.add(dish);
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), goldMat);
      boom.rotation.z = Math.PI / 2;
      g.add(boom);
      for (let i = 0; i < 3; i++) {
        const ant = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.03, 0.03), goldMat);
        ant.rotation.z = -0.5 + i * 0.5;
        ant.position.set(-1.6, 0, 0);
        g.add(ant);
      }
      const rti = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), goldMat);
      rti.position.set(1.2, 0.5, 0);
      g.add(rti);
    } else if (key === 'record') {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.05, 40), goldMat);
      disc.rotation.x = Math.PI / 2;
      g.add(disc);
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 30),
        new THREE.MeshStandardMaterial({ color: 0x2a3c66, roughness: 0.6 }));
      label.rotation.x = Math.PI / 2;
      g.add(label);
    } else if (key === 'rose') {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.6, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a6a34, roughness: 0.8 }));
      g.add(stem);
      const rose = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1),
        new THREE.MeshStandardMaterial({ color: 0xd12a44, roughness: 0.5, emissive: 0x520a14, emissiveIntensity: 0.8 }));
      rose.position.y = 0.95;
      g.add(rose);
      const glass = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14),
        new THREE.MeshStandardMaterial({ color: 0xbcd8e8, transparent: true, opacity: 0.18, roughness: 0.1 }));
      glass.position.y = 0.85;
      g.add(glass);
    } else if (key === 'clockhand') {
      for (let i = 0; i < 3; i++) {
        const geo = new THREE.BoxGeometry(0.1, 1.6 - i * 0.4, 0.05);
        geo.translate(0, 0.8 - i * 0.2, 0);
        const hand = new THREE.Mesh(geo, goldMat);
        hand.rotation.z = i * 2.2;
        g.add(hand);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12), goldMat);
      hub.rotation.x = Math.PI / 2;
      g.add(hub);
    } else {
      // bottle
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.2, 16),
        new THREE.MeshStandardMaterial({ color: 0x9ec8d8, transparent: true, opacity: 0.35, roughness: 0.15 }));
      g.add(body);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 0.36, 12),
        new THREE.MeshStandardMaterial({ color: 0x9ec8d8, transparent: true, opacity: 0.35, roughness: 0.15 }));
      neck.position.y = 0.78;
      g.add(neck);
      const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 12),
        new THREE.MeshStandardMaterial({ color: 0xa8845c, roughness: 0.9 }));
      cork.position.y = 1.0;
      g.add(cork);
      const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 10),
        new THREE.MeshStandardMaterial({ color: 0xf0e8d8, roughness: 0.9, emissive: 0x50442a, emissiveIntensity: 0.3 }));
      paper.position.y = -0.05;
      g.add(paper);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTextureRGB('rgba(255,220,150,0.75)', 'rgba(255,180,90,0.22)'),
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6,
    }));
    glow.scale.setScalar(4.5);
    g.add(glow);
    return g;
  }
  let foundEggs: string[] = [];
  try { foundEggs = JSON.parse(localStorage.getItem(EGG_STORE) || '[]'); } catch { /* 私隐模式 */ }
  const labelLayer = opts.labels ?? null;
  for (const spec of EGGS) {
    const group = makeEggModel(spec.key);
    group.position.set(spec.pos.x, spec.pos.y, spec.pos.z);
    scene.add(group);
    const found = foundEggs.includes(spec.key);
    let label: HTMLDivElement | null = null;
    if (labelLayer) {
      label = document.createElement('div');
      label.className = 'cosmos-label egg' + (found ? ' found' : '');
      label.innerHTML = '<i></i><span></span>';
      (label.querySelector('span') as HTMLElement).textContent = found ? `${spec.name} ✓` : '？';
      labelLayer.appendChild(label);
    }
    eggs.push({ key: spec.key, name: spec.name, line: spec.line, group, pos: group.position.clone(), found, label });
  }

  // ---- 行星标签 ----
  const bodyLabels: { node: BodyNode; el: HTMLDivElement; spec: { name: string } }[] = [];
  if (labelLayer) {
    for (const b of bodies) {
      if (b.key === 'sun') continue;
      const spec = byKey(b.key)!;
      const el = document.createElement('div');
      el.className = 'cosmos-label';
      el.innerHTML = '<i></i><span></span>';
      (el.querySelector('span') as HTMLElement).textContent = spec.name;
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); flyTo(b.key); });
      labelLayer.appendChild(el);
      bodyLabels.push({ node: b, el, spec });
    }
  }

  // ═══════════ 后期 ═══════════
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight).multiplyScalar(quality === 'low' ? 0.55 : 0.7),
    0.62, 0.42, 0.62,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uSpeed: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime, uSpeed;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 d = vUv - 0.5;
        float r2 = dot(d, d);
        // 高速航行：轻微径向模糊感（色散模拟）
        vec2 kick = d * uSpeed * 0.012;
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + kick).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - kick).b;
        col *= 1.0 - smoothstep(0.2, 0.65, r2) * 0.38;   // 暗角
        col += (hash(vUv * 1731.0 + fract(uTime) * 7.7) - 0.5) * 0.032; // 颗粒
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  composer.addPass(grade);

  // ═══════════ 飞行控制 ═══════════
  const coarse = matchMedia('(pointer: coarse)').matches;
  let yaw = 0, pitch = 0;
  let speed = 26;                 // u/s
  const vel = new THREE.Vector3();
  const keys = new Set<string>();
  let boost = false;
  let autopilotKey: string | null = null;
  let autopilotArrived = false;

  const startDays = Date.now() / 86400000 - 10957.5; // J2000 至今
  let simDays = startDays;
  let timeScaleIdx = 2;           // 默认 6时/秒
  let elapsed = 0;

  // 初始位姿：地球向日侧，看到大半亮面
  {
    const e = bodyScenePos(byKey('earth')!, startDays);
    const toSun = new THREE.Vector3(-e.x, -e.y, -e.z).normalize();
    const side = new THREE.Vector3().crossVectors(toSun, up).normalize();
    camera.position.set(
      e.x + toSun.x * 6.5 + side.x * 7 + 0,
      e.y + toSun.y * 6.5 + side.y * 7 + 2.4,
      e.z + toSun.z * 6.5 + side.z * 7,
    );
    const look = new THREE.Vector3(e.x, e.y, e.z).sub(camera.position).normalize();
    yaw = Math.atan2(-look.x, -look.z);
    pitch = Math.asin(Math.max(-0.99, Math.min(0.99, look.y)));
  }

  const applyCamera = () => {
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    camera.quaternion.copy(q);
  };
  applyCamera();

  function flyTo(key: string) {
    autopilotKey = key;
    autopilotArrived = false;
    opts.onSelect?.(key);
  }
  function breakAutopilot() {
    if (autopilotKey) { autopilotKey = null; opts.onSelect?.(null); }
  }

  // 键盘
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.closest('button, a, input, textarea')) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', 'c', ' ', 'shift', 'r', 'f', 't'].includes(k)) {
      if (k === ' ') e.preventDefault();
      keys.add(k);
      breakAutopilot();
    }
    if (k === 't' && !e.repeat) {
      timeScaleIdx = (timeScaleIdx + 1) % TIME_SCALES.length;
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  // 指针：左半屏摇杆 / 右半屏视角（触屏）；鼠标 = 拖拽视角 + 滚轮调速 + 点击选择
  const sticks: { id: number; kind: 'move' | 'look'; sx: number; sy: number; x: number; y: number }[] = [];
  let mouseDrag: { id: number; x: number; y: number } | null = null;
  let moved = 0;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    moved = 0;
    if (e.pointerType === 'touch') {
      const isLeft = e.clientX < innerWidth * 0.44;
      sticks.push({ id: e.pointerId, kind: isLeft ? 'move' : 'look', sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY });
      if (isLeft) showStick(e.clientX, e.clientY);
    } else {
      mouseDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      const st = sticks.find((s) => s.id === e.pointerId);
      if (st) {
        st.x = e.clientX; st.y = e.clientY;
        moved += 4;
      }
      return;
    }
    if (mouseDrag && e.pointerId === mouseDrag.id) {
      const dx = e.clientX - mouseDrag.x;
      const dy = e.clientY - mouseDrag.y;
      mouseDrag.x = e.clientX; mouseDrag.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) breakAutopilot();
      yaw -= dx * 0.0032;
      pitch = Math.max(-1.45, Math.min(1.45, pitch - dy * 0.0032));
    }
  });
  const endPointer = (e: PointerEvent) => {
    const stIdx = sticks.findIndex((s) => s.id === e.pointerId);
    if (stIdx >= 0) sticks.splice(stIdx, 1);
    if (mouseDrag && e.pointerId === mouseDrag.id) {
      if (moved < 6) handleTap(e.clientX, e.clientY);
      mouseDrag = null;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    speed = Math.max(1.2, Math.min(1600, speed * Math.pow(1.15, -Math.sign(e.deltaY))));
    opts.onSpeedToast?.(speed);
  }, { passive: false });

  // 点击拾取：行星 → 选中 + 信息卡
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function handleTap(x: number, y: number) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(clickTargets, false);
    if (hits.length > 0) {
      let key = '';
      const mesh = hits[0].object as THREE.Mesh;
      if (mesh.name === 'moon') key = 'moon';
      else {
        const b = bodies.find((bn) => bn.mesh === mesh);
        key = b?.key ?? '';
      }
      if (key) { flyTo(key); return; }
    }
  }

  // 虚拟摇杆 UI（场景内不画，由 DOM 层呈现）
  let stickEl: HTMLDivElement | null = null;
  let stickKnob: HTMLDivElement | null = null;
  function showStick(x: number, y: number) {
    if (!stickEl) {
      stickEl = document.createElement('div');
      stickEl.id = 'cosmos-stick';
      stickEl.innerHTML = '<div class="knob"></div>';
      document.body.appendChild(stickEl);
      stickKnob = stickEl.querySelector('.knob');
    }
    stickEl.style.display = 'block';
    stickEl.style.left = `${x}px`;
    stickEl.style.top = `${y}px`;
  }
  function hideStick() {
    if (stickEl) {
      stickEl.style.display = 'none';
      if (stickKnob) stickKnob.style.transform = 'translate(-50%, -50%)';
    }
  }

  // ═══════════ 主循环 ═══════════
  const clock = new THREE.Clock();
  let raf = 0;
  let ready = false;
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();

  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    elapsed += dt;
    simDays += dt * TIME_SCALES[timeScaleIdx];

    // ---- 行星位置 / 自转 ----
    for (const b of bodies) {
      if (b.key === 'sun') { b.mesh.rotation.y = rotationAngle(609.12, simDays) * 0.02; continue; }
      const spec = byKey(b.key)!;
      const p = bodyScenePos(spec, simDays);
      b.pos.set(p.x, p.y, p.z);
      b.group.position.copy(b.pos);
      b.mesh.rotation.y = rotationAngle(spec.rotationHours, simDays) + (spinOffsets[b.key] ?? 0);
      const clouds = b.axis.getObjectByName('earthClouds');
      if (clouds) clouds.rotation.y = rotationAngle(28, simDays); // 云层略快
    }
    // 月球
    const moonMesh = scene.getObjectByName('moon') as THREE.Mesh | null;
    if (moonMesh) {
      const e = bodies.find((b) => b.key === 'earth')!;
      const m = moonScenePos(simDays);
      moonMesh.position.set(e.pos.x + m.x, e.pos.y + m.y, e.pos.z + m.z);
      moonMesh.rotation.y = -Math.atan2(m.z, m.x); // 潮汐锁定
    }
    // 小行星带整体随开普勒平均运动缓慢公转（2.7AU ≈ 4.44 年）
    beltGroup.rotation.y = (simDays / 1622) * Math.PI * 2;

    // ---- 摇杆 → 移动向量 ----
    let fwd = 0, side = 0, lift = 0;
    const moveStick = sticks.find((s) => s.kind === 'move');
    if (moveStick) {
      const dx = moveStick.x - moveStick.sx;
      const dy = moveStick.y - moveStick.sy;
      const c = joystickClamp(dx / 56, -dy / 56);
      side = c.x;
      fwd = -c.y; // 摇杆向上 = 前进（屏幕 y 向下为正）
      if (stickKnob) {
        const m = Math.min(1, Math.hypot(dx, dy) / 56);
        const ang = Math.atan2(dy, dx);
        stickKnob.style.transform = `translate(calc(-50% + ${Math.cos(ang) * m * 34}px), calc(-50% + ${Math.sin(ang) * m * 34}px))`;
      }
    }
    if (keys.has('w')) fwd += 1;
    if (keys.has('s')) fwd -= 1;
    if (keys.has('d')) side += 1;
    if (keys.has('a')) side -= 1;
    if (keys.has(' ') || keys.has('e') || keys.has('q')) lift += 1;
    if (keys.has('c')) lift -= 1;
    boost = keys.has('shift');

    // ---- 自动导航 ----
    if (autopilotKey) {
      const key = autopilotKey;
      let targetPos: THREE.Vector3 | null = null;
      let targetR = 6;
      if (key === 'moon' && moonMesh) { targetPos = moonMesh.position; targetR = kmToUnits(MOON.radiusKm); }
      else {
        const b = bodies.find((bn) => bn.key === key);
        if (b) { targetPos = b.pos; targetR = b.radius; }
      }
      if (!targetPos) { autopilotKey = null; }
      else {
        const dist = camera.position.distanceTo(targetPos);
        const want = approachDist(targetR);
        tmpV.copy(camera.position).sub(targetPos).normalize().multiplyScalar(want).add(targetPos);
        camera.position.lerp(tmpV, Math.min(dt * 1.35, 1));
        vel.multiplyScalar(Math.pow(0.02, dt));
        // 视线缓转向目标
        const m = new THREE.Matrix4().lookAt(camera.position, targetPos, up);
        tmpQ.setFromRotationMatrix(m);
        camera.quaternion.slerp(tmpQ, Math.min(dt * 2.4, 1));
        // 同步 yaw/pitch 供手动接管
        const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        yaw = e.y; pitch = e.x;
        if (dist < want * 1.25) { autopilotArrived = true; }
        if (autopilotArrived && dist < want * 1.02) { autopilotKey = null; }
      }
    } else {
      // ---- 手动飞行 ----
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const u = up.clone().applyQuaternion(camera.quaternion);
      tmpV.set(0, 0, 0)
        .addScaledVector(f, fwd)
        .addScaledVector(r, side)
        .addScaledVector(u, lift);
      if (tmpV.lengthSq() > 1e-6) tmpV.normalize().multiplyScalar(speed * (boost ? 4 : 1));
      vel.lerp(tmpV, Math.min(dt * 3.2, 1));
      camera.position.addScaledVector(vel, dt);
      applyCamera();
    }

    // 视场角随速度呼吸（速度感）
    const sp = vel.length();
    const targetFov = 58 + Math.min(sp / 1600, 1) * 14 + (boost ? 4 : 0);
    camera.fov += (targetFov - camera.fov) * Math.min(dt * 4, 1);
    camera.updateProjectionMatrix();

    // ---- 宇宙尘包裹（速度视差） ----
    {
      const p = dustGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const dx = x - camera.position.x, dy = y - camera.position.y, dz = z - camera.position.z;
        if (dx > DUST_R) x -= DUST_R * 2; else if (dx < -DUST_R) x += DUST_R * 2;
        if (dy > DUST_R) y -= DUST_R * 2; else if (dy < -DUST_R) y += DUST_R * 2;
        if (dz > DUST_R) z -= DUST_R * 2; else if (dz < -DUST_R) z += DUST_R * 2;
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;
      dustMat.opacity = 0.18 + Math.min(sp / 500, 1) * 0.5;
    }

    // ---- 太阳动画与光照 ----
    sunMat.uniforms.uTime.value = t;
    corona.material.opacity = 0.8 + 0.08 * Math.sin(t * 0.7);
    corona.position.set(0, 0, 0);

    // ---- 流星 / 彩蛋 ----
    updateMeteors(dt);
    for (const egg of eggs) {
      egg.group.rotation.y += dt * 0.3;
      egg.group.rotation.x += dt * 0.12;
      const d = camera.position.distanceTo(egg.pos);
      if (!egg.found && d < 10) {
        egg.found = true;
        foundEggs.push(egg.key);
        try { localStorage.setItem(EGG_STORE, JSON.stringify(foundEggs)); } catch { /* 忽略 */ }
        if (egg.label) (egg.label.querySelector('span') as HTMLElement).textContent = `${egg.name} ✓`;
        egg.label?.classList.add('found');
        opts.onDiscover?.(egg.key, egg.name, egg.line);
      }
    }

    // ---- 标签投影 ----
    if (labelLayer) {
      const w = canvas.clientWidth || innerWidth;
      const h = canvas.clientHeight || innerHeight;
      const project = (world: THREE.Vector3, el: HTMLDivElement, near: number, far: number) => {
        tmpV.copy(world).project(camera);
        const d = camera.position.distanceTo(world);
        const behind = tmpV.z > 1;
        const vis = !behind && d > near && d < far;
        el.style.opacity = vis ? '1' : '0';
        if (vis) {
          el.style.transform = `translate(${((tmpV.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-tmpV.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
        }
      };
      for (const bl of bodyLabels) {
        project(bl.node.pos, bl.el, bl.node.radius * 4.5, 1600);
      }
      for (const egg of eggs) {
        if (egg.label) project(egg.pos, egg.label, 2, egg.found ? 90 : 160);
      }
    }

    // ---- 最近天体 ----
    let nearest = '—';
    let nearestDist = Infinity;
    for (const b of bodies) {
      const d = camera.position.distanceTo(b.pos) - b.radius;
      if (d < nearestDist) { nearestDist = d; nearest = b.key === 'sun' ? '太阳' : byKey(b.key)!.name; }
    }
    if (moonMesh) {
      const d = camera.position.distanceTo(moonMesh.position) - kmToUnits(MOON.radiusKm);
      if (d < nearestDist) { nearestDist = d; nearest = '月球'; }
    }

    // ---- 后期 ----
    grade.uniforms.uTime.value = t;
    grade.uniforms.uSpeed.value = Math.min(sp / 900, 1);
    composer.render();

    if (!ready) { ready = true; opts.onReady?.(); }
    opts.onTick?.({
      speed: sp,
      timeScaleIdx,
      simDays,
      nearest,
      nearestDist: Math.max(nearestDist, 0),
      eggsFound: foundEggs.length,
      eggsTotal: EGGS.length,
      autopilot: autopilotKey,
    });
  }

  // ---- 调试参数（无头验证用） ----
  const q = new URLSearchParams(location.search);
  const spinOffsets: Record<string, number> = {}; // 调试用：让特征（如大红斑）面向镜头
  if (q.has('at')) {
    const k = q.get('at')!;
    let tp: { x: number; y: number; z: number } | null = null;
    let tr = SUN_SCENE_R;
    if (k === 'moon') {
      const e = bodies.find((b) => b.key === 'earth')!;
      const m = moonScenePos(simDays);
      tp = { x: e.pos.x + m.x, y: e.pos.y + m.y, z: e.pos.z + m.z };
      tr = kmToUnits(MOON.radiusKm);
    } else if (byKey(k)) {
      tp = bodyScenePos(byKey(k)!, simDays);
      tr = kmToUnits(byKey(k)!.radiusKm);
      if (k === 'sun') tr = SUN_SCENE_R;
    }
    if (tp) {
      // 直接传送到日侧偏斜位：既受光又可见晨昏线（无头帧稀疏，缓动导航到不了）
      const view = Math.max(tr * 5.2, 8);
      const d = Math.hypot(tp.x, tp.y, tp.z);
      let dir: THREE.Vector3;
      if (d < 1e-3) {
        dir = new THREE.Vector3(0.7, 0.25, 0.67).normalize(); // 太阳本体：任选来向
      } else {
        dir = new THREE.Vector3(tp.x / d, tp.y / d, tp.z / d);
      }
      const perp = new THREE.Vector3().crossVectors(dir, up).normalize();
      camera.position.set(
        tp.x - dir.x * view + perp.x * view * 1.15,
        tp.y - dir.y * view + tr * 0.8,
        tp.z - dir.z * view + perp.z * view * 1.15,
      );
      const look = new THREE.Vector3(tp.x, tp.y, tp.z).sub(camera.position).normalize();
      yaw = Math.atan2(-look.x, -look.z);
      pitch = Math.asin(Math.max(-0.99, Math.min(0.99, look.y)));
      applyCamera();
      // 让大红斑（纹理 u=0.62）面向镜头：解出自转偏移（须扣除该历元的基础自转角）
      if (k === 'jupiter' || k === 'neptune') {
        const spec = byKey(k)!;
        const camDir = new THREE.Vector3().subVectors(camera.position, new THREE.Vector3(tp.x, tp.y, tp.z)).normalize();
        const spotU = 0.62;
        // SphereGeometry: u 的经度方向为 (−cosα, ·, sinα), α = 2πu
        const alpha = spotU * Math.PI * 2;
        const local = new THREE.Vector3(-Math.cos(alpha), 0, Math.sin(alpha));
        const alphaV = Math.atan2(local.z, local.x);
        const beta = Math.atan2(camDir.z, camDir.x);
        spinOffsets[k] = alphaV - beta - rotationAngle(spec.rotationHours, simDays);
      }
    }
  }
  if (q.has('eggs')) {
    // 揭示所有彩蛋标签（验证布局）
    for (const egg of eggs) { if (!egg.found) egg.label?.classList.add('reveal'); }
  }

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

  const onVis = () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) raf = requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', onVis);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); });

  raf = requestAnimationFrame(frame);

  return {
    flyTo,
    cycleTime(): number {
      timeScaleIdx = (timeScaleIdx + 1) % TIME_SCALES.length;
      return timeScaleIdx;
    },
    get speedUnit(): number { return speed; },
    setSpeed(s: number) { speed = Math.max(1.2, Math.min(1600, s)); },
    dispose() {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
      renderer.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose();
      });
    },
  };
}
