/**
 * 《深林》场景 — 第一人称森林漫步（光影优先，细节不计成本）
 *
 * 分层：
 *   天空穹顶（时段驱动）· 地形（CPU 顶点色 + 树影斑驳注入）
 *   · 河/池/瀑（水面着色器 + 瀑布丝带 + 喷雾）· 植被（三树种/草/蕨/花/菌）
 *   · 大气（光轴/花粉/萤火/蝴蝶/蜻蜓/落叶）· 后期（辉光/光轴/FXAA/调色）
 *
 * 时段 day∈[0,1]：0 晨 → 0.55 金午后（默认）→ 1 暮（星与萤火）
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  rng, range, smoothstep, clamp01, makeNoise2,
  riverPoint, riverInfo, riverWidth, terrainHeight, slopeAt, moistureAt, waterLevelAt, scatter,
  WORLD_R, TERRAIN_SIZE, DISCOVERIES,
} from './forest-core';

export interface ForestTick {
  day: number;          // 时段 0..1
  atWater: number;      // 0..1 离水程度（音景用）
  nearFalls: number;    // 0..1 瀑布邻近
  found: number;
  total: number;
  wading: boolean;
  speed: number;
}

export interface ForestEvents {
  onTick?(t: ForestTick): void;
  onReady?(): void;
  onDiscover?(key: string, name: string, line: string): void;
  onEvent?(text: string): void;
}

/** 画面调节（滑杆实时，持久化在页面侧） */
export interface ForestBeauty {
  day: number;     // 时段（重算光照与天空）
  bloom: number;   // 辉光
  wind: number;    // 风力
  grass: number;   // 草密度（0..1 → 实例数比例）
  firefly: number; // 萤火数量（0..1）
}

// ═══════════════════════════════════════════════════════════════
// 程序化贴图（零素材）
// ═══════════════════════════════════════════════════════════════
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 平铺噪声贴图（水面扰动 / 斑驳底纹） */
function noiseTexture(seed: number, S = 256): THREE.Texture {
  const n = makeNoise2(seed);
  return canvasTex(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = n.fbm(x / S * 6, y / S * 6, 5) * 0.7 + n.fbm(x / S * 18, y / S * 18, 3) * 0.3;
        const o = (y * S + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v * 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }, false).clone() as THREE.Texture;
}

/** 树冠斑驳贴图：叶团状明暗（投影为林间光斑） */
function dappleTexture(): THREE.Texture {
  const S = 256;
  const n = makeNoise2(881);
  const t = canvasTex(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S * 8, v = y / S * 8; // 平铺：整周期采样
        const blob = n.fbm(u, v, 4);
        const o = (y * S + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.max(0, (blob - 0.42) * 2.2) * 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 单叶贴图（阔叶树冠的叶片精灵） */
function leafTexture(tint: string): THREE.Texture {
  return canvasTex(64, 64, (g) => {
    g.translate(32, 32);
    g.fillStyle = tint;
    for (let i = 0; i < 5; i++) {
      g.save();
      g.rotate((i / 5) * Math.PI * 2);
      g.beginPath();
      g.ellipse(0, -14, 7, 15, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.fillStyle = 'rgba(255,240,200,0.9)';
    g.beginPath();
    g.arc(0, 0, 5, 0, Math.PI * 2);
    g.fill();
  });
}

/** 花贴图（五瓣，两色） */
function flowerTexture(petal: string, core: string): THREE.Texture {
  return canvasTex(64, 64, (g) => {
    g.translate(32, 32);
    g.fillStyle = petal;
    for (let i = 0; i < 6; i++) {
      g.save();
      g.rotate((i / 6) * Math.PI * 2);
      g.beginPath();
      g.ellipse(0, -13, 8, 13, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.fillStyle = core;
    g.beginPath();
    g.arc(0, 0, 6, 0, Math.PI * 2);
    g.fill();
  });
}

/** 白桦树皮：白底 + 横向黑斑 */
function birchTexture(): THREE.Texture {
  const S = 128;
  const r = rng(4242);
  return canvasTex(S, S * 2, (g) => {
    g.fillStyle = '#e8e6dc';
    g.fillRect(0, 0, S, S * 2);
    for (let i = 0; i < 46; i++) {
      const y = r() * S * 2;
      const w = 8 + r() * 26;
      g.fillStyle = `rgba(30,26,22,${0.5 + r() * 0.4})`;
      g.fillRect(r() * (S - w), y, w, 2 + r() * 4);
    }
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(120,110,96,0.25)`;
      g.fillRect(0, r() * S * 2, S, 1);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// 时段参数（一切光的总谱）
// ═══════════════════════════════════════════════════════════════
interface DayLook {
  elevDeg: number;
  sunCol: THREE.Color;
  sunInt: number;
  skyTop: THREE.Color;
  skyMid: THREE.Color;
  skyBot: THREE.Color;
  hemiSky: THREE.Color;
  hemiInt: number;
  fogCol: THREE.Color;
  fogD: number;
  star: number;
  name: string;
}
function dayLook(day: number): DayLook {
  const k = (a: number, b: number, c: number) => {
    if (day < 0.5) return a + (b - a) * (day / 0.5);
    return b + (c - b) * ((day - 0.5) / 0.5);
  };
  return {
    elevDeg: k(24, 13, 3.5),
    sunCol: new THREE.Color('#fff2dd').lerp(new THREE.Color('#ffb168'), k(0, 0.55, 1)).lerp(new THREE.Color('#ff8a4d'), Math.max(0, k(0, 0.2, 1))),
    sunInt: k(3.0, 2.7, 1.5),
    skyTop: new THREE.Color('#7fb2e8').lerp(new THREE.Color('#5f86c8'), k(0, 0.6, 1)).lerp(new THREE.Color('#2c3a6e'), Math.max(0, k(0, 0.25, 1))),
    skyMid: new THREE.Color('#cfe3f2').lerp(new THREE.Color('#ffd9a8'), k(0, 0.65, 1)).lerp(new THREE.Color('#5c3a4a'), Math.max(0, k(0, 0.35, 1))),
    skyBot: new THREE.Color('#eef3ea').lerp(new THREE.Color('#ffc98a'), k(0, 0.6, 1)).lerp(new THREE.Color('#42303c'), Math.max(0, k(0, 0.4, 1))),
    hemiSky: new THREE.Color('#bcd4f0').lerp(new THREE.Color('#ffd0a0'), k(0, 0.7, 1)),
    hemiInt: k(0.75, 0.6, 0.42),
    fogCol: new THREE.Color('#dfe8e4').lerp(new THREE.Color('#f4d2a4'), k(0, 0.62, 1)).lerp(new THREE.Color('#463756'), Math.max(0, k(0, 0.4, 1))),
    fogD: k(0.0055, 0.0068, 0.0085),
    star: smoothstep(0.8, 1.0, day),
    name: '',
  };
}

// ═══════════════════════════════════════════════════════════════
// 场景
// ═══════════════════════════════════════════════════════════════
export function createForest(canvas: HTMLCanvasElement, opts: ForestEvents = {}) {
  const quality = (matchMedia('(pointer: coarse)').matches || innerWidth < 720) ? 'low' : 'high';
  const hi = quality === 'high';
  const coarse = matchMedia('(pointer: coarse)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setClearColor(0x9db8c8, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const DPR = Math.min(devicePixelRatio || 1, hi ? 2 : 1.6);
  renderer.setPixelRatio(DPR);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xdfe8e4, 0.006);

  const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 480);
  const up = new THREE.Vector3(0, 1, 0);

  // ---- 美观参数（页面滑杆写这里） ----
  const beauty: ForestBeauty = { day: 0.55, bloom: 1, wind: 1, grass: 1, firefly: 1 };

  // ---- 共享 uniforms ----
  const windTimeU = { value: 0 };
  const windStrengthU = { value: 1 };
  const dappleTex = dappleTexture();
  const dappleOffU = { value: new THREE.Vector2() };

  // ---- 天空穹顶：时段驱动的三段渐变 + 太阳辉 + 星 ----
  const skyU = {
    uTop: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uBot: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(1, 0.4, 0.3) },
    uSunCol: { value: new THREE.Color() },
    uStar: { value: 0 },
    uGlow: { value: 1 },
    uTime: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(420, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: skyU,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uMid, uBot, uSunCol, uSunDir;
        uniform float uStar, uGlow, uTime;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float h = clamp(vDir.y, -0.1, 1.0);
          vec3 col = mix(uBot, uMid, smoothstep(0.0, 0.24, h));
          col = mix(col, uTop, smoothstep(0.18, 0.75, h));
          // 太阳与近午辉（暮色衰减，不许把半个天际洗白）
          float d = max(dot(vDir, normalize(uSunDir)), 0.0);
          col += uSunCol * (pow(d, 700.0) * 2.2 + pow(d, 18.0) * 0.20) * uGlow;
          // 暮色星野
          if (uStar > 0.001 && vDir.y > 0.02) {
            vec2 sp = vDir.xz / (vDir.y + 0.35) * 34.0;
            float s = step(0.9965, hash(floor(sp)));
            float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(sp) + 7.0) * 40.0);
            col += vec3(0.9, 0.95, 1.0) * s * tw * uStar * smoothstep(0.02, 0.3, vDir.y);
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  scene.add(sky);

  // ---- 灯光 ----
  const hemi = new THREE.HemisphereLight(0xbcd4f0, 0x35422e, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  const SH = 52; // 阴影盒半径（跟随玩家）
  sun.shadow.camera.left = -SH;
  sun.shadow.camera.right = SH;
  sun.shadow.camera.top = SH;
  sun.shadow.camera.bottom = -SH;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.028;
  scene.add(sun);
  scene.add(sun.target);

  // ═════════════════════ 地形 ═════════════════════
  // CPU 顶点色泼溅（草/土/岩/湿岸），MeshStandard 吃阴影；
  // onBeforeCompile 注入「树影斑驳」——叶隙光斑随时间缓缓漂移
  const T_SEG = hi ? 240 : 150;
  const terrGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, T_SEG, T_SEG);
  terrGeo.rotateX(-Math.PI / 2);
  {
    const pos = terrGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cGrassA = new THREE.Color('#4a6b35');
    const cGrassB = new THREE.Color('#66823f');
    const cGrassDry = new THREE.Color('#8a8a4e');
    const cDirt = new THREE.Color('#6b5539');
    const cRock = new THREE.Color('#7c7a72');
    const cRockWet = new THREE.Color('#4d5049');
    const cMoss = new THREE.Color('#3f5c33');
    const cSand = new THREE.Color('#9a8f6e');
    const col = new THREE.Color();
    const splatN = makeNoise2(777);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const sl = slopeAt(x, z);
      const { d, t } = riverInfo(x, z);
      const w = riverWidth(t);
      const wet = smoothstep(w + 6.5, w + 0.5, d);       // 1 = 岸边
      const inWater = smoothstep(w + 0.4, w - 1.2, d);   // 水下
      const moss = splatN.fbm(x * 0.05 + 3, z * 0.05, 3);
      // 草地基色：深浅 + 干燥斑块
      col.copy(cGrassA).lerp(cGrassB, splatN.fbm(x * 0.03, z * 0.03, 4));
      col.lerp(cGrassDry, smoothstep(0.62, 0.8, splatN.fbm(x * 0.012 + 9, z * 0.012, 3)) * 0.7);
      col.lerp(cMoss, smoothstep(0.55, 0.75, moss) * 0.55);
      // 坡度 → 岩石；湿岩变暗
      col.lerp(cRock, smoothstep(0.5, 0.78, sl));
      col.lerp(cRockWet, wet * 0.75);
      // 岸线沙土
      col.lerp(cSand, wet * (1 - inWater) * 0.5);
      // 水下河床变深色
      col.lerp(new THREE.Color('#3d4436'), inWater * 0.8);
      // 微观噪声明暗（打破大色块）
      const micro = 0.86 + 0.28 * splatN.fbm(x * 0.35, z * 0.35, 2);
      colors[i * 3] = col.r * micro;
      colors[i * 3 + 1] = col.g * micro;
      colors[i * 3 + 2] = col.b * micro;
    }
    terrGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrGeo.computeVertexNormals();
  }
  const terrMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0 });
  terrMat.onBeforeCompile = (shader) => {
    shader.uniforms.uDapple = { value: dappleTex };
    shader.uniforms.uDappleOff = dappleOffU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nuniform sampler2D uDapple;\nuniform vec2 uDappleOff;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float dap = texture2D(uDapple, vWp.xz * 0.055 + uDappleOff).r;
          diffuseColor.rgb *= 0.62 + 0.38 * dap; // 林间叶隙光斑
        }`);
  };
  const terrain = new THREE.Mesh(terrGeo, terrMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ═════════════════════ 玩家（第一人称行走） ═════════════════════
  const EYE = 1.65;
  const player = {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    onGround: true,
    bobT: 0,
    wading: false,
  };
  // 出生点：河西草甸，望向瀑布与太阳
  {
    const rp = riverPoint(0.3);
    const rq = riverPoint(0.32);
    let nx = -(rq.z - rp.z), nz = rq.x - rp.x;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    if (nz < 0) { nx = -nx; nz = -nz; }
    player.pos.set(rp.x + nx * 8.5, 0, rp.z + nz * 8.5);
    player.pos.y = terrainHeight(player.pos.x, player.pos.z) + EYE;
    player.yaw = -Math.PI / 2 + 0.18; // 朝 +X（瀑布与太阳方向）
  }
  const keys = new Set<string>();
  let boost = false;
  const sticks: { id: number; kind: 'move' | 'look'; sx: number; sy: number; x: number; y: number }[] = [];
  let mouseDrag: { id: number; x: number; y: number } | null = null;
  let moved = 0;
  let lastTapT = 0, lastTapX = 0, lastTapY = 0;
  const pinchIds = new Set<number>();
  let pinchDist = 0;
  let locked = false;

  const applyLook = () => {
    camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  };
  applyLook();

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) opts.onEvent?.('已暂停 · 点击画面继续');
  });
  canvas.addEventListener('click', () => {
    if (!coarse && !locked) void canvas.requestPointerLock?.();
  });
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.closest('button, a, input, textarea')) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      if (k === ' ') e.preventDefault();
      keys.add(k);
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    moved = 0;
    if (e.pointerType === 'touch') {
      const isLeft = e.clientX < innerWidth * 0.44;
      sticks.push({ id: e.pointerId, kind: isLeft ? 'move' : 'look', sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY });
      if (isLeft) showStick('move', e.clientX, e.clientY);
      else showStick('look', e.clientX, e.clientY);
      if (!isLeft) {
        pinchIds.add(e.pointerId);
        if (pinchIds.size === 2) {
          const pts = sticks.filter((s) => pinchIds.has(s.id));
          if (pts.length === 2) pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        }
      }
    } else if (locked) {
      mouseDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      const st = sticks.find((s) => s.id === e.pointerId);
      if (!st) return;
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      st.x = e.clientX; st.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (pinchIds.size === 2 && pinchIds.has(e.pointerId)) {
        const pts = sticks.filter((s) => pinchIds.has(s.id));
        if (pts.length === 2) {
          const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (pinchDist > 0 && d > 0) walkSpeed = Math.max(1.4, Math.min(11, walkSpeed * Math.pow(d / pinchDist, 1.2)));
          pinchDist = d;
        }
      } else if (st.kind === 'look') {
        player.yaw -= dx * 0.0034;
        player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch - dy * 0.0034));
        applyLook();
      }
      return;
    }
    if (locked) {
      // 指针锁定：相对移动即视角
      player.yaw -= e.movementX * 0.0023;
      player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch - e.movementY * 0.0023));
      applyLook();
    } else if (mouseDrag && e.pointerId === mouseDrag.id) {
      const dx = e.clientX - mouseDrag.x;
      const dy = e.clientY - mouseDrag.y;
      mouseDrag.x = e.clientX; mouseDrag.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      player.yaw -= dx * 0.0032;
      player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch - dy * 0.0032));
      applyLook();
    }
  });
  const endPointer = (e: PointerEvent) => {
    const stIdx = sticks.findIndex((s) => s.id === e.pointerId);
    const wasKind = stIdx >= 0 ? sticks[stIdx].kind : null;
    if (stIdx >= 0) sticks.splice(stIdx, 1);
    if (wasKind) hideStick(wasKind);
    pinchIds.delete(e.pointerId);
    if (pinchIds.size < 2) pinchDist = 0;
    if (mouseDrag && e.pointerId === mouseDrag.id) mouseDrag = null;
    if (wasKind && moved < 6) {
      const now = performance.now();
      const isDouble = now - lastTapT < 320 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 48;
      lastTapT = now; lastTapX = e.clientX; lastTapY = e.clientY;
      if (isDouble) tryJump(); // 双击起跳（触屏直觉）
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  let walkSpeed = 3.2;
  function tryJump() {
    if (player.onGround) {
      player.vel.y = 5.0;
      player.onGround = false;
    }
  }

  // 双色摇杆 UI（与《宇宙漫游》同款交互语言）
  const stickEls: Record<'move' | 'look', HTMLDivElement | null> = { move: null, look: null };
  function showStick(kind: 'move' | 'look', x: number, y: number) {
    if (!stickEls[kind]) {
      const el = document.createElement('div');
      el.id = 'forest-stick';
      el.className = kind;
      el.innerHTML = '<div class="knob"></div>';
      document.body.appendChild(el);
      stickEls[kind] = el;
    }
    const el = stickEls[kind]!;
    el.style.display = 'block';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
  function hideStick(kind: 'move' | 'look') {
    const el = stickEls[kind];
    if (el) {
      el.style.display = 'none';
      (el.querySelector('.knob') as HTMLElement).style.transform = 'translate(-50%, -50%)';
    }
  }

  function updatePlayer(dt: number) {
    // 输入合成
    let fwd = 0, side = 0;
    if (keys.has('w') || keys.has('arrowup')) fwd += 1;
    if (keys.has('s') || keys.has('arrowdown')) fwd -= 1;
    if (keys.has('d') || keys.has('arrowright')) side += 1;
    if (keys.has('a') || keys.has('arrowleft')) side -= 1;
    const moveStick = sticks.find((s) => s.kind === 'move');
    if (moveStick) {
      const dx = moveStick.x - moveStick.sx;
      const dy = moveStick.y - moveStick.sy;
      const m = Math.hypot(dx, dy);
      if (m > 6) {
        const c = Math.min(1, m / 52);
        side = (dx / m) * c;
        fwd = (-dy / m) * c;
      }
      const knob = stickEls.move?.querySelector('.knob') as HTMLElement | null;
      if (knob) {
        const mm = Math.min(1, m / 52);
        knob.style.transform = `translate(calc(-50% + ${(dx / (m || 1)) * mm * 26}px), calc(-50% + ${(dy / (m || 1)) * mm * 26}px))`;
      }
    }
    boost = keys.has('shift');
    const f = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const r = new THREE.Vector3().crossVectors(up, f).normalize();
    const wish = new THREE.Vector3().addScaledVector(f, fwd).addScaledVector(r, side);
    const moving = wish.lengthSq() > 1e-4;
    if (moving) wish.normalize();

    // 涉水减速 + 岸坡减速
    const gh = terrainHeight(player.pos.x, player.pos.z);
    const { d: rd, t: rt } = riverInfo(player.pos.x, player.pos.z);
    const wl = waterLevelAt(player.pos.x, player.pos.z);
    const wadingNow = Number.isFinite(wl) && wl > gh - 0.05 && wl < gh + EYE;
    player.wading = wadingNow;
    let speed = walkSpeed * (boost ? 2.1 : 1);
    if (wadingNow) speed *= 0.55;
    speed *= 1 - 0.45 * slopeAt(player.pos.x, player.pos.z);

    // 水平速度（平滑）
    const target = wish.multiplyScalar(moving ? speed : 0);
    player.vel.x += (target.x - player.vel.x) * Math.min(dt * 9, 1);
    player.vel.z += (target.z - player.vel.z) * Math.min(dt * 9, 1);

    // 重力 & 跳
    if (keys.has(' ') && player.onGround) tryJump();
    player.vel.y -= 13.5 * dt;

    player.pos.x += player.vel.x * dt;
    player.pos.z += player.vel.z * dt;
    player.pos.y += player.vel.y * dt;

    // 软边界：往外推回
    const distC = Math.hypot(player.pos.x, player.pos.z);
    if (distC > WORLD_R) {
      const s = WORLD_R / distC;
      player.pos.x *= s; player.pos.z *= s;
    }

    // 地形碰撞（眼睛高度贴地）+ 涉水托底
    const ground = terrainHeight(player.pos.x, player.pos.z) + EYE;
    const floor = wadingNow ? Math.max(ground, wl + 1.15) : ground;
    if (player.pos.y <= floor) {
      player.pos.y = floor;
      player.vel.y = 0;
      player.onGround = true;
    }
    // 头部上下浮动（步行呼吸感）
    const sp = Math.hypot(player.vel.x, player.vel.z);
    player.bobT += dt * (4 + sp * 1.6);
    const bob = player.onGround ? Math.sin(player.bobT) * 0.035 * Math.min(sp / 3, 1) : 0;
    camera.position.set(player.pos.x, player.pos.y + bob, player.pos.z);

    // FOV 随奔跑轻微拉伸
    const tf = 72 + (boost && sp > 3 ? 5 : 0);
    camera.fov += (tf - camera.fov) * Math.min(dt * 5, 1);
    camera.updateProjectionMatrix();
  }

  // ═════════════════════ 水系 ═════════════════════
  const noiseTex = noiseTexture(515);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  const waterU = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(1, 0.4, 0.3) },
    uSunCol: { value: new THREE.Color('#ffe6c0') },
    uSkyCol: { value: new THREE.Color('#bcd4f0') },
    uNoise: { value: noiseTex },
  };
  // 河面：沿河线挤出的丝带（崖段自动成为瀑布立面）
  const waterMesh = (() => {
    const STEPS = 180;
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const p = riverPoint(t);
      const q = riverPoint(Math.min(1, t + 0.008));
      let nx = -(q.z - p.z), nz = q.x - p.x;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      const w = riverWidth(t) + 1.1;
      const y = riverBedY(t) + 1.15;
      pos.push(p.x + nx * w, y, p.z + nz * w, p.x - nx * w, y, p.z - nz * w);
      uvs.push(0, t, 1, t);
      if (i < STEPS) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, waterU]),
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vWp;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWp = w.xyz;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir, uSunCol, uSkyCol;
        uniform sampler2D uNoise;
        varying vec2 vUv; varying vec3 vWp;
        #include <fog_pars_fragment>
        float n2(vec2 p) { return texture2D(uNoise, p).r; }
        void main() {
          // 双层滚动扰动伪法线
          vec2 flow = vec2(0.0, uTime * 0.16);
          float na = n2(vWp.xz * 0.09 + flow);
          float nb = n2(vWp.xz * 0.17 - flow * 0.7 + 3.7);
          vec3 nrm = normalize(vec3((na - 0.5) * 0.35, 1.0, (nb - 0.5) * 0.35));
          vec3 vDir = normalize(cameraPosition - vWp);
          // 深浅：边缘浅、池心深
          float edge = abs(vUv.x - 0.5) * 2.0;
          float depth = (1.0 - edge) * 0.6 + smoothstep(0.86, 1.0, vUv.y) * 0.5;
          vec3 deep = vec3(0.06, 0.14, 0.11);
          vec3 shallow = vec3(0.24, 0.36, 0.28);
          vec3 col = mix(shallow, deep, clamp(depth, 0.0, 1.0));
          // 天空菲涅尔
          float fres = pow(1.0 - max(dot(vDir, nrm), 0.0), 2.6);
          col = mix(col, uSkyCol, fres * 0.65);
          // 太阳耀斑（喂辉光）
          vec3 hv = normalize(vDir + normalize(uSunDir));
          float spec = pow(max(dot(nrm, hv), 0.0), 130.0);
          col += uSunCol * spec * 1.6;
          // 岸线泡沫（噪声打散）
          float foamEdge = smoothstep(0.80, 0.97, edge) * smoothstep(0.42, 0.75, n2(vWp.xz * 0.4 + flow * 2.0));
          col = mix(col, vec3(0.92, 0.96, 0.94), foamEdge * 0.75);
          // 瀑布段（uv.y 落差区间）：白帘（压一档保层次）
          float fall = smoothstep(0.585, 0.612, vUv.y) * (1.0 - smoothstep(0.645, 0.675, vUv.y));
          float streak = n2(vec2(vWp.x * 0.7, vWp.y * 0.22 - uTime * 2.4));
          col = mix(col, vec3(0.88, 0.93, 0.95), fall * (0.42 + 0.38 * streak));
          float alpha = 0.82 + fres * 0.15 + fall * 0.12;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
          #include <fog_fragment>
        }
      `,
    });
    // merge() 克隆了 uniform 对象——整体换回共享引用，供逐帧更新
    mat.uniforms.uTime = waterU.uTime;
    mat.uniforms.uSunDir = waterU.uSunDir;
    mat.uniforms.uSunCol = waterU.uSunCol;
    mat.uniforms.uSkyCol = waterU.uSkyCol;
    mat.uniforms.uNoise = waterU.uNoise;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    scene.add(mesh);
    return mesh;
  })();
  function riverBedY(t: number): number {
    return terrainHeight(riverPoint(t).x, riverPoint(t).z) + 0.55 * (1 - smoothstep(0.6, 0.65, t)) - 1.15;
  }

  // 瀑布喷雾：潭面上升的雾团（大软光斑）+ 激溅亮屑
  const FALL_T = 0.648; // 崖脚（潭）
  const fallP = riverPoint(FALL_T);
  const fallYBase = riverBedY(FALL_T) + 1.3;
  const mistSprites: THREE.Sprite[] = [];
  {
    const mistMat = () => new THREE.SpriteMaterial({
      map: canvasTex(128, 128, (g) => {
        const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(235,244,248,0.35)');
        grad.addColorStop(0.5, 'rgba(235,244,248,0.13)');
        grad.addColorStop(1, 'rgba(235,244,248,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
      }),
      transparent: true, depthWrite: false, opacity: 0.8,
    });
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Sprite(mistMat());
      sp.position.set(
        fallP.x + Math.sin(i * 2.4) * riverWidth(FALL_T) * 0.7,
        riverBedY(FALL_T) + 2 + (i % 2) * 1.4,
        fallP.z + Math.cos(i * 1.7) * riverWidth(FALL_T) * 0.6,
      );
      sp.scale.setScalar(6 + i * 1.6);
      scene.add(sp);
      mistSprites.push(sp);
    }
  }
  const spray = (() => {
    const N = hi ? 260 : 110;
    const r = rng(31);
    const pos = new Float32Array(N * 3);
    const seeds = new Float32Array(N);
    for (let i = 0; i < N; i++) seeds[i] = r();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPx: { value: DPR * 240 } },
      vertexShader: /* glsl */ `
        uniform float uTime, uPx;
        attribute float aSeed;
        varying float vA;
        void main() {
          float life = fract(uTime * (0.4 + aSeed * 0.5) + aSeed * 7.0);
          float ang = aSeed * 43.0;
          vec3 p;
          p.x = ${fallP.x.toFixed(2)} + cos(ang) * (0.4 + aSeed * 2.4) * life * 2.2;
          p.z = ${fallP.z.toFixed(2)} + sin(ang) * (0.4 + aSeed * 2.0) * life * 2.2;
          p.y = ${fallYBase.toFixed(2)} + (2.0 + aSeed * 3.5) * (1.0 - life * 0.85);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = (1.0 - life) * 0.7;
          gl_PointSize = (1.2 + aSeed * 2.2) * uPx / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float m = smoothstep(0.5, 0.1, length(d));
          gl_FragColor = vec4(vec3(0.9, 0.96, 1.0), vA * m * 0.5);
        }
      `,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  })();

  // 潭面泡沫环：脉冲白环
  const foamRing = (() => {
    const geo = new THREE.RingGeometry(1.5, riverWidth(FALL_T) + 2.4, 48, 1);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uNoise: { value: noiseTex } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform sampler2D uNoise;
        varying vec2 vUv;
        void main() {
          float n = texture2D(uNoise, vec2(vUv.x * 4.0, vUv.y * 2.0 - uTime * 0.5)).r;
          float a = smoothstep(0.15, 0.55, n) * 0.4;
          gl_FragColor = vec4(vec3(0.93, 0.97, 0.96), a);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(fallP.x, riverBedY(FALL_T) + 1.32, fallP.z);
    mesh.renderOrder = 3;
    scene.add(mesh);
    return mesh;
  })();

  // ═════════════════════ 植被 ═════════════════════
  // 几何小工具：顶点抖动 + 上色（全部合并为「一个树种一个几何体」供实例化）
  function jitterVerts(geo: THREE.BufferGeometry, seed: number, amp: number, freq: number): THREE.BufferGeometry {
    const p = geo.attributes.position as THREE.BufferAttribute;
    const n = makeNoise2(seed);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const d = 1 + (n.fbm(v.x * freq + 5, (v.y + v.z) * freq, 3) - 0.5) * amp;
      p.setXYZ(i, v.x * d, v.y, v.z * d);
    }
    geo.computeVertexNormals();
    return geo;
  }
  function paintGeo(geo: THREE.BufferGeometry, hexc: number, variance = 0.06): THREE.BufferGeometry {
    // mergeGeometries 要求属性与索引性一致：统一转非索引（多边形量可控，树冠棱面反添质感）
    const g = geo.index ? geo.toNonIndexed() : geo;
    const c = new THREE.Color(hexc);
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    const r = rng(hexc + 7);
    for (let i = 0; i < n; i++) {
      const v2 = 1 + (r() - 0.5) * variance * 2;
      cols[i * 3] = c.r * v2; cols[i * 3 + 1] = c.g * v2; cols[i * 3 + 2] = c.b * v2;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    return g;
  }
  const withUV = (g: THREE.BufferGeometry) => {
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    return g;
  };

  /** 风场注入：实例位置取相位的正弦摇曳（树冠/灌木/蕨共用） */
  function injectWind(mat: THREE.Material, strength: number, heightRef: number) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windTimeU;
      shader.uniforms.uWind = windStrengthU;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec2 ip = vec2(0.0);
          #ifdef USE_INSTANCING
            ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          #endif
          float hFac = clamp(position.y / ${heightRef.toFixed(2)}, 0.0, 1.6);
          float sway = sin(uTime * 1.35 + ip.x * 0.37 + ip.y * 0.53) + 0.55 * sin(uTime * 2.9 + ip.x * 0.71 + ip.y * 0.23);
          transformed.x += sway * hFac * hFac * ${strength.toFixed(3)} * uWind;
          transformed.z += sway * 0.6 * hFac * hFac * ${strength.toFixed(3)} * uWind;
        }`);
    };
    (mat as THREE.Material & { customProgramCacheKey?: () => string }).customProgramCacheKey = () => `wind${strength}${heightRef}`;
  }

  const vegMat = (opts: Partial<THREE.MeshStandardMaterialParameters> = {}, wind?: [number, number]) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, ...opts });
    if (wind) injectWind(m, wind[0], wind[1]);
    return m;
  };

  // —— 树种几何 ——
  function coniferGeo(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const trunk = new THREE.CylinderGeometry(0.13, 0.3, 2.4, 7);
    trunk.translate(0, 1.2, 0);
    parts.push(paintGeo(withUV(trunk), 0x57432f, 0.1));
    const greens = [0x2e4a26, 0x335230, 0x2a4524, 0x3a5a2e, 0x305029];
    for (let i = 0; i < 5; i++) {
      const cone = jitterVerts(new THREE.ConeGeometry(2.0 - i * 0.38, 2.2 - i * 0.22, 9), 300 + i, 0.16, 2.2);
      cone.translate(0, 2.4 + i * 1.02, 0);
      parts.push(paintGeo(cone, greens[i], 0.09));
    }
    return mergeGeometries(parts)!;
  }
  function broadleafGeo(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const trunk = new THREE.CylinderGeometry(0.2, 0.44, 3.2, 7);
    trunk.translate(0, 1.6, 0);
    parts.push(paintGeo(withUV(trunk), 0x64503a, 0.1));
    for (const [dx, dz, rot] of [[-0.7, 0.2, 0.75], [0.6, -0.4, -0.7]] as const) {
      const br = new THREE.CylinderGeometry(0.07, 0.14, 1.7, 5);
      br.translate(0, 0.85, 0);
      br.rotateZ(rot);
      br.translate(dx * 1.1, 2.4, dz);
      parts.push(paintGeo(withUV(br), 0x5b4835, 0.1));
    }
    const greens = [0x4c7034, 0x557a38, 0x476830, 0x5d8240];
    const spots: [number, number, number, number][] = [
      [0, 4.0, 0, 1.5], [-1.15, 3.5, 0.6, 1.1], [1.05, 3.6, -0.5, 1.2], [0.2, 3.3, 1.0, 0.95],
    ];
    spots.forEach(([x, y, z, s], i) => {
      const blob = jitterVerts(new THREE.IcosahedronGeometry(s, 1), 400 + i, 0.34, 1.6);
      blob.scale(1, 0.82, 1);
      blob.translate(x, y, z);
      parts.push(paintGeo(blob, greens[i], 0.1));
    });
    return mergeGeometries(parts)!;
  }
  function birchGeo(): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
    const trunk = new THREE.CylinderGeometry(0.09, 0.17, 4.8, 8);
    trunk.translate(0, 2.4, 0);
    const parts: THREE.BufferGeometry[] = [];
    const greens = [0x87a84e, 0x93b258, 0x7c9c46];
    [[0, 4.4, 0, 1.05], [-0.6, 3.9, 0.35, 0.8], [0.5, 4.0, -0.3, 0.85]].forEach(([x, y, z, s], i) => {
      const blob = jitterVerts(new THREE.IcosahedronGeometry(s, 1), 500 + i, 0.3, 1.8);
      blob.scale(1, 0.85, 1);
      blob.translate(x, y, z);
      parts.push(paintGeo(blob, greens[i], 0.1));
    });
    return { trunk: withUV(trunk), canopy: mergeGeometries(parts)! };
  }
  function fernGeo(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const frond = new THREE.PlaneGeometry(0.2, 1.05, 1, 4);
      const p = frond.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < p.count; v++) {
        const y01 = (p.getY(v) + 0.525) / 1.05;
        p.setX(v, p.getX(v) * (1 - y01 * 0.75));
        p.setZ(v, y01 * y01 * 0.5); // 弯垂
      }
      frond.translate(0, 0.525, -0.25);
      frond.rotateX(-0.5);
      frond.rotateY((i / 6) * Math.PI * 2);
      parts.push(paintGeo(withUV(frond), 0x3a5e30, 0.12));
    }
    return mergeGeometries(parts)!;
  }
  function shroomGeo(capColor: number): THREE.BufferGeometry {
    const stem = new THREE.CylinderGeometry(0.018, 0.032, 0.14, 6);
    stem.translate(0, 0.07, 0);
    const cap = new THREE.SphereGeometry(0.095, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.72, 1);
    cap.translate(0, 0.13, 0);
    return mergeGeometries([paintGeo(withUV(stem), 0xe8ddc4, 0.05), paintGeo(withUV(cap), capColor, 0.08)])!;
  }

  const treePlacements = {
    conifer: scatter({ count: hi ? 130 : 66, seed: 101, minDist: 3.6, riverPad: 3.2, maxSlope: 0.5, maxSlopeRiver: true, filter: (x, z) => moistureAt(x, z) > 0.42 }),
    broad: scatter({ count: hi ? 108 : 56, seed: 202, minDist: 3.4, riverPad: 2.8, maxSlope: 0.55, maxSlopeRiver: true }),
    birch: scatter({ count: hi ? 54 : 26, seed: 303, minDist: 2.4, riverPad: 2.4, maxSlope: 0.5, filter: (x, z) => moistureAt(x, z) < 0.62 }),
    log: scatter({ count: 22, seed: 404, minDist: 6, riverPad: 2, maxSlope: 0.5 }),
    stump: scatter({ count: 12, seed: 505, minDist: 8, riverPad: 2.5, maxSlope: 0.45 }),
    bush: scatter({ count: hi ? 90 : 44, seed: 606, minDist: 1.8, riverPad: 1.6, maxSlope: 0.6, filter: (x, z) => moistureAt(x, z) > 0.45 }),
    fern: scatter({ count: hi ? 300 : 120, seed: 707, minDist: 0.9, riverPad: 1.2, maxSlope: 0.62, filter: (x, z) => moistureAt(x, z) > 0.5 }),
    shroom: scatter({ count: hi ? 88 : 40, seed: 808, minDist: 0.5, riverPad: 1.5, maxSlope: 0.5, filter: (x, z) => moistureAt(x, z) > 0.55 }),
  };

  const dummy = new THREE.Object3D();
  const placeInstances = (
    mesh: THREE.InstancedMesh,
    spots: { x: number; z: number }[],
    seed: number,
    scale: [number, number],
    tintA: number,
    tintB: number,
    sink = 0,
  ) => {
    const r = rng(seed);
    const tint = new THREE.Color();
    for (let i = 0; i < spots.length; i++) {
      const { x, z } = spots[i];
      dummy.position.set(x, terrainHeight(x, z) - sink, z);
      dummy.rotation.set(0, r() * Math.PI * 2, 0);
      const s = range(r, scale[0], scale[1]);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tint.setHex(tintA).lerp(new THREE.Color(tintB), r());
      mesh.setColorAt(i, tint);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };

  const foliageMat = vegMat({}, undefined);
  placeInstances(new THREE.InstancedMesh(coniferGeo(), foliageMat, treePlacements.conifer.length), treePlacements.conifer, 11, [0.75, 1.5], 0xffffff, 0xd9e8cc);
  placeInstances(new THREE.InstancedMesh(broadleafGeo(), foliageMat, treePlacements.broad.length), treePlacements.broad, 22, [0.7, 1.45], 0xffffff, 0xe4eedd);
  injectWind(foliageMat, 0.05, 6.5);
  {
    const bg = birchGeo();
    const trunkMat = new THREE.MeshStandardMaterial({ map: birchTexture(), roughness: 0.9 });
    const canopyMat = vegMat();
    const birches = treePlacements.birch;
    const bt = new THREE.InstancedMesh(bg.trunk, trunkMat, birches.length);
    const bc = new THREE.InstancedMesh(bg.canopy, canopyMat, birches.length);
    const r = rng(44);
    for (let i = 0; i < birches.length; i++) {
      const { x, z } = birches[i];
      dummy.position.set(x, terrainHeight(x, z), z);
      dummy.rotation.set(0, r() * Math.PI * 2, (r() - 0.5) * 0.08);
      dummy.scale.setScalar(range(r, 0.8, 1.3));
      dummy.updateMatrix();
      bt.setMatrixAt(i, dummy.matrix);
      bc.setMatrixAt(i, dummy.matrix);
    }
    bt.instanceMatrix.needsUpdate = true;
    bc.instanceMatrix.needsUpdate = true;
    bt.castShadow = bc.castShadow = true;
    injectWind(canopyMat, 0.06, 4.6);
    scene.add(bt, bc);
  }
  { // 倒木与树桩
    const logGeo = new THREE.CylinderGeometry(0.26, 0.34, 3.6, 8);
    logGeo.rotateZ(Math.PI / 2);
    logGeo.translate(0, 0.3, 0);
    placeInstances(new THREE.InstancedMesh(paintGeo(withUV(logGeo), 0x57432f, 0.12), vegMat(), treePlacements.log.length), treePlacements.log, 55, [0.8, 1.3], 0xffffff, 0xc9d8bc, 0.12);
    const stumpGeo = new THREE.CylinderGeometry(0.34, 0.42, 0.7, 9);
    stumpGeo.translate(0, 0.35, 0);
    placeInstances(new THREE.InstancedMesh(paintGeo(withUV(stumpGeo), 0x64503a, 0.1), vegMat(), treePlacements.stump.length), treePlacements.stump, 66, [0.8, 1.4], 0xffffff, 0xd0dcc2);
  }
  { // 灌木（摇曳）
    const bushGeo = mergeGeometries([
      paintGeo(jitterVerts(new THREE.IcosahedronGeometry(0.75, 1), 901, 0.35, 2.0), 0x3c5c2e, 0.1),
      paintGeo(jitterVerts(new THREE.IcosahedronGeometry(0.55, 1), 902, 0.35, 2.2), 0x446633, 0.1).translate(0.6, -0.1, 0.3),
    ])!;
    const bm = vegMat();
    placeInstances(new THREE.InstancedMesh(bushGeo, bm, treePlacements.bush.length), treePlacements.bush, 77, [0.8, 1.7], 0xffffff, 0xdfe8d2);
    injectWind(bm, 0.045, 1.1);
  }
  {
    const fm = vegMat({ side: THREE.DoubleSide });
    placeInstances(new THREE.InstancedMesh(fernGeo(), fm, treePlacements.fern.length), treePlacements.fern, 88, [0.7, 1.6], 0xffffff, 0xd8e4cc);
    injectWind(fm, 0.09, 0.9);
  }
  { // 蘑菇（红伞常规 + 幽蓝荧光圈）
    placeInstances(new THREE.InstancedMesh(shroomGeo(0xb03828), vegMat(), treePlacements.shroom.length), treePlacements.shroom, 99, [0.7, 1.8], 0xffffff, 0xffe0d0);
    const glowSpot = DISCOVERIES.find((d) => d.key === 'glow')!;
    const gPos = glowSpot.pos;
    const gBaseY = terrainHeight(gPos.x, gPos.z);
    const glowMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.6, emissive: new THREE.Color('#37e0d0'), emissiveIntensity: 2.4,
    });
    const glowGeo = shroomGeo(0x2a8a80);
    const glowCount = 14;
    const gm = new THREE.InstancedMesh(glowGeo, glowMat, glowCount);
    const r = rng(1234);
    for (let i = 0; i < glowCount; i++) {
      const a = (i / glowCount) * Math.PI * 2 + r() * 0.4;
      const rad = 1.4 + r() * 3.4;
      const x = gPos.x + Math.cos(a) * rad, z = gPos.z + Math.sin(a) * rad;
      dummy.position.set(x, terrainHeight(x, z) - 0.02, z);
      dummy.rotation.set(0, r() * Math.PI * 2, 0);
      dummy.scale.setScalar(range(r, 0.9, 2.4));
      dummy.updateMatrix();
      gm.setMatrixAt(i, dummy.matrix);
    }
    gm.instanceMatrix.needsUpdate = true;
    scene.add(gm);
    const glowLight = new THREE.PointLight(0x37e0d0, 5, 17, 1.6);
    glowLight.position.set(gPos.x, gBaseY + 0.9, gPos.z);
    scene.add(glowLight);
  }
  { // 苔石环（五块苔石）
    const stoneSpot = DISCOVERIES.find((d) => d.key === 'stones')!;
    const r = rng(5566);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const x = stoneSpot.pos.x + Math.cos(a) * 3.2;
      const z = stoneSpot.pos.z + Math.sin(a) * 3.2;
      const geo = jitterVerts(new THREE.DodecahedronGeometry(range(r, 0.7, 1.05), 0), 700 + i, 0.4, 2.4);
      const mesh = new THREE.Mesh(paintGeo(withUV(geo), 0x5c6a56, 0.12), vegMat());
      mesh.position.set(x, terrainHeight(x, z) + 0.28, z);
      mesh.rotation.set(r(), r() * 6, r());
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
  // 古木（发现点主角，独立大 mesh 吃风）
  {
    const ancient = DISCOVERIES.find((d) => d.key === 'ancient')!;
    const am = vegMat();
    injectWind(am, 0.035, 13);
    const tree = new THREE.Mesh(broadleafGeo(), am);
    tree.position.set(ancient.pos.x, terrainHeight(ancient.pos.x, ancient.pos.z) - 0.3, ancient.pos.z);
    tree.scale.setScalar(2.7);
    tree.rotation.y = 1.2;
    tree.castShadow = true;
    scene.add(tree);
  }

  // —— 花（两个品种，交叉面片 + alphaTest） ——
  const flowerTexA = flowerTexture('rgba(248,244,232,0.96)', 'rgba(255,208,96,0.95)');
  const flowerTexB = flowerTexture('rgba(196,160,228,0.95)', 'rgba(255,238,150,0.95)');
  function flowerCross(tex: THREE.Texture): THREE.BufferGeometry {
    const g1 = new THREE.PlaneGeometry(0.24, 0.24);
    const g2 = g1.clone().rotateY(Math.PI / 2);
    const g = mergeGeometries([withUV(g1.toNonIndexed()), withUV(g2.toNonIndexed())])!;
    g.translate(0, 0.14, 0);
    void tex;
    return g;
  }
  const flowerSpots = scatter({ count: hi ? 640 : 240, seed: 909, minDist: 0.35, riverPad: 1.4, maxSlope: 0.5, filter: (x, z) => moistureAt(x, z) < 0.55 });
  {
    const meadow = DISCOVERIES.find((d) => d.key === 'meadow')!;
    const half = Math.floor(flowerSpots.length / 2);
    for (const [list, tex] of [[flowerSpots.slice(0, half), flowerTexA], [flowerSpots.slice(half), flowerTexB]] as const) {
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.9 });
      injectWind(mat, 0.1, 0.3);
      const mesh = new THREE.InstancedMesh(flowerCross(tex), mat, list.length + 26);
      const r = rng(tex === flowerTexA ? 1 : 2);
      let i = 0;
      for (const p of list) {
        dummy.position.set(p.x, terrainHeight(p.x, p.z), p.z);
        dummy.rotation.set(0, r() * Math.PI, 0);
        dummy.scale.setScalar(range(r, 0.8, 1.5));
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
      // 花海中心加一簇
      for (let k = 0; k < 26; k++) {
        const a = r() * Math.PI * 2, rad = r() * 10;
        const x = meadow.pos.x + Math.cos(a) * rad, z = meadow.pos.z + Math.sin(a) * rad;
        dummy.position.set(x, terrainHeight(x, z), z);
        dummy.rotation.set(0, r() * Math.PI, 0);
        dummy.scale.setScalar(range(r, 0.9, 1.6));
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      scene.add(mesh);
    }
  }

  // —— 草地（自定义着色器：风/斑驳/距离塌缩/实例色） ——
  const GRASS_N = hi ? 42000 : 9000;
  const grassMesh = (() => {
    const blade = new THREE.PlaneGeometry(0.09, 1.05, 1, 3);
    const p = blade.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < p.count; v++) {
      const y01 = (p.getY(v) + 0.525) / 1.05;
      p.setX(v, p.getX(v) * (1 - y01 * 0.85));
      p.setZ(v, y01 * y01 * 0.22);
    }
    blade.translate(0, 0.525, 0);
    const geo = blade;
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTime: windTimeU, uWind: windStrengthU,
        uDapple: { value: dappleTex }, uDappleOff: dappleOffU,
        uSunDir: waterU.uSunDir, uSunCol: waterU.uSunCol, uSunInt: { value: 1 },
        uHemiCol: { value: new THREE.Color('#bcd4f0') }, uHemiInt: { value: 0.6 },
        uFogColor: { value: new THREE.Color('#dfe8e4') }, uFogDensity: { value: 0.006 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uWind;
        varying float vY; varying vec3 vCol; varying vec3 vWp; varying float vDist;
        void main() {
          vY = uv.y;
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #else
            vCol = vec3(1.0);
          #endif
          vec3 p = position;
          vec2 ip = vec2(0.0);
          #ifdef USE_INSTANCING
            ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          #endif
          float ph = uTime * 1.9 + ip.x * 0.63 + ip.y * 0.41;
          float bend = (sin(ph) + 0.5 * sin(ph * 2.3 + 1.7)) * 0.14 * uWind * vY * vY;
          p.x += bend; p.z += bend * 0.7;
          vec4 lp = vec4(p, 1.0);
          #ifdef USE_INSTANCING
            lp = instanceMatrix * lp;
          #endif
          vec4 wp = modelMatrix * lp;
          vWp = wp.xyz;
          vec4 mv = viewMatrix * wp;
          vDist = -mv.z;
          // 远处塌缩（省填充率，也自然淡出；hi 拉远一档避免中景断档）
          float far = ${hi ? '62.0' : '46.0'};
          float s = 1.0 - smoothstep(far - 9.0, far, vDist);
          wp.y -= (1.0 - s) * 1.05;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDapple; uniform vec2 uDappleOff;
        uniform vec3 uSunDir, uSunCol, uHemiCol, uFogColor;
        uniform float uHemiInt, uFogDensity, uSunInt;
        varying float vY; varying vec3 vCol; varying vec3 vWp; varying float vDist;
        void main() {
          vec3 base = vec3(0.30, 0.42, 0.18) * vCol;
          vec3 tip = vec3(0.55, 0.62, 0.28) * vCol;
          vec3 col = mix(base, tip, vY);
          float dap = texture2D(uDapple, vWp.xz * 0.055 + uDappleOff).r;
          float lam = 0.5 + 0.5 * max(uSunDir.y, 0.0);
          // 与 MeshStandard 同口径：太阳有强度、黄昏会暗下去
          col *= uHemiCol * uHemiInt + uSunCol * uSunInt * lam * (0.5 + 0.5 * dap) * 2.0;
          float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
          col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    // 实例矩阵展开（ShaderMaterial 手动吃 instanceMatrix）
    const mesh = new THREE.InstancedMesh(geo, mat, GRASS_N);
    const r = rng(20261121);
    const tint = new THREE.Color();
    const cA = new THREE.Color('#5a7a3a'), cB = new THREE.Color('#7c9448'), cDry = new THREE.Color('#9a9a56');
    const splat = makeNoise2(777);
    let placed = 0;
    let guard = GRASS_N * 26;
    while (placed < GRASS_N && guard-- > 0) {
      const a = r() * Math.PI * 2;
      const rad = Math.sqrt(r()) * (WORLD_R + 4);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const sl = slopeAt(x, z);
      if (sl > 0.62) continue;
      const { d, t } = riverInfo(x, z);
      if (d < riverWidth(t) + 0.7) continue;
      const dry = splat.fbm(x * 0.012 + 9, z * 0.012, 3);
      if (dry > 0.72 && r() < 0.65) continue; // 干旱斑块草稀
      if (r() > 0.35 + 0.65 * (1 - sl)) continue; // 陡处更稀
      dummy.position.set(x, terrainHeight(x, z) - 0.03, z);
      dummy.rotation.set(0, r() * Math.PI * 2, 0);
      dummy.scale.setScalar(range(r, 0.65, 1.45));
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      tint.copy(cA).lerp(cB, r());
      tint.lerp(cDry, smoothstep(0.6, 0.78, dry));
      mesh.setColorAt(placed, tint);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  })();

  // ═════════════════════ 大气粒子 ═════════════════════
  // 花粉微尘：相机周围的包裹光尘（光轴里最亮的那些点）
  const pollen = (() => {
    const N = hi ? 380 : 150;
    const R = 15;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const r = rng(71);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (r() - 0.5) * 2 * R;
      pos[i * 3 + 1] = (r() - 0.5) * 2 * R * 0.6;
      pos[i * 3 + 2] = (r() - 0.5) * 2 * R;
      seed[i] = r();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPx: { value: DPR * 90 }, uDay: { value: 0.55 } },
      vertexShader: /* glsl */ `
        uniform float uTime, uPx;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * (0.2 + aSeed * 0.3) + aSeed * 40.0) * 1.4;
          p.y += sin(uTime * (0.13 + aSeed * 0.2) + aSeed * 80.0) * 0.9;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = 0.4 + 0.6 * sin(uTime * (0.8 + aSeed) + aSeed * 90.0);
          gl_PointSize = (0.5 + aSeed) * uPx / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uDay;
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float m = smoothstep(0.5, 0.12, length(d));
          vec3 warm = vec3(1.0, 0.9, 0.68);
          vec3 dusk = vec3(0.85, 0.8, 1.0);
          float dim = 1.0 - 0.65 * smoothstep(0.7, 1.0, uDay); // 暮色让位给萤火
          gl_FragColor = vec4(mix(warm, dusk, smoothstep(0.6, 1.0, uDay)), vA * m * 0.4 * dim);
        }
      `,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, mat, R, N };
  })();

  // 萤火虫：暮色苏醒的呼吸光点
  const fireflies = (() => {
    const N = hi ? 240 : 80;
    const spots = scatter({ count: N, seed: 1723, minDist: 1.2, riverPad: 1.5, maxSlope: 0.6 });
    const pos = new Float32Array(spots.length * 3);
    const seed = new Float32Array(spots.length);
    const r = rng(88);
    spots.forEach((p, i) => {
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = terrainHeight(p.x, p.z) + 0.4 + r() * 1.9;
      pos[i * 3 + 2] = p.z;
      seed[i] = r();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPx: { value: DPR * 200 }, uMix: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime, uPx;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * (0.3 + aSeed * 0.4) + aSeed * 30.0) * 0.8;
          p.y += sin(uTime * (0.5 + aSeed * 0.3) + aSeed * 60.0) * 0.35;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float blink = pow(max(sin(uTime * (1.2 + aSeed * 2.0) + aSeed * 40.0), 0.0), 3.0);
          vA = blink;
          gl_PointSize = (0.9 + blink * 1.6) * uPx / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uMix;
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float m = smoothstep(0.5, 0.1, length(d));
          vec3 col = vec3(0.72, 0.95, 0.45);
          gl_FragColor = vec4(col * (1.2 + vA * 1.6), vA * m * uMix);
        }
      `,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, mat, max: spots.length };
  })();

  // 蝴蝶（两片鳞翅靠横缩拍动）与蜻蜓
  const butterflyTex = canvasTex(64, 64, (g) => {
    g.translate(32, 32);
    g.fillStyle = 'rgba(0,0,0,0)';
    for (const side of [-1, 1]) {
      g.save();
      g.scale(side, 1);
      const grad = g.createRadialGradient(10, -6, 2, 10, -6, 17);
      grad.addColorStop(0, 'rgba(255,196,88,0.98)');
      grad.addColorStop(0.7, 'rgba(228,120,52,0.95)');
      grad.addColorStop(1, 'rgba(120,40,30,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(11, -7, 11, 9, -0.5, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(8, 7, 8, 7, 0.4, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.fillStyle = 'rgba(60,30,20,0.95)';
    g.fillRect(-1.5, -14, 3, 28);
  });
  interface Flutter { mesh: THREE.InstancedMesh; items: { p: THREE.Vector3; a: number; sp: number; h: number }[]; total: number }
  const flutter: Flutter = (() => {
    const geo = new THREE.PlaneGeometry(0.22, 0.18);
    const mat = new THREE.MeshBasicMaterial({ map: butterflyTex, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, fog: true });
    const N = hi ? 12 : 6;
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const r = rng(99);
    const items = [];
    for (let i = 0; i < N; i++) {
      const spot = flowerSpots[Math.floor(r() * flowerSpots.length)] ?? { x: 0, z: 0 };
      items.push({
        p: new THREE.Vector3(spot.x, terrainHeight(spot.x, spot.z) + 1 + r(), spot.z),
        a: r() * Math.PI * 2,
        sp: 0.5 + r() * 0.5,
        h: 0.7 + r() * 1.2,
      });
    }
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, items, total: N };
  })();
  function updateFlutter(dt: number, t: number) {
    for (let i = 0; i < flutter.total; i++) {
      const b = flutter.items[i];
      b.a += Math.sin(t * 0.31 + i * 2.6) * dt * 1.4;
      b.p.x += Math.cos(b.a) * b.sp * dt;
      b.p.z += Math.sin(b.a) * b.sp * dt;
      const gh = terrainHeight(b.p.x, b.p.z);
      const wantY = gh + b.h + Math.sin(t * 1.7 + i * 3.1) * 0.3;
      b.p.y += (wantY - b.p.y) * Math.min(dt * 2, 1);
      dummy.position.copy(b.p);
      dummy.rotation.set(0, -b.a, Math.sin(t * 18 + i) * 0.12);
      const flap = 0.35 + Math.abs(Math.sin(t * 16 * b.sp + i * 7)); // 拍翅横缩
      dummy.scale.set(flap, 1, 1);
      dummy.updateMatrix();
      flutter.mesh.setMatrixAt(i, dummy.matrix);
    }
    flutter.mesh.instanceMatrix.needsUpdate = true;
  }

  // 落叶：树冠飘落的旋转叶
  const leaves = (() => {
    const N = hi ? 60 : 24;
    const geo = new THREE.PlaneGeometry(0.12, 0.16);
    const mat = new THREE.MeshBasicMaterial({ map: leafTexture('rgba(178,126,52,0.95)'), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, fog: true });
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const r = rng(1200);
    const items = [];
    for (let i = 0; i < N; i++) {
      items.push({
        x: r() * 60 - 30, z: r() * 60 - 30,
        y: r() * 9 + 2,
        s: 0.4 + r() * 0.8, ph: r() * 9,
      });
    }
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, items, N, r };
  })();
  function updateLeaves(dt: number, t: number) {
    for (let i = 0; i < leaves.N; i++) {
      const L = leaves.items[i];
      L.y -= dt * (0.32 + L.s * 0.22);
      L.x += Math.sin(t * 0.9 + L.ph) * dt * 0.5;
      L.z += Math.cos(t * 0.7 + L.ph * 1.3) * dt * 0.4;
      const gh = terrainHeight(L.x + player.pos.x, L.z + player.pos.z);
      if (L.y + player.pos.y - EYE < gh) { // 落地重生到头顶树冠
        L.x = leaves.r() * 24 - 12;
        L.z = leaves.r() * 24 - 12;
        L.y = 6 + leaves.r() * 4;
      }
      dummy.position.set(player.pos.x + L.x, player.pos.y - EYE + L.y, player.pos.z + L.z);
      dummy.rotation.set(t * (0.8 + L.s) + L.ph, t * 0.6 + L.ph, Math.sin(t * 2 + L.ph) * 0.8);
      dummy.scale.setScalar(L.s);
      dummy.updateMatrix();
      leaves.mesh.setMatrixAt(i, dummy.matrix);
    }
    leaves.mesh.instanceMatrix.needsUpdate = true;
  }

  // 蜻蜓：河面上悬停-突进的小十字
  const dragonflies = (() => {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.012, 0.3, 3, 6).rotateZ(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3a6a8a, fog: true }),
    );
    const wings = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.06).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, fog: true }),
    );
    const grp = new THREE.Group();
    grp.add(body, wings);
    const list = hi ? [0.32, 0.38, 0.75] : [0.35];
    const inst = list.map((t0) => {
      const g = grp.clone();
      const p = riverPoint(t0);
      g.position.set(p.x, terrainHeight(p.x, p.z) + 1.4, p.z);
      scene.add(g);
      return { g, t0, a: 0, seed: t0 * 91 };
    });
    return { inst };
  })();
  function updateDragonflies(dt: number, t: number) {
    for (const d of dragonflies.inst) {
      d.a += Math.sin(t * 0.6 + d.seed) * dt * 2.2;
      const dart = Math.sin(t * 2.1 + d.seed * 3.7) > 0.86 ? 3.2 : 1; // 偶发突进
      const p0 = riverPoint(d.t0);
      const px = p0.x + Math.cos(d.a) * riverWidth(d.t0) * 0.5 * dart * 0.5;
      const pz = p0.z + Math.sin(d.a) * riverWidth(d.t0) * 0.5;
      d.g.position.set(px, terrainHeight(px, pz) + 1.3 + Math.sin(t * 3.1 + d.seed) * 0.2, pz);
      d.g.rotation.y = -d.a;
      d.g.rotation.z = Math.sin(t * 26 + d.seed) * 0.08; // 悬停微颤
    }
  }

  // ═════════════════════ 后期链 ═════════════════════
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight).multiplyScalar(hi ? 0.7 : 0.5), 0.55, 0.55, 0.62);
  composer.addPass(bloom);
  const raysPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.6) },
      uAspect: { value: 1.7 }, uStrength: { value: 0 },
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
        for (int i = 0; i < 20; i++) {
          float t = float(i) / 19.0;
          float decay = 1.0 - t * 0.93;
          acc += texture2D(tDiffuse, vUv + toSun * t).rgb * decay;
          wsum += decay;
        }
        float d = length((vUv - uSun) * vec2(uAspect, 1.0));
        gl_FragColor = vec4(base + (acc / wsum) * exp(-d * 2.2) * uStrength, 1.0);
      }
    `,
  });
  if (hi) composer.addPass(raysPass);
  composer.addPass(new OutputPass());
  const fxaaPass = new ShaderPass(FXAAShader);
  if (hi) composer.addPass(fxaaPass);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDay: { value: 0.55 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime, uDay;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 d = vUv - 0.5;
        float r2 = dot(d, d);
        vec3 col = texture2D(tDiffuse, vUv).rgb;
        float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(luma), col, 1.16);                                     // 饱和
        col = (col - 0.5) * 1.045 + 0.5;                                      // 对比
        // 晨偏青金 · 暮偏绛紫
        col += mix(vec3(0.010, 0.012, -0.006), vec3(0.018, -0.004, 0.024), uDay);
        col *= 1.0 - smoothstep(0.2, 0.68, r2) * 0.34;                        // 暗角
        col += (hash(vUv * 1517.0 + fract(uTime) * 7.7) - 0.5) * 0.024;       // 颗粒
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  composer.addPass(grade);

  // ═════════════════════ 时段（一切光的总谱应用） ═════════════════════
  const sunDir = new THREE.Vector3();
  function applyDay(day: number) {
    const L = dayLook(day);
    beauty.day = day;
    const elev = L.elevDeg * Math.PI / 180;
    const azim = 0.42; // 固定方位：瀑布与太阳同向（出生即逆光大片）
    sunDir.set(Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim)).normalize();
    skyU.uTop.value.copy(L.skyTop);
    skyU.uMid.value.copy(L.skyMid);
    skyU.uBot.value.copy(L.skyBot);
    skyU.uSunDir.value.copy(sunDir);
    skyU.uSunCol.value.copy(L.sunCol);
    skyU.uStar.value = L.star;
    skyU.uGlow.value = 1 - 0.85 * smoothstep(0.7, 1, day); // 暮色：日晕收敛
    sun.color.copy(L.sunCol);
    sun.intensity = L.sunInt;
    renderer.toneMappingExposure = 1.02 - 0.14 * smoothstep(0.7, 1, day);
    hemi.color.copy(L.hemiSky);
    hemi.intensity = L.hemiInt;
    (scene.fog as THREE.FogExp2).color.copy(L.fogCol);
    (scene.fog as THREE.FogExp2).density = L.fogD;
    renderer.setClearColor(L.fogCol, 1);
    waterU.uSunDir.value.copy(sunDir);
    waterU.uSunCol.value.copy(L.sunCol);
    waterU.uSkyCol.value.copy(L.skyMid);
    (grassMesh.material as THREE.ShaderMaterial).uniforms.uHemiCol.value.copy(L.hemiSky);
    (grassMesh.material as THREE.ShaderMaterial).uniforms.uHemiInt.value = L.hemiInt;
    (grassMesh.material as THREE.ShaderMaterial).uniforms.uFogColor.value.copy(L.fogCol);
    (grassMesh.material as THREE.ShaderMaterial).uniforms.uFogDensity.value = L.fogD;
    (grassMesh.material as THREE.ShaderMaterial).uniforms.uSunInt.value = L.sunInt * 0.33;
    grade.uniforms.uDay.value = day;
    fireflies.mat.uniforms.uMix.value = smoothstep(0.72, 0.95, day) * beauty.firefly;
    // 暮色收敛：场景整体变暗，辉光若不随之收敛就会把画面洗白
    const duskK = smoothstep(0.7, 1, day);
    bloom.strength = (0.5 + 0.28 * smoothstep(0.6, 1, day)) * (1 - 0.5 * duskK) * beauty.bloom;
    bloom.threshold = 0.62 + 0.26 * duskK;
  }
  applyDay(beauty.day);

  // ═════════════════════ 发现系统 ═════════════════════
  const FIND_STORE = 'opt-forest-find';
  let foundSet = new Set<string>();
  try { foundSet = new Set(JSON.parse(localStorage.getItem(FIND_STORE) || '[]') as string[]); } catch { /* 私隐模式 */ }
  const discoveryNodes = DISCOVERIES.map((d) => ({ ...d, world: new THREE.Vector3(d.pos.x, terrainHeight(d.pos.x, d.pos.z), d.pos.z) }));

  // ═════════════════════ 主循环 ═════════════════════
  const clock = new THREE.Clock();
  let raf = 0;
  let ready = false;
  const tmpV = new THREE.Vector3();

  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    updatePlayer(dt);
    windTimeU.value = t;
    windStrengthU.value = beauty.wind;
    dappleOffU.value.set(t * 0.006 + beauty.day * 0.22, t * 0.004); // 光斑随风漂移

    // 太阳与阴影盒跟随玩家
    sun.position.copy(player.pos).addScaledVector(sunDir, 90);
    sun.target.position.copy(player.pos);
    sun.target.updateMatrixWorld();

    // 水与雾团
    waterU.uTime.value = t;
    spray.material.uniforms.uTime.value = t;
    foamRing.material.uniforms.uTime.value = t;
    mistSprites.forEach((sp, i) => {
      sp.material.opacity = 0.4 + 0.2 * Math.sin(t * 0.7 + i * 1.9);
      sp.position.y += Math.sin(t * 0.5 + i) * 0.002;
    });

    // 大气粒子
    pollen.mat.uniforms.uTime.value = t;
    pollen.mat.uniforms.uDay.value = beauty.day;
    pollen.pts.position.set(player.pos.x, player.pos.y - 0.4, player.pos.z);
    fireflies.mat.uniforms.uTime.value = t;
    fireflies.pts.geometry.setDrawRange(0, Math.floor(fireflies.max * beauty.firefly));
    updateFlutter(dt, t);
    updateLeaves(dt, t);
    updateDragonflies(dt, t);

    // 发现触发
    for (const d of discoveryNodes) {
      if (foundSet.has(d.key)) continue;
      if (player.pos.distanceTo(d.world) < d.radius) {
        foundSet.add(d.key);
        try { localStorage.setItem(FIND_STORE, JSON.stringify([...foundSet])); } catch { /* 忽略 */ }
        opts.onDiscover?.(d.key, d.name, d.line);
      }
    }

    // 光轴：太阳在屏内才有
    {
      tmpV.copy(sunDir).multiplyScalar(60).add(camera.position).project(camera);
      let strength = 0;
      if (tmpV.z < 1) {
        const ex = Math.max(0, Math.min(1, (1.5 - Math.abs(tmpV.x)) / 0.5));
        const ey = Math.max(0, Math.min(1, (1.5 - Math.abs(tmpV.y)) / 0.5));
        strength = 0.5 * ex * ey * (0.45 + 0.55 * (1 - beauty.day * 0.35)) * beauty.bloom
          * (1 - 0.65 * smoothstep(0.7, 1, beauty.day)); // 暮色光轴收敛
        raysPass.uniforms.uSun.value.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5);
        raysPass.uniforms.uAspect.value = (canvas.clientWidth || innerWidth) / (canvas.clientHeight || innerHeight);
      }
      raysPass.uniforms.uStrength.value = strength;
    }
    grade.uniforms.uTime.value = t;

    composer.render();

    if (!ready) { ready = true; opts.onReady?.(); }
    const { d: rd } = riverInfo(player.pos.x, player.pos.z);
    const nearFalls = player.pos.distanceTo(new THREE.Vector3(fallP.x, player.pos.y, fallP.z));
    opts.onTick?.({
      day: beauty.day,
      atWater: 1 - clamp01(rd / 42),
      nearFalls: 1 - clamp01(nearFalls / 30),
      found: foundSet.size,
      total: DISCOVERIES.length,
      wading: player.wading,
      speed: Math.hypot(player.vel.x, player.vel.z),
    });
  }

  // ---- 调试机位（无头验证） ----
  {
    const q = new URLSearchParams(location.search);
    if (q.has('at')) {
      const k = q.get('at')!;
      if (k === 'fall') {
        // 瀑布专属机位：站在潭边回望崖壁白帘
        const plunge = riverPoint(0.675);
        const crest = riverPoint(0.615);
        const pq = riverPoint(0.69);
        let nx = -(pq.z - plunge.z), nz = pq.x - plunge.x;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl; nz /= nl;
        player.pos.set(plunge.x + nx * 7, 0, plunge.z + nz * 7);
        player.pos.y = terrainHeight(player.pos.x, player.pos.z) + EYE + 0.6;
        const look = new THREE.Vector3(crest.x, riverBedY(0.63) + 3.2, crest.z).sub(player.pos).normalize();
        player.yaw = Math.atan2(-look.x, -look.z);
        player.pitch = Math.asin(THREE.MathUtils.clamp(look.y, -0.99, 0.99));
        applyLook();
      } else {
        const d = discoveryNodes.find((n) => n.key === k);
        if (d) {
          const dir = new THREE.Vector3(d.world.x, 0, d.world.z).normalize();
          player.pos.copy(d.world).addScaledVector(dir, -d.radius * 0.9).add(new THREE.Vector3(0, EYE + 1.2, 0));
          player.pos.y = terrainHeight(player.pos.x, player.pos.z) + EYE + 1.2;
          const look = d.world.clone().add(new THREE.Vector3(0, 2.2, 0)).sub(player.pos).normalize();
          player.yaw = Math.atan2(-look.x, -look.z);
          player.pitch = Math.asin(THREE.MathUtils.clamp(look.y, -0.99, 0.99));
          applyLook();
        }
      }
    }
    if (q.has('day')) applyDay(Number(q.get('day')) || 0);
    if (q.has('nobloom')) bloom.enabled = false;
    if (q.has('norays')) raysPass.enabled = false;
    if (q.has('nograss')) grassMesh.count = 0;
  }

  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (hi) fxaaPass.material.uniforms.resolution.value.set(1 / canvas.width, 1 / canvas.height);
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
    setBeauty(p: Partial<ForestBeauty>) {
      const dayChanged = p.day !== undefined && p.day !== beauty.day;
      Object.assign(beauty, p);
      if (dayChanged) applyDay(beauty.day);
      windStrengthU.value = beauty.wind;
      grassMesh.count = Math.floor(GRASS_N * beauty.grass);
      fireflies.mat.uniforms.uMix.value = smoothstep(0.72, 0.95, beauty.day) * beauty.firefly;
      fireflies.pts.geometry.setDrawRange(0, Math.floor(fireflies.max * beauty.firefly));
      bloom.strength = (0.5 + 0.28 * smoothstep(0.6, 1, beauty.day)) * (1 - 0.5 * smoothstep(0.7, 1, beauty.day)) * beauty.bloom;
      bloom.threshold = 0.62 + 0.26 * smoothstep(0.7, 1, beauty.day);
    },
    snapshot(): string {
      composer.render();
      return renderer.domElement.toDataURL('image/png');
    },
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
