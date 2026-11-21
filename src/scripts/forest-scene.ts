import * as THREE from 'three';
import { QUALITY_PROFILES, createWindUniforms, resolveQuality } from './forest-art';
import { ForestControls, FOREST_EYE } from './forest-controls';
import {
  DISCOVERIES, FALL_CREST_T, FALL_T, SPAWN, clamp01, pathInfo, riverInfo, riverPoint, riverWaterLevel,
  terrainHeight,
} from './forest-core';
import { ForestLandmarks } from './forest-landmarks';
import { ForestLife } from './forest-life';
import { ForestLighting, ForestPost } from './forest-lighting';
import { ForestTerrain } from './forest-terrain';
import { ForestVegetation } from './forest-vegetation';
import { ForestWater } from './forest-water';

export interface ForestTick {
  day: number;
  atWater: number;
  nearFalls: number;
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
export interface ForestBeauty {
  day: number;
  bloom: number;
  wind: number;
  grass: number;
  firefly: number;
}
export interface ForestDebugStats {
  quality: string;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  frameMs: number;
  trees: number;
  treeChunks: number;
  groundChunks: number;
  visibleGroundTriangles: number;
}

/** 组合各资源模块；页面公开契约保持稳定。 */
export function createForest(canvas: HTMLCanvasElement, opts: ForestEvents = {}) {
  const query = new URLSearchParams(location.search);
  const quality = resolveQuality(location.search), profile = QUALITY_PROFILES[quality];
  const context = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  if (!context) throw new Error('此浏览器不支持 WebGL2，森林无法生长。');
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, profile.dpr));
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.06, 400);
  const beauty: ForestBeauty = { day: 0.55, bloom: 1, wind: 1, grass: 1, firefly: 1 };
  const wind = createWindUniforms();

  const terrain = new ForestTerrain(profile); scene.add(terrain.group);
  const water = new ForestWater(); scene.add(water.group);
  const vegetation = new ForestVegetation(profile, wind); scene.add(vegetation.group);
  const landmarks = new ForestLandmarks(wind); scene.add(landmarks.group);
  const life = new ForestLife(profile); scene.add(life.group);
  const controls = new ForestControls(camera, canvas, opts.onEvent);
  controls.setPose(SPAWN.x, terrainHeight(SPAWN.x, SPAWN.z) + FOREST_EYE, SPAWN.z, SPAWN.yaw, 0.025);
  const lighting = new ForestLighting(scene, camera, renderer, profile);
  const post = new ForestPost(renderer, scene, camera, profile);

  const FIND_STORE = 'opt-forest-find';
  const validKeys = new Set(DISCOVERIES.map((d) => d.key));
  let foundSet = new Set<string>();
  try { foundSet = new Set((JSON.parse(localStorage.getItem(FIND_STORE) || '[]') as string[]).filter((key) => validKeys.has(key))); } catch { /* 私隐模式 */ }
  const discoveries = DISCOVERIES.map((d) => ({ ...d, world: new THREE.Vector3(d.pos.x, terrainHeight(d.pos.x, d.pos.z), d.pos.z) }));

  function applyDay(value: number): void {
    beauty.day = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0.55, 0, 1);
    const look = lighting.applyDay(beauty.day);
    water.setDay(look); life.setDay(look, beauty.day); landmarks.setDay(beauty.day); post.setDay(look);
  }
  function setBeauty(p: Partial<ForestBeauty>): void {
    const next = { ...beauty };
    if (p.day !== undefined && Number.isFinite(p.day)) next.day = THREE.MathUtils.clamp(p.day, 0, 1);
    if (p.bloom !== undefined && Number.isFinite(p.bloom)) next.bloom = THREE.MathUtils.clamp(p.bloom, 0, 1.6);
    if (p.wind !== undefined && Number.isFinite(p.wind)) next.wind = THREE.MathUtils.clamp(p.wind, 0, 2.5);
    if (p.grass !== undefined && Number.isFinite(p.grass)) next.grass = THREE.MathUtils.clamp(p.grass, 0, 1);
    if (p.firefly !== undefined && Number.isFinite(p.firefly)) next.firefly = THREE.MathUtils.clamp(p.firefly, 0, 1);
    const dayChanged = next.day !== beauty.day;
    Object.assign(beauty, next);
    if (dayChanged) applyDay(beauty.day);
    wind.uWind.value = beauty.wind;
    if (!query.has('nograss')) vegetation.setGrassDensity(beauty.grass);
    life.setFireflyAmount(beauty.firefly); post.setBloom(beauty.bloom);
  }

  // 专属机位在恢复设置之前定义；页面随后写入相同时段，不会反向覆盖调试开关。
  function debugPose(keyOverride?: string): void {
    const key = keyOverride ?? query.get('at');
    if (!key) return;
    if (key === 'fall') {
      const crest = riverPoint(FALL_CREST_T), foot = riverPoint(FALL_T), q = riverPoint(FALL_T + 0.012);
      let nx = -(q.z - foot.z), nz = q.x - foot.x; const length = Math.hypot(nx, nz) || 1; nx /= length; nz /= length;
      const x = foot.x + nx * 14.5, z = foot.z + nz * 14.5;
      const eye = new THREE.Vector3(x, terrainHeight(x, z) + FOREST_EYE + 1.8, z);
      const look = new THREE.Vector3(crest.x, riverWaterLevel(FALL_CREST_T) - 2.3, crest.z).sub(eye).normalize();
      controls.setPose(eye.x, eye.y, eye.z, Math.atan2(-look.x, -look.z), Math.asin(THREE.MathUtils.clamp(look.y, -0.99, 0.99)));
      return;
    }
    const discovery = discoveries.find((d) => d.key === key); if (!discovery) return;
    const special: Record<string, { x: number; z: number; height: number; target: number }> = {
      ancient: { x: 7, z: 16, height: 2.2, target: 7.5 },
      meadow: { x: -10, z: 12, height: 1.2, target: 1.3 },
      glow: { x: -8, z: 8, height: 1.1, target: 1.2 },
      stones: { x: 0, z: 12, height: 1.4, target: 0.9 },
    };
    const view = special[discovery.key];
    if (view) {
      const eye = discovery.world.clone().add(new THREE.Vector3(view.x, 0, view.z));
      eye.y = terrainHeight(eye.x, eye.z) + FOREST_EYE + view.height;
      const look = discovery.world.clone().add(new THREE.Vector3(0, view.target, 0)).sub(eye).normalize();
      controls.setPose(eye.x, eye.y, eye.z, Math.atan2(-look.x, -look.z), Math.asin(THREE.MathUtils.clamp(look.y, -0.99, 0.99)));
      return;
    }
    const direction = new THREE.Vector3(discovery.world.x, 0, discovery.world.z).normalize();
    const eye = discovery.world.clone().addScaledVector(direction, -discovery.radius * 0.9);
    eye.y = terrainHeight(eye.x, eye.z) + FOREST_EYE + 0.8;
    const look = discovery.world.clone().add(new THREE.Vector3(0, 2.1, 0)).sub(eye).normalize();
    controls.setPose(eye.x, eye.y, eye.z, Math.atan2(-look.x, -look.z), Math.asin(THREE.MathUtils.clamp(look.y, -0.99, 0.99)));
  }
  debugPose();
  const urlDay = query.has('day') ? Number(query.get('day')) : beauty.day;
  applyDay(Number.isFinite(urlDay) ? urlDay : beauty.day);
  setBeauty(beauty);
  if (query.has('nograss')) vegetation.setGrassDensity(0);
  post.setDebug({ noBloom: query.has('nobloom'), noRays: query.has('norays'), noAO: query.has('noao'), noPost: query.has('nopost') });

  const abort = new AbortController();
  function resize(): void {
    const width = canvas.clientWidth || innerWidth, height = canvas.clientHeight || innerHeight;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); post.resize(width, height);
  }
  addEventListener('resize', resize, { signal: abort.signal }); resize();
  vegetation.update(controls.position, true);

  const clock = new THREE.Clock();
  const frozen = query.has('freeze') || query.has('test');
  const requestedTime = query.has('time') ? Number(query.get('time')) : NaN;
  const frozenTime = Number.isFinite(requestedTime) ? requestedTime : 12;
  let raf = 0, ready = false, tickElapsed = 1, frameMs = 16.7, contextLost = false;
  function emitTick(): void {
    const river = riverInfo(controls.position.x, controls.position.z);
    const nearFalls = Math.hypot(controls.position.x - water.fallCenter.x, controls.position.z - water.fallCenter.z);
    opts.onTick?.({
      day: beauty.day, atWater: 1 - clamp01(river.d / 42), nearFalls: 1 - clamp01(nearFalls / 30),
      found: foundSet.size, total: DISCOVERIES.length, wading: controls.wading, speed: controls.speed,
    });
  }
  function renderFrame(dt: number, time: number, rawDt: number, allowDiscovery: boolean): void {
    frameMs += ((rawDt * 1000) - frameMs) * 0.06;
    controls.update(dt); wind.uTime.value = time; wind.uWind.value = beauty.wind;
    vegetation.update(controls.position); water.update(time); life.update(dt, time, controls.position);
    lighting.update(controls.position, time, dt); post.update(camera, lighting.sunDirection, time);
    if (allowDiscovery) for (const discovery of discoveries) {
      if (foundSet.has(discovery.key)) continue;
      if (controls.position.distanceTo(discovery.world) < discovery.radius) {
        foundSet.add(discovery.key);
        try { localStorage.setItem(FIND_STORE, JSON.stringify([...foundSet])); } catch { /* 忽略 */ }
        opts.onDiscover?.(discovery.key, discovery.name, discovery.line);
      }
    }
    renderer.info.reset(); post.render();
    if (!ready) { ready = true; opts.onReady?.(); }
    tickElapsed += rawDt;
    if (tickElapsed >= 0.1 || rawDt === 0) { tickElapsed = 0; emitTick(); }
  }
  function frame(): void {
    raf = requestAnimationFrame(frame);
    const rawDt = Math.min(clock.getDelta(), 0.05), dt = frozen ? 0 : rawDt, time = frozen ? frozenTime : clock.elapsedTime;
    renderFrame(dt, time, rawDt, !frozen);
  }
  const onVisibility = () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf && !contextLost) { clock.getDelta(); raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVisibility, { signal: abort.signal });
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); contextLost = true; cancelAnimationFrame(raf); raf = 0; opts.onEvent?.('画面暂时中断，等待恢复…'); }, { signal: abort.signal });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; clock.getDelta(); if (!raf) raf = requestAnimationFrame(frame); }, { signal: abort.signal });

  function getStats(): ForestDebugStats {
    return {
      quality, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, frameMs,
      ...vegetation.getStats(),
    };
  }
  const handle = {
    setBeauty,
    snapshot(): string { renderer.info.reset(); post.render(); return renderer.domElement.toDataURL('image/png'); },
    getStats,
    dispose(): void {
      cancelAnimationFrame(raf); raf = 0; abort.abort(); controls.dispose();
      life.dispose(); landmarks.dispose(); vegetation.dispose(); terrain.dispose(); water.dispose(); lighting.dispose(); post.dispose();
      renderer.dispose();
    },
  };
  if (query.has('test')) {
    (window as unknown as { __forest?: unknown }).__forest = {
      getStats,
      setBeauty,
      renderOnce: () => renderFrame(0, frozenTime, 0, false),
      step: (dt: number) => { const delta = THREE.MathUtils.clamp(dt, 0, 0.05); renderFrame(delta, frozenTime, delta, false); },
      go: (key: string) => { debugPose(key); vegetation.update(controls.position, true); renderFrame(0, frozenTime, 0, false); },
      getPose: () => ({ x: controls.position.x, y: controls.position.y, z: controls.position.z, yaw: controls.yaw, pitch: controls.pitch, speed: controls.speed, walkSpeed: controls.walkSpeed, wading: controls.wading, onGround: controls.onGround }),
      setPose: (x: number, z: number, yaw = 0, pitch = 0) => { controls.setPose(x, terrainHeight(x, z) + FOREST_EYE, z, yaw, pitch); renderFrame(0, frozenTime, 0, false); },
      pathInfo: () => pathInfo(controls.position.x, controls.position.z),
    };
  }
  renderFrame(0, frozen ? frozenTime : 0, 0, false);
  raf = requestAnimationFrame(frame);
  return handle;
}
