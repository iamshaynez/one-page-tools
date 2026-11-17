/**
 * 《宇宙漫游》场景 — 从地球出发的太阳系飞行（戏剧渲染版）
 *
 * 骨架保持诚实：J2000 真实轨道、真实半径比例、真实倾角；
 * 光是舞台化的：一切为「漫游的壮丽」服务。
 *
 * 渲染要点：
 *  · PMREM 程序化环境贴图 → 行星与金属获得真实空间反射
 *  · 地球 2048 贴图 + 地形凹凸 + 夜面城市灯光 + 散射大气（晨昏线橙红）
 *  · 岩质行星带陨坑高度贴图；气巨 6 倍频域扭曲条带 + 大红斑漩涡
 *  · 土星环自定义着色器：解析行星本影（软边）投在环上
 *  · 小行星带：4 种顶点位移圆润岩石，非均匀拉伸 + 逐实例颜色
 *  · 亮星衍射十字、九片星云银河带、柯伊伯带颜色抖动、流星渐变尾迹
 *  · 屏保模式：隐藏全部 HUD（页面侧切换 body.cinema）
 *
 * 戏剧层（本版新增）：
 *  · 广角镜头 67°（截图的宏大感）+ 高速/助推时的 FOV 拉伸
 *  · 动态辉光：阈值降到 0.38，强度随近日距离、航速与事件闪光起舞
 *  · 太阳光轴（god-rays）：屏幕空间径向采样，靠近日时圣光盛放
 *  · 调色：饱和/对比/冷暖分离（青影暖调）+ 色散 + 暗角 + 颗粒
 *  · 行星光环 halo：远处也能看见目的地的微光，漫游有了路标
 *  · 轨道线按行星着色提亮：太阳系的结构一眼可读
 *  · 彗星：高偏心掠日轨道 + 背阳粒子尾（演出时钟，独立于宇宙历）
 *  · 曲速流光：高速航行时星流拉丝
 *  · 巡航模式：自动逐站漫游（月→内行星→太阳→外行星），任意手动操作退出
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  rng, range, PLANETS, MOON, EGGS, byKey,
  bodyScenePos, moonScenePos, rotationAngle, kmToUnits, auToScene,
  SUN_SCENE_R, TIME_SCALES, joystickClamp, approachDist,
  heliocentricAU, eclipticToScene,
} from './cosmos-core';
import type { BodySpec } from './cosmos-core';

export interface CosmosTick {
  speed: number;
  timeScaleIdx: number;
  simDays: number;
  nearest: string;
  nearestDist: number;
  eggsFound: number;
  eggsTotal: number;
  autopilot: string | null;
  tour: boolean;            // 巡航模式进行中
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
// 程序化纹理（可平铺经度方向；颜色 + 高度同步生成）
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
    let v = 0, a = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { v += a * noise(x * f, y * f); norm += a; f *= 2.03; a *= 0.5; }
    return v / norm;
  };
  return { noise, fbm, r };
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function mixHex(a: number, b: number, t: number): number {
  const ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255;
  const br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
  return ((ar + (br - ar) * t) << 16) | ((ag + (bg - ag) * t) << 8) | (ab + (bb - ab) * t);
}
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** 气态巨行星：高对比条带 + 双层域扭曲 + 风暴漩涡（白眼壁 + 深核） */
function bandsTexture(seed: number, palette: number[], opts: { spot?: string; spotColor?: number } = {}, W = 512): THREE.Texture {
  const H = W / 2;
  const n = makeNoise(seed);
  return canvasTex(W, H, (g) => {
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        // 双层域扭曲：大尺度涡 + 小尺度湍流（壁纸级细节的关键）
        const warp = (n.fbm(u * 6, v * 18, 5) - 0.5) * 0.26
          + (n.fbm(u * 18 + 7, v * 44, 4) - 0.5) * 0.08;
        const band = v + warp;
        const pos = band * (palette.length - 1);
        const i = Math.max(0, Math.min(palette.length - 2, Math.floor(pos)));
        let c = mixHex(palette[i], palette[i + 1], pos - i);
        const lum = 0.78 + 0.44 * (n.fbm(u * 34, v * 60, 4) - 0.5);
        c = mixHex(c, 0xffffff, Math.max(0, lum - 1));
        c = mixHex(c, 0x000000, Math.max(0, 1 - lum) * 0.75);
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
      const sc = opts.spotColor ?? 0xc1442e;
      const ellipse = (w: number, h: number, color: string | number, alpha: number) => {
        g.save();
        g.translate(sx * W, sy * H);
        g.rotate(-0.08);
        g.scale((w * W) / 2, (h * H) / 2);
        g.globalAlpha = alpha;
        g.fillStyle = typeof color === 'number' ? hex(color) : color;
        g.beginPath();
        g.arc(0, 0, 1, 0, Math.PI * 2);
        g.fill();
        g.restore();
      };
      ellipse(sw * 1.35, sh * 1.7, 0xe8dcc8, 0.5);   // 白眼壁外环
      ellipse(sw, sh, sc, 0.95);                      // 风暴主体
      ellipse(sw * 0.62, sh * 0.6, 0x8a2c1c, 0.85);   // 深核
    }
  });
}

/** 岩质行星：颜色 + 陨坑高度贴图（同步生成，坑位一致） */
function rockyTextures(seed: number, base: number, accent: number, opts: { craters?: number; caps?: number; capColor?: number } = {}): { map: THREE.Texture; bump: THREE.Texture } {
  const W = 512, H = 256;
  const n = makeNoise(seed);
  const craters = opts.craters ?? 90;
  const craterList: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < craters; i++) {
    const cy = n.r() * H;
    const lat = Math.abs(cy / H - 0.5) * 2;
    if (opts.caps && lat > 1 - opts.caps * 0.3) continue;
    craterList.push({ x: n.r() * W, y: cy, r: 1 + Math.pow(n.r(), 2.6) * 14 });
  }
  const colorCv = document.createElement('canvas');
  colorCv.width = W; colorCv.height = H;
  const bumpCv = document.createElement('canvas');
  bumpCv.width = W; bumpCv.height = H;
  const gc = colorCv.getContext('2d')!;
  const gb = bumpCv.getContext('2d')!;
  const img = gc.createImageData(W, H);
  const bmp = gb.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const f = n.fbm(u * 10 + 3, v * 10, 5);
      let c = mixHex(base, accent, Math.min(1, Math.max(0, (f - 0.34) * 2.4)));
      let hgt = 0.42 + f * 0.3;
      if (opts.caps) {
        const lat = Math.abs(v - 0.5) * 2;
        const capT = Math.max(0, (lat - (1 - opts.caps * 0.35)) / (opts.caps * 0.35));
        const cap = Math.min(1, capT * (0.8 + 0.4 * n.fbm(u * 14, v * 14, 3)));
        c = mixHex(c, opts.capColor ?? 0xeef3f5, cap);
        hgt += cap * 0.1;
      }
      const o = (y * W + x) * 4;
      img.data[o] = c >> 16 & 255;
      img.data[o + 1] = c >> 8 & 255;
      img.data[o + 2] = c & 255;
      img.data[o + 3] = 255;
      const hb = Math.round(Math.min(1, hgt) * 255);
      bmp.data[o] = hb; bmp.data[o + 1] = hb; bmp.data[o + 2] = hb; bmp.data[o + 3] = 255;
    }
  }
  gc.putImageData(img, 0, 0);
  gb.putImageData(bmp, 0, 0);
  for (const cr of craterList) {
    // 颜色：暗底 + 亮缘
    let grad = gc.createRadialGradient(cr.x, cr.y, cr.r * 0.15, cr.x, cr.y, cr.r);
    grad.addColorStop(0, 'rgba(0,0,0,0.34)');
    grad.addColorStop(0.72, 'rgba(0,0,0,0.12)');
    grad.addColorStop(0.86, 'rgba(255,255,255,0.20)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    gc.fillStyle = grad;
    gc.beginPath();
    gc.arc(cr.x, cr.y, cr.r, 0, Math.PI * 2);
    gc.fill();
    // 高度：坑底深 + 环缘凸
    grad = gb.createRadialGradient(cr.x, cr.y, cr.r * 0.1, cr.x, cr.y, cr.r);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.2)');
    grad.addColorStop(0.88, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    gb.fillStyle = grad;
    gb.beginPath();
    gb.arc(cr.x, cr.y, cr.r, 0, Math.PI * 2);
    gb.fill();
  }
  const map = new THREE.CanvasTexture(colorCv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.wrapS = THREE.RepeatWrapping;
  const bump = new THREE.CanvasTexture(bumpCv);
  bump.wrapS = THREE.RepeatWrapping;
  return { map, bump };
}

/** 地球全家桶：大陆颜色 + 地形高度 + 夜面城市灯光（共享同一块大陆掩码） */
function earthTextures(seed: number, scale = 1): { map: THREE.Texture; bump: THREE.Texture; lights: THREE.Texture } {
  const W = Math.round(2048 * scale), H = Math.round(1024 * scale);
  const n = makeNoise(seed);
  const colorCv = document.createElement('canvas');
  const bumpCv = document.createElement('canvas');
  const lightCv = document.createElement('canvas');
  colorCv.width = bumpCv.width = lightCv.width = W;
  colorCv.height = bumpCv.height = lightCv.height = H;
  const gc = colorCv.getContext('2d')!;
  const gb = bumpCv.getContext('2d')!;
  const gl = lightCv.getContext('2d')!;
  gl.fillStyle = '#000';
  gl.fillRect(0, 0, W, H);
  const img = gc.createImageData(W, H);
  const bmp = gb.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const lat = Math.abs(v - 0.5) * 2;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const cont = n.fbm(u * 6 + 11, v * 6, 6) + 0.18 * Math.cos(v * Math.PI) - 0.09;
      const o = (y * W + x) * 4;
      let c: number;
      let hgt = 0.35;
      let city = 0;
      if (cont > 0.52) {
        const h = (cont - 0.52) / 0.3;
        c = h < 0.16 ? mixHex(0xc2b280, 0x3d6b3a, h / 0.16)
          : h < 0.6 ? mixHex(0x3d6b3a, 0x6b7d42, (h - 0.16) / 0.44)
          : mixHex(0x6b7d42, 0x8a7f6e, (h - 0.6) / 0.4);
        if (lat > 0.72) c = mixHex(c, 0xe8eef2, Math.min(1, (lat - 0.72) / 0.2));
        if (lat < 0.14) c = mixHex(c, 0x8f9a4e, 0.35);
        hgt = 0.5 + h * 0.45;
        // 城市灯：大陆上、温带更多、沿海（h 低）更亮，斑点聚簇
        const temperate = Math.max(0, 1 - Math.abs(lat - 0.32) / 0.42);
        const cluster = n.fbm(u * 26 + 71, v * 26, 3);
        city = Math.max(0, (cluster - 0.52) * 2.4) * temperate * (1 - h * 0.7);
        if (lat > 0.66 || lat < 0.08) city *= 0.15;
      } else {
        const d = 0.52 - cont;
        c = d < 0.04 ? mixHex(0x2f6f8f, 0x123a5e, d / 0.04)
          : mixHex(0x123a5e, 0x0a2140, Math.min(1, (d - 0.04) / 0.3));
        hgt = 0.3;
      }
      if (lat > 0.88) { c = mixHex(c, 0xf0f5f8, Math.min(1, (lat - 0.88) / 0.08)); hgt = 0.55; city = 0; }
      img.data[o] = c >> 16 & 255;
      img.data[o + 1] = c >> 8 & 255;
      img.data[o + 2] = c & 255;
      img.data[o + 3] = 255;
      const hb = Math.round(Math.min(1, hgt) * 255);
      bmp.data[o] = hb; bmp.data[o + 1] = hb; bmp.data[o + 2] = hb; bmp.data[o + 3] = 255;
      if (city > 0.1) {
        gl.fillStyle = `rgba(255,${Math.round(196 + 30 * n.noise(u * 60, v * 60))},${Math.round(110 + 40 * n.noise(u * 40, v * 40))},${Math.min(1, city * 1.2)})`;
        gl.fillRect(x, y, 2, 2); // 2×2 光斑：远看聚成城市群
      }
    }
  }
  gc.putImageData(img, 0, 0);
  gb.putImageData(bmp, 0, 0);
  const mk = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  };
  return { map: mk(colorCv, true), bump: mk(bumpCv, false), lights: mk(lightCv, true) };
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
        const a = Math.max(0, (f - 0.55) * 2.0);
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
      const t = x / W;
      let a = 0.75 + 0.25 * n.fbm(t * 60, 3, 4);
      a *= t < 0.08 ? t / 0.08 : 1;
      if (t > 0.66 && t < 0.74) a *= 0.12 + 0.1 * n.fbm(t * 90, 1, 2);
      if (t > 0.955 && t < 0.965) a *= 0.15;
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

/** 柔和圆点贴图：粒子系统共用（无贴图的点会渲染成方块，辉光阈值降低后会显形） */
function softDotTexture(): THREE.Texture {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 亮星衍射十字贴图 */
function starFlareTexture(): THREE.Texture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d')!;
  const cx = S / 2;
  const core = g.createRadialGradient(cx, cx, 0, cx, cx, S * 0.1);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, S, S);
  // 十字衍射（更粗更亮，缩小后仍可见）
  for (const rot of [0, Math.PI / 2]) {
    g.save();
    g.translate(cx, cx);
    g.rotate(rot);
    const grad = g.createLinearGradient(-cx, 0, cx, 0);
    grad.addColorStop(0, 'rgba(190,215,255,0)');
    grad.addColorStop(0.5, 'rgba(225,240,255,0.95)');
    grad.addColorStop(1, 'rgba(190,215,255,0)');
    g.fillStyle = grad;
    g.fillRect(-cx, -2.6, S, 5.2);
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 顶点噪声位移：把几何体揉成有机形状（先焊接共享顶点，法线才能平滑） */
function displaceGeometry(geo: THREE.BufferGeometry, n: ReturnType<typeof makeNoise>, amp: number, freq: number): THREE.BufferGeometry {
  const welded = mergeVertices(geo, 1e-4);
  const p = welded.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + (n.fbm(v.x * freq + 10, v.y * freq + (v.z + 5) * freq, 4) - 0.5) * amp;
    p.setXYZ(i, v.x * d, v.y * d, v.z * d);
  }
  welded.computeVertexNormals();
  return welded;
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
  group: THREE.Group;
  axis: THREE.Group;
  mesh: THREE.Mesh;
  radius: number;
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
  const hi = quality === 'high';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x020208, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.97;
  const DPR = Math.min(devicePixelRatio || 1, hi ? 2 : 1.75);
  renderer.setPixelRatio(DPR);

  const scene = new THREE.Scene();
  // 广角 67°：截图时前景天体与远景太阳同框，宏大感来自强透视
  const camera = new THREE.PerspectiveCamera(67, 1, 0.05, 6000);
  const up = new THREE.Vector3(0, 1, 0);

  // ---- PMREM 程序化环境：金属反射与行星微反光的来源 ----
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSun = new THREE.Mesh(
      new THREE.SphereGeometry(4, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff4e2 }),
    );
    envSun.position.set(60, 22, 40);
    envScene.add(envSun);
    const bg = new THREE.Mesh(
      new THREE.SphereGeometry(500, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x0a0e1c, side: THREE.BackSide }),
    );
    envScene.add(bg);
    const envGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTextureRGB('rgba(255,220,170,0.9)', 'rgba(120,90,60,0.2)'),
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    envGlow.scale.setScalar(120);
    envGlow.position.copy(envSun.position);
    envScene.add(envGlow);
    scene.environment = pmrem.fromScene(envScene, 0.05).texture;
    pmrem.dispose();
  }

  // ---- 灯光 ----
  scene.add(new THREE.AmbientLight(0x28304a, 0.45));
  const sunLight = new THREE.PointLight(0xfff0dd, 190, 0, 1);
  scene.add(sunLight);

  // ---- 星野：双层恒星 + 光谱色 + 亮星衍射十字 + 银河带 + 星云 ----
  const skyRng = rng(42);
  const sky = new THREE.Group();
  scene.add(sky);
  {
    const mkStars = (count: number, rMin: number, rMax: number, size: number, tint: [number, number, number]) => {
      const pos = new Float32Array(count * 3);
      const seeds = new Float32Array(count);
      const cols = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const u = skyRng() * 2 - 1;
        const t = skyRng() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const R = range(skyRng, rMin, rMax);
        pos[i * 3] = Math.cos(t) * s * R;
        pos[i * 3 + 1] = u * R;
        pos[i * 3 + 2] = Math.sin(t) * s * R;
        seeds[i] = skyRng();
        // 恒星光谱：蓝白 / 纯白 / 暖橙（近似真实分布，拉大色彩饱和）
        const kind = skyRng();
        const c = kind < 0.24 ? [0.45, 0.62, 1.0] : kind < 0.8 ? [1, 0.97, 0.9] : [1.0, 0.55, 0.28];
        cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      geo.setAttribute('aColor', new THREE.BufferAttribute(cols, 3));
      const mat = new THREE.ShaderMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        uniforms: { uTime: { value: 0 }, uPx: { value: DPR * (900 + size * 360) } },
        vertexShader: /* glsl */ `
          uniform float uTime, uPx;
          attribute float aSeed;
          attribute vec3 aColor;
          varying float vA; varying vec3 vC;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vC = aColor;
            vA = 0.3 + 0.7 * (0.5 + 0.5 * sin(uTime * (0.5 + aSeed) + aSeed * 99.0));
            gl_PointSize = (0.8 + aSeed * 1.7) * uPx / max(-mv.z, 1.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA; varying vec3 vC;
          void main() {
            vec2 d = gl_PointCoord - 0.5;
            float m = smoothstep(0.5, 0.06, length(d));
            gl_FragColor = vec4(vC, vA * m * 1.04);
          }
        `,
      });
      return new THREE.Points(geo, mat);
    };
    sky.add(mkStars(hi ? 5200 : 2600, 2200, 3400, 1, [0.9, 0.93, 1.0]));
    sky.add(mkStars(hi ? 1800 : 900, 1800, 2600, 1.8, [1.0, 0.95, 0.85]));

    // 亮星：衍射十字贴图点精灵（双层：主星 + 群星）
    const mkFlares = (count: number, size: number, opacity: number, R: number) => {
      const flareMat = new THREE.PointsMaterial({
        map: starFlareTexture(), color: 0xffffff, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, size, sizeAttenuation: true,
      });
      const flareGeo = new THREE.BufferGeometry();
      const fpos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const u = skyRng() * 2 - 1;
        const t = skyRng() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        fpos[i * 3] = Math.cos(t) * s * R;
        fpos[i * 3 + 1] = u * R;
        fpos[i * 3 + 2] = Math.sin(t) * s * R;
      }
      flareGeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
      sky.add(new THREE.Points(flareGeo, flareMat));
    };
    mkFlares(18, 86, 1.0, 2600);   // 主角亮星
    mkFlares(30, 44, 0.78, 2400);  // 次级群星
    mkFlares(46, 26, 0.55, 2200);  // 群星背景耀斑

    // 银河带：粒子 + 暗尘埃裂隙（减光的暖带）
    const bandN = hi ? 4600 : 2200;
    const bpos = new Float32Array(bandN * 3);
    const bseed = new Float32Array(bandN);
    const bandTilt = 1.05;
    for (let i = 0; i < bandN; i++) {
      const a = skyRng() * Math.PI * 2;
      const spread = (skyRng() + skyRng() + skyRng() - 1.5) * 0.2;
      const dust = skyRng() < 0.28; // 尘埃裂隙
      const R = range(skyRng, 2400, 3200);
      const x = Math.cos(a), y = spread * (dust ? 0.5 : 1), z = Math.sin(a);
      const y2 = y * Math.cos(bandTilt) - z * Math.sin(bandTilt);
      const z2 = y * Math.sin(bandTilt) + z * Math.cos(bandTilt);
      bpos[i * 3] = x * R; bpos[i * 3 + 1] = y2 * R; bpos[i * 3 + 2] = z2 * R;
      bseed[i] = dust ? skyRng() * 0.15 : 0.35 + skyRng() * 0.65;
    }
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
    bgeo.setAttribute('aSeed', new THREE.BufferAttribute(bseed, 1));
    const bandMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { uPx: { value: DPR * 620 } },
      vertexShader: /* glsl */ `
        uniform float uPx;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vA = 0.3 + 0.62 * aSeed;
          gl_PointSize = (1.8 + aSeed * 3.6) * uPx / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float m = smoothstep(0.5, 0.05, length(d));
          gl_FragColor = vec4(vec3(0.68, 0.73, 0.92), vA * m * 3.0);
        }
      `,
    });
    sky.add(new THREE.Points(bgeo, bandMat));

    // 银河雾霭：沿带铺几片大尺度低透明辉光，把粒子带黏成「发光的河」
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.9;
      const y2 = Math.sin(a) * Math.sin(1.05);
      const z2 = Math.sin(a) * Math.cos(1.05);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTextureRGB('rgba(150,165,205,0.10)', 'rgba(70,84,130,0.035)'),
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85,
      }));
      sp.position.set(Math.cos(a) * 2900, y2 * 2900, z2 * 2900);
      sp.scale.set(range(skyRng, 1200, 1700), range(skyRng, 700, 950), 1);
      sky.add(sp);
    }

    // 九片星云：冷暖交替沿银河带（戏剧档：透明度与尺度都上探，
    // 仍沿带分布而非全天铺满，保留结构与暗隙）
    const nebulaColors: [string, string][] = [
      ['rgba(128,148,220,0.34)', 'rgba(58,76,148,0.12)'],
      ['rgba(212,156,132,0.29)', 'rgba(118,76,66,0.09)'],
      ['rgba(136,178,198,0.26)', 'rgba(58,96,116,0.08)'],
      ['rgba(168,126,198,0.24)', 'rgba(70,52,110,0.075)'],
      ['rgba(198,176,132,0.22)', 'rgba(100,86,60,0.07)'],
      ['rgba(114,176,164,0.21)', 'rgba(46,96,88,0.065)'],
      ['rgba(150,132,214,0.20)', 'rgba(64,54,120,0.06)'],
      ['rgba(214,150,120,0.18)', 'rgba(110,70,56,0.055)'],
      ['rgba(120,168,188,0.17)', 'rgba(52,90,108,0.05)'],
    ];
    nebulaColors.forEach(([inner, outer], i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTextureRGB(inner, outer),
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.92,
      }));
      const a = (i / nebulaColors.length) * Math.PI * 2 + 0.35;
      const y2 = Math.sin(a) * Math.sin(1.05);
      const z2 = Math.sin(a) * Math.cos(1.05);
      sp.position.set(Math.cos(a) * 3100, y2 * 3100, z2 * 3100);
      sp.scale.setScalar(range(skyRng, 520, 840));
      sky.add(sp);
    });
  }

  // ---- 太阳：细米粒光球着色器 + 日冕 + 耀斑十字 ----
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
        // 域扭曲双层米粒：等离子体对流
        vec2 q = p.xy * 6.0 + uTime * 0.05;
        q += vec2(fbm(q * 1.6 + 3.1) - 0.5, fbm(q * 1.6 + 8.7) - 0.5) * 1.4;
        float g1 = fbm(q);
        float g2 = fbm(p.yz * 15.0 - uTime * 0.04 + 4.7);
        float gran = 0.5 + 0.5 * (g1 * 0.62 + g2 * 0.38);
        gran = pow(gran, 1.45); // 拉开对比：暗沟更深，亮胞才留得住细节
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        vec3 deep = vec3(0.95, 0.34, 0.03);
        vec3 mid  = vec3(1.0, 0.72, 0.22);
        vec3 hot  = vec3(1.0, 0.97, 0.88);
        vec3 col = mix(deep, mid, gran);
        col = mix(col, hot, pow(gran, 3.0));
        col += vec3(1.0, 0.55, 0.16) * rim * 1.3;
        gl_FragColor = vec4(col * 1.65, 1.0); // HDR：喂给 bloom 与光轴（过犹不及）
      }
    `,
  });
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_SCENE_R, 72, 54), sunMat);
  const sunGroup = new THREE.Group();
  sunGroup.add(sunMesh);
  scene.add(sunGroup);
  // 日冕：太阳的光环（径向渐变陡峭，盛而不洗）
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTextureRGB('rgba(255,214,130,0.7)', 'rgba(255,140,40,0.15)'),
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85,
  }));
  corona.scale.setScalar(SUN_SCENE_R * 3.5);
  scene.add(corona);
  const sunFlare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: starFlareTexture(), transparent: true, opacity: 0.24,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sunFlare.scale.set(SUN_SCENE_R * 9.5, SUN_SCENE_R * 9.5, 1);
  scene.add(sunFlare);

  // ---- 行星 ----
  const bodies: BodyNode[] = [];
  const clickTargets: THREE.Mesh[] = [];
  const ringMats: { mat: THREE.ShaderMaterial; bodyKey: string; mesh: THREE.Mesh }[] = [];
  // 行星主题色：轨道线与光环 halo 共用，让结构一眼可读
  const BODY_TINT: Record<string, number> = {
    mercury: 0x9a948e, venus: 0xd9b77e, earth: 0x4f8fd9, mars: 0xc07a5a,
    jupiter: 0xd8b58a, saturn: 0xd9c9a5, uranus: 0x9fd4d9, neptune: 0x5478d2, pluto: 0xbfae9a,
  };
  const TEXROCK: Record<string, () => { map: THREE.Texture; bump: THREE.Texture }> = {
    mercury: () => rockyTextures(11, 0x8a8580, 0x55504b, { craters: 150 }),
    mars: () => rockyTextures(41, 0xb5613c, 0x7a3a24, { craters: 80, caps: 0.24, capColor: 0xf0ece6 }),
    pluto: () => rockyTextures(91, 0xbfae9a, 0x8a7a68, { craters: 50, caps: 0.3 }),
  };
  const earthSet = earthTextures(31, hi ? 1 : 0.5);
  const moonSet = rockyTextures(141, 0x9a9a96, 0x6b6b66, { craters: 170 });

  const SEG = hi ? 96 : 48;

  function mkRockyMat(t: { map: THREE.Texture; bump: THREE.Texture }, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    return new THREE.MeshStandardMaterial({
      map: t.map, bumpMap: t.bump, bumpScale: 0.05,
      roughness: 0.95, metalness: 0.02,
      envMapIntensity: 0.18,
      ...extra,
    });
  }

  for (const spec of PLANETS) {
    const radius = kmToUnits(spec.radiusKm);
    const group = new THREE.Group();
    const axis = new THREE.Group();
    axis.rotation.z = spec.tiltDeg * Math.PI / 180;
    let mat: THREE.MeshStandardMaterial;
    if (spec.key === 'earth') {
      mat = new THREE.MeshStandardMaterial({
        map: earthSet.map, bumpMap: earthSet.bump, bumpScale: 0.035,
        // 高度图兼作粗糙度图：海洋 0.3（出太阳镜面高光），陆地粗糙
        roughnessMap: earthSet.bump, roughness: 1.0, metalness: 0.05,
        emissiveMap: earthSet.lights, emissive: new THREE.Color(0xffc890), emissiveIntensity: 2.4,
        envMapIntensity: 0.16,
      });
    } else if (spec.key === 'mercury' || spec.key === 'mars' || spec.key === 'pluto') {
      mat = mkRockyMat(TEXROCK[spec.key]());
    } else if (spec.key === 'venus') {
      mat = new THREE.MeshStandardMaterial({
        map: bandsTexture(21, [0xd9b77e, 0xc9a05e, 0xe3c88f, 0xb98f52, 0xd9b77e], {}, 512),
        roughness: 0.85, envMapIntensity: 0.14,
      });
    } else if (spec.key === 'jupiter') {
      mat = new THREE.MeshStandardMaterial({
        map: bandsTexture(51, [0xe8d5b8, 0x7a5236, 0xf0e4cc, 0x8a5f3c, 0xe6d6b6, 0x6a4a34, 0xdcc8a6],
          { spot: '0.62,0.62,0.15,0.09', spotColor: 0xc1442e }, 1024),
        roughness: 0.8, envMapIntensity: 0.14,
      });
    } else if (spec.key === 'saturn') {
      mat = new THREE.MeshStandardMaterial({
        map: bandsTexture(61, [0xdcc69b, 0xba9c6c, 0xecdcb6, 0xc6a97c, 0xdcc69b], {}, 1024),
        roughness: 0.82, envMapIntensity: 0.14,
      });
    } else if (spec.key === 'uranus') {
      mat = new THREE.MeshStandardMaterial({
        map: bandsTexture(71, [0x9fd4d9, 0x8cc8cf, 0xace0e3, 0x93cdd3], {}, 512),
        roughness: 0.75, envMapIntensity: 0.16,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        map: bandsTexture(81, [0x3b66c4, 0x2d4fa8, 0x5478d2, 0x3558b8],
          { spot: '0.32,0.6,0.1,0.06', spotColor: 0x1e3a80 }, 512),
        roughness: 0.75, envMapIntensity: 0.16,
      });
    }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, SEG, SEG / 2), mat);
    axis.add(mesh);
    group.add(axis);
    scene.add(group);
    clickTargets.push(mesh);

    // 散射大气：向阳蓝亮、晨昏线橙红、背阳深蓝
    const atmoColor = spec.key === 'earth' ? 0x4f8fd9 : spec.key === 'venus' ? 0xd9c08a
      : spec.key === 'mars' ? 0xc07a5a : spec.key === 'jupiter' ? 0xc8a882
      : spec.key === 'saturn' ? 0xd9c9a5
      : spec.kind === 'ice' ? 0x86d0d8 : null;
    if (atmoColor) {
      const atmoMat = new THREE.ShaderMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
        uniforms: {
          uColor: { value: new THREE.Color(atmoColor) },
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWN; varying vec3 vWV;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWN = normalize(mat3(modelMatrix) * normal);
            vWV = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform vec3 uSunDir;
          varying vec3 vWN; varying vec3 vWV;
          void main() {
            float rim = pow(1.0 - abs(dot(normalize(vWN), normalize(vWV))), 1.7);
            float sun = dot(normalize(vWN), normalize(uSunDir)) * 0.5 + 0.5;
            vec3 day = uColor * 2.7;      // HDR：向阳侧大气喂给辉光
            vec3 night = uColor * 0.2;
            vec3 col = mix(night, day, smoothstep(0.08, 0.62, sun));
            // 晨昏线：更宽更亮的橙红散射带
            float term = 1.0 - abs(sun - 0.4) / 0.3;
            col += vec3(1.0, 0.38, 0.12) * clamp(term, 0.0, 1.0) * clamp(term, 0.0, 1.0) * 1.35;
            gl_FragColor = vec4(col, rim * 0.85);
          }
        `,
      });
      const atmo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.06, SEG, SEG / 2), atmoMat);
      atmo.name = 'atmo';
      axis.add(atmo);
    }

    // 行星光环 halo：轮廓外的主题色微光。远处也能看见目的地，
    // 深度测试让球体遮住正面、只在轮廓外发亮——像路标，不像肥皂泡。
    // 有环行星（土星/天王星）跳过：环本身就是它们的光环，叠加会糊
    const tint = BODY_TINT[spec.key];
    const hasRing = spec.key === 'saturn' || spec.key === 'uranus';
    if (tint !== undefined && !hasRing) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTextureRGB('rgba(255,255,255,0.5)', 'rgba(255,255,255,0.12)'),
        color: tint, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.11,
      }));
      halo.scale.setScalar(radius * 2.4);
      group.add(halo);
    }

    // 地球：云层 + 月球
    if (spec.key === 'earth') {
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.018, SEG, SEG / 2),
        new THREE.MeshStandardMaterial({
          map: cloudsTexture(131), transparent: true, roughness: 1, depthWrite: false,
          envMapIntensity: 0.4,
        }),
      );
      clouds.name = 'earthClouds';
      axis.add(clouds);
      const moonMesh = new THREE.Mesh(
        new THREE.SphereGeometry(kmToUnits(MOON.radiusKm), SEG, SEG / 2),
        mkRockyMat(moonSet),
      );
      moonMesh.name = 'moon';
      scene.add(moonMesh);
      clickTargets.push(moonMesh);
    }

    // 土星环 / 天王星环：自定义着色器，解析行星本影
    if (spec.key === 'saturn' || spec.key === 'uranus') {
      const inner = radius * (spec.key === 'saturn' ? 1.32 : 1.65);
      const outer = radius * (spec.key === 'saturn' ? 2.32 : 1.95);
      const ringGeo = new THREE.RingGeometry(inner, outer, 220, 1);
      const rmat = new THREE.ShaderMaterial({
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
        uniforms: {
          uMap: { value: ringTexture(spec.key === 'saturn' ? 151 : 161, spec.key === 'saturn' ? 0xd9c9a5 : 0x9fd2d8) },
          uSunLocal: { value: new THREE.Vector3(1, 0, 0) },
          uPlanetR: { value: radius * 1.02 },
          uInner: { value: inner },
          uOuter: { value: outer },
          uOpacity: { value: spec.key === 'saturn' ? 1 : 0.42 },
          uLight: { value: 1.15 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vPos;
          void main() {
            vPos = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uSunLocal;
          uniform float uPlanetR, uInner, uOuter, uOpacity, uLight;
          varying vec2 vPos;
          void main() {
            float r = length(vPos);
            float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
            vec4 tex = texture2D(uMap, vec2(t, 0.5));
            // 行星本影：环上该点朝太阳的射线是否穿过行星（软边）
            vec3 p = vec3(vPos, 0.0);
            vec3 s = normalize(uSunLocal);
            float tp = dot(p, s);
            float shadow = 1.0;
            if (tp > 0.0) {
              float d = length(p - s * tp);
              shadow = mix(0.1, 1.0, smoothstep(uPlanetR * 0.9, uPlanetR * 1.04, d));
            }
            // 临边背散射微增 × 太阳距离衰减（远处环不该自发光）
            float bright = (1.0 + 0.2 * abs(s.z)) * uLight;
            vec3 col = tex.rgb * shadow * bright;
            gl_FragColor = vec4(col, tex.a * uOpacity);
          }
        `,
      });
      const ring = new THREE.Mesh(ringGeo, rmat);
      ring.rotation.x = Math.PI / 2;
      ring.name = 'ring';
      axis.add(ring);
      ringMats.push({ mat: rmat, bodyKey: spec.key, mesh: ring });
    }

    bodies.push({ key: spec.key, group, axis, mesh, radius, pos: new THREE.Vector3() });
  }
  bodies.unshift({
    key: 'sun', group: sunGroup, axis: sunGroup, mesh: sunMesh, radius: SUN_SCENE_R, pos: new THREE.Vector3(0, 0, 0),
  });

  // ---- 轨道线：按行星主题色着色，太阳系的结构一眼可读 ----
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
      color: BODY_TINT[spec.key] ?? 0x8a94a8, transparent: true, opacity: 0.26,
      blending: THREE.AdditiveBlending,
    }));
    orbitGroup.add(line);
  }

  // ---- 小行星带：四种顶点位移圆润岩石，非均匀拉伸 + 逐实例颜色 ----
  const beltGroup = new THREE.Group();
  scene.add(beltGroup);
  {
    const N = hi ? 1500 : 700;
    const variants = 4;
    const per = Math.ceil(N / variants);
    const beltRng = rng(2026);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
    for (let v = 0; v < variants; v++) {
      const geo = displaceGeometry(
        new THREE.IcosahedronGeometry(1, hi ? 3 : 2),
        makeNoise(3000 + v * 17),
        0.55, 2.2 + v * 0.4,
      );
      const mat = new THREE.MeshStandardMaterial({
        color: 0x8a8078, roughness: 0.94, metalness: 0.04, envMapIntensity: 0.22,
        bumpMap: moonSet.bump, bumpScale: 0.4,
      });
      const inst = new THREE.InstancedMesh(geo, mat, per);
      const tint = new THREE.Color();
      let placed = 0;
      let guard = 0;
      while (placed < per && guard < per * 6) {
        guard++;
        const a = beltRng() * Math.PI * 2;
        // 聚簇结构：径向密度波 + 方位聚簇（消灭「撒芝麻」）
        let r = range(beltRng, auToScene(2.15), auToScene(3.35));
        r *= 1 + 0.1 * Math.sin(a * 3 + r * 0.12);
        // 柯克伍德空隙：与木星共振的轨道上没有石头
        const kirkwood = Math.abs(r - auToScene(2.5)) < 1.3 || Math.abs(r - auToScene(2.82)) < 1.1
          || Math.abs(r - auToScene(3.27)) < 0.8;
        if (kirkwood && beltRng() < 0.85) continue;
        const y = (beltRng() + beltRng() - 1) * (2.2 + 2 * Math.abs(Math.sin(a * 2)));
        e.set(beltRng() * Math.PI, beltRng() * Math.PI, beltRng() * Math.PI);
        q.setFromEuler(e);
        const base = 0.06 + Math.pow(beltRng(), 2.2) * 0.55;
        s.set(base * (0.7 + beltRng() * 0.7), base * (0.7 + beltRng() * 0.7), base * (0.7 + beltRng() * 0.7));
        m.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q, s);
        inst.setMatrixAt(placed, m);
        const warm = beltRng();
        tint.setRGB(0.5 + warm * 0.25, 0.44 + warm * 0.18, 0.38 + warm * 0.1);
        inst.setColorAt(placed, tint);
        placed++;
      }
      for (let i = placed; i < per; i++) {
        // 兜底：未填满的实例缩为零
        s.setScalar(0.0001);
        m.compose(new THREE.Vector3(0, 0, 0), q, s);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      beltGroup.add(inst);
    }

    // 柯伊伯带：逐粒颜色抖动的远尘环
    const KN = hi ? 2600 : 1200;
    const kpos = new Float32Array(KN * 3);
    const kcol = new Float32Array(KN * 3);
    for (let i = 0; i < KN; i++) {
      const a = beltRng() * Math.PI * 2;
      const r = range(beltRng, auToScene(32), auToScene(48));
      const y = (beltRng() + beltRng() - 1) * 26;
      kpos[i * 3] = Math.cos(a) * r; kpos[i * 3 + 1] = y; kpos[i * 3 + 2] = Math.sin(a) * r;
      const warm = beltRng();
      kcol[i * 3] = 0.42 + warm * 0.3;
      kcol[i * 3 + 1] = 0.46 + warm * 0.18;
      kcol[i * 3 + 2] = 0.6 - warm * 0.15;
    }
    const kgeo = new THREE.BufferGeometry();
    kgeo.setAttribute('position', new THREE.BufferAttribute(kpos, 3));
    kgeo.setAttribute('color', new THREE.BufferAttribute(kcol, 3));
    const kmat = new THREE.PointsMaterial({
      size: 0.55, transparent: true, opacity: 0.45, vertexColors: true,
      map: softDotTexture(),
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    scene.add(new THREE.Points(kgeo, kmat));
  }

  // ---- 彗星：高偏心掠日轨道 + 背阳粒子尾 ----
  // 轨道根数走真实开普勒求解（复用行星同一套代码），但驱动用
  // 「演出时钟」（elapsed × 6 模拟日/秒）：宇宙历停在 6时/秒 档时，
  // 彗星仍在天上缓缓赶路——它是这场漫游的演员，不是历法的一部分。
  const COMET_SPEC: BodySpec = {
    key: 'comet', name: '彗星', en: 'Comet', kind: 'dwarf',
    radiusKm: 4, rotationHours: 100, tiltDeg: 0,
    aAU: 2.4, e: 0.84, iDeg: 25, omDeg: 58, poDeg: 118, L0Deg: 118, // M0=0
    periodDays: Math.pow(2.4, 1.5) * 365.25,
    desc: '', facts: [],
  };
  const COMET_TAIL = hi ? 260 : 140;
  const cometGroup = new THREE.Group();
  scene.add(cometGroup);
  const cometNucleus = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xeaf6ff }),
  );
  cometGroup.add(cometNucleus);
  const cometComa = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTextureRGB('rgba(210,240,255,0.9)', 'rgba(90,180,200,0.25)'),
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85,
  }));
  cometGroup.add(cometComa);
  const cometGeo = new THREE.BufferGeometry();
  const cometPos = new Float32Array(COMET_TAIL * 3);
  const cometCol = new Float32Array(COMET_TAIL * 3);
  const cometJit: THREE.Vector3[] = [];
  {
    const cr = rng(777);
    for (let i = 0; i < COMET_TAIL; i++) {
      const j = new THREE.Vector3(cr() - 0.5, cr() - 0.5, cr() - 0.5).normalize()
        .multiplyScalar(0.25 + Math.pow(cr(), 1.6) * 0.75);
      cometJit.push(j);
      const s = i / COMET_TAIL;
      // 加性混合下颜色趋黑即透明：头白热 → 中段青蓝 → 尾熄灭
      const r = Math.max(0, 1.0 - s * 1.1), g = Math.max(0, 0.96 - s * 0.55), b = Math.max(0, 0.9 - s * 0.3);
      cometCol[i * 3] = r; cometCol[i * 3 + 1] = g; cometCol[i * 3 + 2] = b;
    }
  }
  cometGeo.setAttribute('position', new THREE.BufferAttribute(cometPos, 3));
  cometGeo.setAttribute('color', new THREE.BufferAttribute(cometCol, 3));
  const cometTail = new THREE.Points(cometGeo, new THREE.PointsMaterial({
    size: 0.62, vertexColors: true, transparent: true, opacity: 0.9,
    map: softDotTexture(),
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  cometTail.frustumCulled = false;
  scene.add(cometTail);
  const cometP = new THREE.Vector3();
  const cometAway = new THREE.Vector3();
  function updateComet(cometDays: number) {
    const c = eclipticToScene(heliocentricAU(COMET_SPEC, cometDays));
    cometP.set(c.x, c.y, c.z);
    cometNucleus.position.copy(cometP);
    const dSun = cometP.length();
    cometAway.copy(cometP).multiplyScalar(1 / Math.max(dSun, 1e-6));
    // 近日拉长、远日收束的尾巴
    const L = Math.min(30, Math.max(2, 430 / dSun));
    for (let i = 0; i < COMET_TAIL; i++) {
      const s = Math.pow(i / COMET_TAIL, 0.85);
      cometPos[i * 3] = cometP.x + cometAway.x * (s * L) + cometJit[i].x * (0.5 + s * 2.4);
      cometPos[i * 3 + 1] = cometP.y + cometAway.y * (s * L) + cometJit[i].y * (0.5 + s * 2.4);
      cometPos[i * 3 + 2] = cometP.z + cometAway.z * (s * L) + cometJit[i].z * (0.5 + s * 2.4);
    }
    cometGeo.attributes.position.needsUpdate = true;
    cometComa.scale.setScalar(1.2 + L * 0.18);
    cometComa.position.copy(cometP);
  }

  // ---- 宇宙尘：相机周围的包裹速度场 ----
  const DUST = hi ? 420 : 220;
  const DUST_R = 130;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST * 3; i++) dustPos[i] = (Math.random() - 0.5) * 2 * DUST_R;
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0x9aa8c0, size: 0.09, transparent: true, opacity: 0.32,
    map: softDotTexture(),
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  // ---- 曲速流光：高速航行时星流拉丝（与宇宙尘同一包裹逻辑） ----
  const WARP_N = hi ? 120 : 60;
  const WARP_R = 150;
  const warpGeo = new THREE.BufferGeometry();
  const warpPos = new Float32Array(WARP_N * 2 * 3);
  const warpAnchors: THREE.Vector3[] = [];
  for (let i = 0; i < WARP_N; i++) {
    warpAnchors.push(new THREE.Vector3(
      (Math.random() - 0.5) * 2 * WARP_R,
      (Math.random() - 0.5) * 2 * WARP_R,
      (Math.random() - 0.5) * 2 * WARP_R,
    ));
  }
  warpGeo.setAttribute('position', new THREE.BufferAttribute(warpPos, 3));
  const warpMat = new THREE.LineBasicMaterial({
    color: 0xa8c0ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const warp = new THREE.LineSegments(warpGeo, warpMat);
  warp.frustumCulled = false;
  scene.add(warp);
  const warpDir = new THREE.Vector3();
  const wrapAxis = (v: number, c: number) => {
    const d = v - c;
    if (d > WARP_R) return v - WARP_R * 2;
    if (d < -WARP_R) return v + WARP_R * 2;
    return v;
  };
  function updateWarp(sp: number) {
    const a = Math.max(0, Math.min(1, (sp - 150) / 480));
    warpMat.opacity = a * 0.5;
    if (a <= 0.01 || sp < 1) return;
    warpDir.copy(vel).multiplyScalar(1 / sp);
    const len = 1.5 + sp * 0.03;
    for (let i = 0; i < WARP_N; i++) {
      const p = warpAnchors[i];
      const x = wrapAxis(p.x, camera.position.x);
      const y = wrapAxis(p.y, camera.position.y);
      const z = wrapAxis(p.z, camera.position.z);
      p.set(x, y, z);
      warpPos[i * 6] = x; warpPos[i * 6 + 1] = y; warpPos[i * 6 + 2] = z;
      warpPos[i * 6 + 3] = x - warpDir.x * len;
      warpPos[i * 6 + 4] = y - warpDir.y * len;
      warpPos[i * 6 + 5] = z - warpDir.z * len;
    }
    warpGeo.attributes.position.needsUpdate = true;
  }

  // ---- 流星池（渐变尾迹） ----
  interface Meteor { line: THREE.Line; head: THREE.Sprite; vel: THREE.Vector3; life: number; total: number }
  const meteors: Meteor[] = [];
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
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const speed = big ? 130 : 70 + Math.random() * 50;
    const total = big ? 2.2 : 1.1 + Math.random() * 0.7;
    const geo = new THREE.BufferGeometry().setFromPoints([start, start]);
    // 顶点色渐变：头白热 → 尾熄灭（加性混合下即淡出）
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array([
      1.0, 0.95, 0.85,
      0.1, 0.05, 0.0,
    ]), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
    }));
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
      (mt.line.material as THREE.LineBasicMaterial).opacity = 0.95 * fade;
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

  // ---- 彩蛋（圆润建模版） ----
  const eggs: EggNode[] = [];
  function goldMat(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xd8b060, metalness: 0.92, roughness: 0.32,
      emissive: 0x6a4a10, emissiveIntensity: 0.35, envMapIntensity: 1.2,
    });
  }
  function makeEggModel(key: string): THREE.Group {
    const g = new THREE.Group();
    const lathe = (pts: [number, number][], seg = 40, mat: THREE.Material) =>
      new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat);
    if (key === 'voyager1') {
      // 抛物面天线 + 细桁架 + 三鞭天线 + RTG
      const dishPts: [number, number][] = [[0, 0]];
      for (let i = 1; i <= 12; i++) dishPts.push([Math.pow(i / 12, 2) * 1.15, (i / 12) * 0.34]);
      const dish = lathe(dishPts, 48, goldMat());
      dish.rotation.x = Math.PI;
      g.add(dish);
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.6, 12), goldMat());
      boom.rotation.z = Math.PI / 2;
      g.add(boom);
      for (let i = 0; i < 3; i++) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 2.4, 10), goldMat());
        ant.rotation.z = 0.9 - i * 0.45;
        ant.position.set(-1.5, 0.35, 0);
        g.add(ant);
      }
      const rtg = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 6, 14), goldMat());
      rtg.position.set(1.15, 0.55, 0);
      rtg.rotation.z = 0.5;
      g.add(rtg);
    } else if (key === 'record') {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.05, 64), goldMat());
      disc.rotation.x = Math.PI / 2;
      g.add(disc);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.028, 10, 64), goldMat());
      g.add(rim);
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.062, 40),
        new THREE.MeshStandardMaterial({ color: 0x2a3c66, roughness: 0.5, envMapIntensity: 0.8 }));
      label.rotation.x = Math.PI / 2;
      g.add(label);
    } else if (key === 'rose') {
      // 弯曲管状花茎 + 层叠花冠 + 玻璃罩
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.9, 0),
        new THREE.Vector3(0.12, -0.3, 0.06),
        new THREE.Vector3(-0.08, 0.3, -0.04),
        new THREE.Vector3(0.02, 0.85, 0),
      ]);
      const stem = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, 0.045, 10, false),
        new THREE.MeshStandardMaterial({ color: 0x3a6a34, roughness: 0.75, envMapIntensity: 0.3 }),
      );
      g.add(stem);
      const roseMat = new THREE.MeshStandardMaterial({
        color: 0xd12a44, roughness: 0.45, metalness: 0.05,
        emissive: 0x520a14, emissiveIntensity: 0.7, envMapIntensity: 0.5,
      });
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 2), roseMat);
      core.position.set(0.02, 0.95, 0);
      g.add(core);
      const petal = lathe([[0, 0], [0.16, 0.05], [0.34, 0.14], [0.42, 0.24], [0.3, 0.3], [0.1, 0.32]], 36, roseMat);
      petal.position.set(0.02, 0.92, 0);
      petal.scale.set(1, 1, 0.6);
      g.add(petal);
      const glass = new THREE.Mesh(new THREE.SphereGeometry(0.78, 28, 20),
        new THREE.MeshPhysicalMaterial({
          color: 0xbcd8e8, transparent: true, opacity: 0.16, roughness: 0.06,
          transmission: 0.6, thickness: 0.3, envMapIntensity: 1.0,
        }));
      glass.position.set(0.02, 0.85, 0);
      g.add(glass);
    } else if (key === 'clockhand') {
      const handMat = goldMat();
      for (let i = 0; i < 3; i++) {
        const len = 1.7 - i * 0.45;
        const hand = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.075, len, 12), handMat);
        hand.position.y = len / 2 - 0.1;
        hand.castShadow = false;
        const holder = new THREE.Group();
        holder.add(hand);
        holder.rotation.z = i * 2.2;
        g.add(holder);
      }
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), handMat);
      g.add(hub);
    } else {
      // bottle：流线瓶身 + 软木 + 卷纸
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x9ec8d8, transparent: true, opacity: 0.32, roughness: 0.08,
        transmission: 0.7, thickness: 0.25, envMapIntensity: 1.1,
      });
      const body = lathe([
        [0.001, -0.62], [0.3, -0.62], [0.34, -0.3], [0.34, 0.32], [0.26, 0.5], [0.15, 0.6], [0.13, 0.72],
      ], 48, glassMat);
      g.add(body);
      const cork = lathe([[0.001, 0.62], [0.12, 0.62], [0.13, 0.78], [0.11, 0.8], [0.001, 0.8]], 24,
        new THREE.MeshStandardMaterial({ color: 0xa8845c, roughness: 0.9, envMapIntensity: 0.25 }));
      g.add(cork);
      const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.72, 16),
        new THREE.MeshStandardMaterial({ color: 0xf0e8d8, roughness: 0.9, emissive: 0x50442a, emissiveIntensity: 0.3 }));
      paper.position.y = -0.06;
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
  const bodyLabels: { node: BodyNode; el: HTMLDivElement }[] = [];
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
      bodyLabels.push({ node: b, el });
    }
  }

  // ═══════════ 后期：辉光 → 光轴 → 色调映射 → 调色 ═══════════
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // 强辉光：阈值卡在大气/城市灯/日冕（>1.5）与行星昼面（~0.7）之间——
  // 发光体入光、实体表面保持纹理（这是「绚丽但不糊」的分界线）
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight).multiplyScalar(hi ? 0.75 : 0.55),
    0.8, 0.6, 0.52,
  );
  composer.addPass(bloom);

  // 太阳光轴（god-rays）：屏幕空间向太阳径向采样，靠近日时圣光盛放。
  // 在 HDR 缓冲上运行（色调映射之前），只有真正亮过阈值的光才能拉出轴
  const raysPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1.7 },
      uStrength: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAspect, uStrength;
      varying vec2 vUv;
      void main() {
        vec3 base = texture2D(tDiffuse, vUv).rgb;
        if (uStrength < 1e-3) { gl_FragColor = vec4(base, 1.0); return; }
        vec2 toSun = uSun - vUv;
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 24; i++) {
          float t = float(i) / 23.0;
          float decay = 1.0 - t * 0.92;
          acc += texture2D(tDiffuse, vUv + toSun * t).rgb * decay;
          wsum += decay;
        }
        vec3 rays = acc / wsum;
        float d = length((vUv - uSun) * vec2(uAspect, 1.0));
        float mask = exp(-d * 1.35);
        gl_FragColor = vec4(base + rays * mask * uStrength, 1.0);
      }
    `,
  });
  if (hi) composer.addPass(raysPass);
  composer.addPass(new OutputPass());

  // 调色：饱和/对比/冷暖分离（青影暖调）+ 高速色散 + 暗角 + 颗粒
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
        vec2 kick = d * uSpeed * 0.012;
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + kick).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - kick).b;
        // 影调三件套
        float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(luma), col, 1.22);                                        // 饱和度
        col = (col - 0.5) * 1.07 + 0.5;                                          // 对比度
        col += vec3(-0.012, 0.004, 0.028) * (1.0 - smoothstep(0.0, 0.55, luma)); // 阴影偏青
        col += vec3(0.028, 0.014, -0.010) * smoothstep(0.45, 1.0, luma);        // 高光偏暖
        col *= 1.0 - smoothstep(0.2, 0.65, r2) * 0.4;                            // 暗角
        col += (hash(vUv * 1731.0 + fract(uTime) * 7.7) - 0.5) * 0.03;          // 颗粒
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  composer.addPass(grade);
  let flash = 0; // 事件闪光：发现漂浮物 / 巡航到站 → 辉光瞬间盛放

  // ═══════════ 飞行控制 ═══════════
  const coarse = matchMedia('(pointer: coarse)').matches;
  let yaw = 0, pitch = 0;
  let speed = 26;
  const vel = new THREE.Vector3();
  const keys = new Set<string>();
  let boost = false;
  let autopilotKey: string | null = null;
  let autopilotArrived = false;

  const startDays = Date.now() / 86400000 - 10957.5;
  let simDays = startDays;
  let timeScaleIdx = 2;
  let elapsed = 0;

  // 初始位姿：地球半明半暗（强晨昏线 + 夜面灯可见），构图把地球放在一侧
  {
    const e = bodyScenePos(byKey('earth')!, startDays);
    const toSun = new THREE.Vector3(-e.x, -e.y, -e.z).normalize();
    const side = new THREE.Vector3().crossVectors(toSun, up).normalize();
    camera.position.set(
      e.x + toSun.x * 2.6 + side.x * 9.5,
      e.y + toSun.y * 2.6 + side.y * 9.5 + 2.8,
      e.z + toSun.z * 2.6 + side.z * 9.5,
    );
    // 视线偏向太阳一侧：广角下地球落在三分线，另一侧留给日光方向
    const look = new THREE.Vector3(
      e.x + toSun.x * 3.0, e.y + 0.4, e.z + toSun.z * 3.0,
    ).sub(camera.position).normalize();
    yaw = Math.atan2(-look.x, -look.z);
    pitch = Math.asin(Math.max(-0.99, Math.min(0.99, look.y)));
  }

  const applyCamera = () => {
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  };
  applyCamera();

  // ═══════════ 巡航模式：自动逐站漫游 ═══════════
  // 到站 → 环绕停留数秒 → 下一站。任意手动操作（按键/拖拽/另选目标）退出。
  const TOUR = ['moon', 'venus', 'mercury', 'sun', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'earth'];
  const tour = { on: false, key: TOUR[0], phase: 'cruise' as 'cruise' | 'hold', holdT: 0 };
  function resolveTarget(key: string): { pos: THREE.Vector3; r: number } | null {
    if (key === 'moon') {
      const m = scene.getObjectByName('moon') as THREE.Mesh | null;
      return m ? { pos: m.position, r: kmToUnits(MOON.radiusKm) } : null;
    }
    const b = bodies.find((bn) => bn.key === key);
    return b ? { pos: b.pos, r: b.radius } : null;
  }
  function tourGoto(key: string) {
    tour.key = key;
    tour.phase = 'cruise';
    tour.holdT = 0;
    autopilotKey = key;
    autopilotArrived = false;
    opts.onSelect?.(key);
  }
  function setTour(on: boolean) {
    tour.on = on;
    if (on) tourGoto(TOUR[0]);
  }
  function tourNext() {
    tourGoto(TOUR[(TOUR.indexOf(tour.key) + 1) % TOUR.length]);
  }

  function flyTo(key: string) {
    tour.on = false; // 用户另选目标：巡航让位
    autopilotKey = key;
    autopilotArrived = false;
    opts.onSelect?.(key);
  }
  function breakAutopilot() {
    tour.on = false; // 手动接管：巡航让位
    if (autopilotKey) { autopilotKey = null; opts.onSelect?.(null); }
  }

  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.closest('button, a, input, textarea')) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', 'c', ' ', 'shift', 't'].includes(k)) {
      if (k === ' ') e.preventDefault();
      keys.add(k);
      breakAutopilot();
    }
    if (k === 't' && !e.repeat) timeScaleIdx = (timeScaleIdx + 1) % TIME_SCALES.length;
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

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
    if (!sticks.some((s) => s.kind === 'move')) hideStick();
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
  const tmpV2 = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();

  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    elapsed += dt;
    simDays += dt * TIME_SCALES[timeScaleIdx];

    // ---- 行星位置 / 自转 / 大气与环的太阳方向 ----
    for (const b of bodies) {
      if (b.key === 'sun') { b.mesh.rotation.y = rotationAngle(609.12, simDays) * 0.02; continue; }
      const spec = byKey(b.key)!;
      const p = bodyScenePos(spec, simDays);
      b.pos.set(p.x, p.y, p.z);
      b.group.position.copy(b.pos);
      b.mesh.rotation.y = rotationAngle(spec.rotationHours, simDays) + (spinOffsets[b.key] ?? 0);
      const clouds = b.axis.getObjectByName('earthClouds');
      if (clouds) clouds.rotation.y = rotationAngle(28, simDays);
      const atmoMat = (b.axis.getObjectByName('atmo') as THREE.Mesh | undefined)?.material as THREE.ShaderMaterial | undefined;
      if (atmoMat) {
        atmoMat.uniforms.uSunDir.value.copy(b.pos).multiplyScalar(-1).normalize();
      }
    }
    // 月球
    const moonMesh = scene.getObjectByName('moon') as THREE.Mesh | null;
    if (moonMesh) {
      const e = bodies.find((b) => b.key === 'earth')!;
      const m = moonScenePos(simDays);
      moonMesh.position.set(e.pos.x + m.x, e.pos.y + m.y, e.pos.z + m.z);
      moonMesh.rotation.y = -Math.atan2(m.z, m.x);
    }
    // 环的局部太阳方向（供本影计算）+ 太阳距离调光
    for (const rm of ringMats) {
      const b = bodies.find((bn) => bn.key === rm.bodyKey)!;
      rm.mesh.getWorldQuaternion(tmpQ);
      tmpV.copy(b.pos).multiplyScalar(-1).normalize().applyQuaternion(tmpQ.clone().invert());
      rm.mat.uniforms.uSunLocal.value.copy(tmpV);
      rm.mat.uniforms.uLight.value = Math.min(230 / Math.max(b.pos.length(), 1), 1.0);
    }
    beltGroup.rotation.y = (simDays / 1622) * Math.PI * 2;

    // ---- 摇杆 → 移动向量 ----
    let fwd = 0, side = 0, lift = 0;
    const moveStick = sticks.find((s) => s.kind === 'move');
    if (moveStick) {
      const dx = moveStick.x - moveStick.sx;
      const dy = moveStick.y - moveStick.sy;
      const c = joystickClamp(dx / 56, -dy / 56);
      side = c.x;
      fwd = -c.y;
      if (stickKnob) {
        const mm = Math.min(1, Math.hypot(dx, dy) / 56);
        const ang = Math.atan2(dy, dx);
        stickKnob.style.transform = `translate(calc(-50% + ${Math.cos(ang) * mm * 34}px), calc(-50% + ${Math.sin(ang) * mm * 34}px))`;
      }
    }
    if (keys.has('w')) fwd += 1;
    if (keys.has('s')) fwd -= 1;
    if (keys.has('d')) side += 1;
    if (keys.has('a')) side -= 1;
    if (keys.has(' ') || keys.has('e') || keys.has('q')) lift += 1;
    if (keys.has('c')) lift -= 1;
    boost = keys.has('shift');

    // ---- 自动导航 / 巡航环绕 ----
    if (autopilotKey) {
      const tgt = resolveTarget(autopilotKey);
      if (!tgt) { autopilotKey = null; }
      else {
        const dist = camera.position.distanceTo(tgt.pos);
        // 广角 67° 下稍近一点，主体占屏不缩水
        const want = approachDist(tgt.r) * 0.88;
        tmpV.copy(camera.position).sub(tgt.pos).normalize().multiplyScalar(want).add(tgt.pos);
        camera.position.lerp(tmpV, Math.min(dt * 1.35, 1));
        vel.multiplyScalar(Math.pow(0.02, dt));
        const mtx = new THREE.Matrix4().lookAt(camera.position, tgt.pos, up);
        tmpQ.setFromRotationMatrix(mtx);
        camera.quaternion.slerp(tmpQ, Math.min(dt * 2.4, 1));
        const eu = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        yaw = eu.y; pitch = eu.x;
        if (dist < want * 1.25) autopilotArrived = true;
        if (autopilotArrived && dist < want * 1.02) autopilotKey = null;
      }
    } else if (tour.on) {
      // 到站瞬间转入环绕；环绕即「呼吸位」——绕目标缓缓公转，始终看向它
      if (tour.phase === 'cruise') {
        tour.phase = 'hold';
        tour.holdT = 0;
        flash = Math.max(flash, 0.55); // 到站：辉光轻盛放一下
      }
      tour.holdT += dt;
      const tgt = resolveTarget(tour.key);
      if (tgt) {
        tmpV.copy(camera.position).sub(tgt.pos);
        tmpV.applyAxisAngle(up, dt * 0.14);
        camera.position.copy(tgt.pos).add(tmpV);
        const mtx = new THREE.Matrix4().lookAt(camera.position, tgt.pos, up);
        tmpQ.setFromRotationMatrix(mtx);
        camera.quaternion.slerp(tmpQ, Math.min(dt * 3, 1));
        const eu = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        yaw = eu.y; pitch = eu.x;
      }
      vel.multiplyScalar(Math.pow(0.02, dt));
      if (tour.holdT > 7) tourNext();
    } else {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const u2 = up.clone().applyQuaternion(camera.quaternion);
      tmpV.set(0, 0, 0)
        .addScaledVector(f, fwd)
        .addScaledVector(r, side)
        .addScaledVector(u2, lift);
      if (tmpV.lengthSq() > 1e-6) tmpV.normalize().multiplyScalar(speed * (boost ? 4 : 1));
      vel.lerp(tmpV, Math.min(dt * 3.2, 1));
      camera.position.addScaledVector(vel, dt);
      applyCamera();
    }

    const sp = vel.length();
    const targetFov = 67 + Math.min(sp / 1600, 1) * 9 + (boost ? 3 : 0);
    camera.fov += (targetFov - camera.fov) * Math.min(dt * 4, 1);
    camera.updateProjectionMatrix();

    // ---- 宇宙尘包裹 ----
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
      dustMat.opacity = 0.1 + Math.min(sp / 500, 1) * 0.35;
    }

    // ---- 太阳动画 ----
    sunMat.uniforms.uTime.value = t;
    corona.material.opacity = 0.85 + 0.08 * Math.sin(t * 0.7);

    // ---- 流星 / 彩蛋 ----
    updateMeteors(dt);
    for (const egg of eggs) {
      egg.group.rotation.y += dt * 0.3;
      egg.group.rotation.x += dt * 0.12;
      const d = camera.position.distanceTo(egg.pos);
      if (!egg.found && d < 10) {
        egg.found = true;
        foundEggs.push(egg.key);
        flash = Math.max(flash, 1); // 发现：辉光盛放
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
      for (const bl of bodyLabels) project(bl.node.pos, bl.el, bl.node.radius * 4.5, 1600);
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

    // ---- 彗星 / 曲速流光 ----
    updateComet(elapsed * 6); // 演出时钟：6 模拟日/秒，独立于宇宙历
    updateWarp(sp);

    // ---- 后期：动态辉光 + 太阳光轴 ----
    grade.uniforms.uTime.value = t;
    grade.uniforms.uSpeed.value = Math.min(sp / 900, 1);
    flash *= Math.pow(0.22, dt);
    const distSun = camera.position.length(); // 太阳在原点
    bloom.strength = 0.75
      + Math.min(70 / Math.max(distSun, 10), 1) * 0.45 // 靠近太阳：辉光盛放
      + Math.min(sp / 1500, 1) * 0.3                   // 高速航行：光晕拉丝
      + flash * 1.5;                                   // 事件闪光（发现/到站）
    {
      const fwd = tmpV.set(0, 0, -1).applyQuaternion(camera.quaternion);
      const toSun = tmpV2.copy(camera.position).multiplyScalar(-1);
      let strength = 0;
      if (toSun.dot(fwd) > 0) {
        const ndc = toSun.project(camera);
        const ex = Math.max(0, Math.min(1, (1.6 - Math.abs(ndc.x)) / 0.6));
        const ey = Math.max(0, Math.min(1, (1.6 - Math.abs(ndc.y)) / 0.6));
        strength = 0.34 * ex * ey * (0.3 + Math.min(70 / Math.max(distSun, 10), 1) * 0.8);
        raysPass.uniforms.uSun.value.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
        raysPass.uniforms.uAspect.value = (canvas.clientWidth || innerWidth) / (canvas.clientHeight || innerHeight);
      }
      raysPass.uniforms.uStrength.value = strength;
    }
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
      tour: tour.on,
    });
  }

  // ---- 调试参数（无头验证用） ----
  const q = new URLSearchParams(location.search);
  const spinOffsets: Record<string, number> = {};
  if (q.has('at')) {
    const k = q.get('at')!;
    let tp: { x: number; y: number; z: number } | null = null;
    let tr = SUN_SCENE_R;
    if (k === 'belt') {
      // 小行星带内部：沿切线望去看岩石细节
      const a = 0.9;
      const r = auToScene(2.7);
      camera.position.set(Math.cos(a) * r, 2.5, Math.sin(a) * r);
      const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const look = tangent.add(new THREE.Vector3(0.3, -0.12, 0)).normalize();
      yaw = Math.atan2(-look.x, -look.z);
      pitch = Math.asin(look.y);
      applyCamera();
    } else if (k === 'moon') {
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
      const view = Math.max(tr * 5.2, 8);
      const d = Math.hypot(tp.x, tp.y, tp.z);
      let dir: THREE.Vector3;
      if (d < 1e-3) {
        dir = new THREE.Vector3(0.7, 0.25, 0.67).normalize();
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
        const alpha = 0.62 * Math.PI * 2;
        const local = new THREE.Vector3(-Math.cos(alpha), 0, Math.sin(alpha));
        const alphaV = Math.atan2(local.z, local.x);
        const beta = Math.atan2(camDir.z, camDir.x);
        spinOffsets[k] = alphaV - beta - rotationAngle(spec.rotationHours, simDays);
      }
    }
  }
  if (q.has('eggs')) {
    for (const egg of eggs) { if (!egg.found) egg.label?.classList.add('reveal'); }
  }
  if (q.has('tour')) setTour(true); // 无头验证巡航模式
  // 渲染取证开关：逐层隔离洗白天空的元凶
  if (q.has('nosky')) sky.visible = false;
  if (q.has('nobloom')) bloom.enabled = false;
  if (q.has('norays')) raysPass.enabled = false;
  if (q.has('nodust')) dust.visible = false;
  if (q.has('nocorona')) { corona.visible = false; sunFlare.visible = false; }
  if (q.has('noatmo')) {
    scene.traverse((o) => { if (o.name === 'atmo') (o as THREE.Mesh).visible = false; });
  }
  if (q.has('nopost')) {
    // 绕过整个后期链：直接 renderer.render
    composer.render = () => renderer.render(scene, camera);
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
    setTour,
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
