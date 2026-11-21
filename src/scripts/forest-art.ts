import * as THREE from 'three';

/** 《深林》绘本美术总谱：所有颜色、质量与风场从这里出发。 */
export const FOREST_PALETTE = {
  canopyShadow: '#203D32', canopy: '#688344', canopyLight: '#B0C267', canopyTip: '#C2C97A',
  mossShadow: '#293D25', moss: '#5B7437', mossLight: '#91A64F',
  grass: '#587C3C', grassLight: '#92A94F', broadLeaf: '#47713D',
  barkShadow: '#24191B', bark: '#442B27', barkLight: '#6A4430',
  birch: '#D9D7C2', birchMark: '#55483E',
  pathShadow: '#8D624B', path: '#BC8964', pathLight: '#DDB181',
  mushroomShadow: '#A6B3A2', mushroom: '#DBDDC7', mushroomLight: '#F2E9D0',
  stem: '#E2D8BC', petal: '#F2F0DC', petalLight: '#FFF5DF', pollen: '#E9AC3D', pollenLight: '#FFD36A',
  sky: '#9DE1D4', skyLight: '#C4EBDD', fog: '#A9C7AE',
  waterDeep: '#174F4B', water: '#3E9B87', waterLight: '#A7D9BC',
  glow: '#56E2C2', violet: '#9A83C5',
} as const;

export const FOREST_SUN_AZIMUTH = 2.15;

export type ForestQuality = 'high' | 'medium' | 'low';
export interface ForestQualityProfile {
  name: ForestQuality;
  dpr: number;
  terrainSegments: number;
  treeCount: number;
  chunkSize: number;
  nearDistance: number;
  midDistance: number;
  groundRadius: number;
  grassDensity: number;
  shadowMap: number;
  shadowRadius: number;
  beamCount: number;
  ao: boolean;
  fxaa: boolean;
  pollen: number;
  fireflies: number;
  butterflies: number;
  leaves: number;
}
export const QUALITY_PROFILES: Record<ForestQuality, ForestQualityProfile> = {
  high: { name: 'high', dpr: 1.75, terrainSegments: 280, treeCount: 790, chunkSize: 24, nearDistance: 22, midDistance: 55, groundRadius: 54, grassDensity: 17, shadowMap: 2048, shadowRadius: 34, beamCount: 10, ao: false, fxaa: true, pollen: 420, fireflies: 260, butterflies: 16, leaves: 72 },
  medium: { name: 'medium', dpr: 1.4, terrainSegments: 220, treeCount: 620, chunkSize: 24, nearDistance: 20, midDistance: 47, groundRadius: 44, grassDensity: 12, shadowMap: 1536, shadowRadius: 30, beamCount: 7, ao: false, fxaa: true, pollen: 240, fireflies: 160, butterflies: 10, leaves: 44 },
  low: { name: 'low', dpr: 1.15, terrainSegments: 150, treeCount: 470, chunkSize: 24, nearDistance: 18, midDistance: 38, groundRadius: 34, grassDensity: 8, shadowMap: 1024, shadowRadius: 26, beamCount: 4, ao: false, fxaa: false, pollen: 130, fireflies: 90, butterflies: 6, leaves: 26 },
};
export function resolveQuality(search = typeof location === 'undefined' ? '' : location.search): ForestQuality {
  const q = new URLSearchParams(search).get('quality');
  if (q === 'high' || q === 'medium' || q === 'low') return q;
  if (typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || innerWidth < 720)) return 'low';
  return 'high';
}

export interface ForestDayLook {
  day: number;
  elevDeg: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  skyTop: THREE.Color;
  skyMid: THREE.Color;
  skyBottom: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  rimColor: THREE.Color;
  rimIntensity: number;
  fogColor: THREE.Color;
  fogDensity: number;
  exposure: number;
  star: number;
  bloomStrength: number;
  bloomThreshold: number;
  waterLight: number;
}
const C = (hex: string) => new THREE.Color(hex);
const mixColor = (a: THREE.Color, b: THREE.Color, c: THREE.Color, day: number) => {
  if (day <= 0.55) return a.clone().lerp(b, day / 0.55);
  return b.clone().lerp(c, (day - 0.55) / 0.45);
};
const mixNumber = (a: number, b: number, c: number, day: number) => day <= 0.55 ? a + (b - a) * day / 0.55 : b + (c - b) * (day - 0.55) / 0.45;

export function forestDayLook(input: number): ForestDayLook {
  const day = Math.max(0, Math.min(1, input));
  const dusk = THREE.MathUtils.smoothstep(day, 0.72, 1);
  return {
    day,
    elevDeg: mixNumber(34, 43, 7, day),
    sunColor: mixColor(C('#FFE9B8'), C('#FFE1A8'), C('#FF9B72'), day),
    sunIntensity: mixNumber(3.0, 3.25, 1.15, day),
    skyTop: mixColor(C('#79CFC8'), C('#83D8CE'), C('#27345F'), day),
    skyMid: mixColor(C('#B4E5D7'), C('#A2DFC8'), C('#67577F'), day),
    skyBottom: mixColor(C('#D8E6C4'), C('#BCD8B4'), C('#D18A75'), day),
    hemiSky: mixColor(C('#C5E0D8'), C('#C5E0D8'), C('#586A8A'), day),
    hemiGround: mixColor(C('#31483A'), C('#31483A'), C('#202E35'), day),
    hemiIntensity: mixNumber(0.92, 0.88, 0.46, day),
    rimColor: mixColor(C('#FFF0C7'), C('#FFE7B8'), C('#B8A5D9'), day),
    rimIntensity: mixNumber(0.5, 0.62, 0.28, day),
    fogColor: mixColor(C('#A9C7AE'), C('#A9C7AE'), C('#575879'), day),
    fogDensity: mixNumber(0.012, 0.0105, 0.014, day),
    exposure: mixNumber(1.02, 1.04, 0.9, day),
    star: dusk,
    bloomStrength: mixNumber(0.19, 0.22, 0.16, day),
    bloomThreshold: mixNumber(1.0, 1.08, 1.18, day),
    waterLight: mixNumber(0.95, 1.0, 0.24, day),
  };
}

export interface WindUniforms {
  uTime: { value: number };
  uWind: { value: number };
}
export function createWindUniforms(): WindUniforms {
  return { uTime: { value: 0 }, uWind: { value: 1 } };
}
export interface WindMaterialPair {
  material: THREE.MeshStandardMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
}
/** 可见网格和深度网格吃同一套顶点风，树冠与影子不会各动各的。 */
export function createWindMaterial(wind: WindUniforms, strength: number, options: THREE.MeshStandardMaterialParameters = {}, detail?: 'canopy' | 'bark'): WindMaterialPair {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.91, metalness: 0, ...options });
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: options.side ?? THREE.FrontSide });
  const inject = (shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string }) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uWind = wind.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWind;\nattribute float aBend;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec2 wp = position.xz;
          #ifdef USE_INSTANCING
            wp += vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          #endif
          float phase = uTime * 1.32 + wp.x * 0.29 + wp.y * 0.37;
          float gust = sin(phase) + 0.42 * sin(phase * 2.31 + wp.x * 0.17);
          float bend = aBend * aBend * ${strength.toFixed(4)} * uWind;
          transformed.x += gust * bend;
          transformed.z += gust * bend * 0.58;
        }`);
  };
  material.onBeforeCompile = (shader) => {
    inject(shader);
    if (detail === 'canopy') {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vForestDetail;')
        .replace('vec2 wp = position.xz;', 'vForestDetail = position;\n          vec2 wp = position.xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vForestDetail;
          float forestLeafHash(vec3 p){p=fract(p*0.3183099+vec3(0.1,0.2,0.3));p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
          float forestLeafNoise(vec3 x){
            vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);
            return mix(mix(mix(forestLeafHash(i),forestLeafHash(i+vec3(1,0,0)),f.x),mix(forestLeafHash(i+vec3(0,1,0)),forestLeafHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(forestLeafHash(i+vec3(0,0,1)),forestLeafHash(i+vec3(1,0,1)),f.x),mix(forestLeafHash(i+vec3(0,1,1)),forestLeafHash(i+vec3(1,1,1)),f.x),f.y),f.z);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float leafLarge=forestLeafNoise(vForestDetail*10.5);
            float leafFine=forestLeafNoise(vForestDetail*29.0);
            float grain=leafLarge*0.68+leafFine*0.32;
            diffuseColor.rgb*=0.68+grain*0.62;
            diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.08,1.13,0.91),smoothstep(0.56,0.82,grain)*0.42);
          }`);
    }
  };
  depthMaterial.onBeforeCompile = inject;
  const key = `forest-wind-${strength}-${options.side ?? THREE.FrontSide}-${detail ?? 'plain'}`;
  material.customProgramCacheKey = () => key;
  depthMaterial.customProgramCacheKey = () => key;
  return { material, depthMaterial };
}

export function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, size: number) => void, srgb = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function barkDetailTexture(): THREE.CanvasTexture {
  const texture = canvasTexture(256, (g, size) => {
    let seed = 712367;
    const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 90; i++) {
      const x = random() * size, width = 0.6 + random() * 3.2, shade = 150 + Math.floor(random() * 70);
      g.strokeStyle = `rgba(${shade},${shade},${shade},0.72)`; g.lineWidth = width; g.beginPath(); g.moveTo(x, -8);
      for (let y = 0; y <= size + 8; y += 18) g.lineTo(x + Math.sin(y * 0.05 + i) * (2 + random() * 3), y);
      g.stroke();
    }
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = 'rgba(130,130,130,0.45)'; g.lineWidth = 1.5; g.beginPath();
      g.ellipse(random() * size, random() * size, 3 + random() * 7, 1.5 + random() * 3, random(), 0, Math.PI * 2); g.stroke();
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function canopyDetailTexture(): THREE.CanvasTexture {
  const texture = canvasTexture(256, (g, size) => {
    let seed = 918273;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    g.fillStyle = '#eeeeee'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 1500; i++) {
      const x = random() * size, y = random() * size, radius = 1.5 + random() * 3.8;
      g.save(); g.translate(x, y); g.rotate(random() * Math.PI);
      const light = 208 + Math.floor(random() * 47);
      g.fillStyle = `rgb(${light},${light},${light})`;
      g.beginPath(); g.ellipse(0, 0, radius, radius * (0.45 + random() * 0.35), 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function softDiscTexture(color = '255,244,204'): THREE.CanvasTexture {
  return canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, `rgba(${color},0.9)`);
    grad.addColorStop(0.35, `rgba(${color},0.34)`);
    grad.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
  }, false);
}

export function disposeMaterial(material: THREE.Material): void {
  const record = material as unknown as Record<string, unknown>;
  for (const value of Object.values(record)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}
