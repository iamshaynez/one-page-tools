import * as THREE from 'three';
import { WORLD_R, slopeAt, terrainHeight, waterLevelAt } from './forest-core';

export const FOREST_EYE = 1.45;
interface Stick { id: number; kind: 'move' | 'look'; sx: number; sy: number; x: number; y: number }

/** 第一人称键鼠/触屏控制。地形、涉水与渲染消费同一地理核心。 */
export class ForestControls {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = true;
  wading = false;
  walkSpeed = 3.4;
  private keys = new Set<string>();
  private sticks: Stick[] = [];
  private mouseDrag: { id: number; x: number; y: number } | null = null;
  private stickEls: Record<'move' | 'look', HTMLDivElement | null> = { move: null, look: null };
  private coarse = matchMedia('(pointer: coarse)').matches;
  private locked = false;
  private moved = 0;
  private lastTap = { t: 0, x: 0, y: 0 };
  private pinchIds = new Set<number>();
  private pinchDistance = 0;
  private bobTime = 0;
  private abort = new AbortController();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private camera: THREE.PerspectiveCamera, private canvas: HTMLCanvasElement, private onEvent?: (text: string) => void) {
    this.applyLook();
    const signal = this.abort.signal;
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked) this.onEvent?.('已暂停 · 点击画面继续');
    }, { signal });
    canvas.addEventListener('click', () => {
      if (!this.coarse && !this.locked) {
        try { Promise.resolve(canvas.requestPointerLock?.()).catch(() => this.onEvent?.('拖动画面环顾')); } catch { this.onEvent?.('拖动画面环顾'); }
      }
    }, { signal });
    addEventListener('keydown', (event) => {
      if ((event.target as HTMLElement)?.closest('button, a, input, textarea')) return;
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        if (key === ' ') event.preventDefault();
        this.keys.add(key);
      }
    }, { signal });
    addEventListener('keyup', (event) => this.keys.delete(event.key.toLowerCase()), { signal });
    addEventListener('blur', () => {
      this.keys.clear(); this.sticks.length = 0; this.pinchIds.clear(); this.pinchDistance = 0; this.mouseDrag = null;
      this.lastTap = { t: 0, x: 0, y: 0 }; this.hideStick('move'); this.hideStick('look');
    }, { signal });
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event), { signal });
    canvas.addEventListener('pointermove', (event) => this.pointerMove(event), { signal });
    canvas.addEventListener('pointerup', (event) => this.pointerEnd(event), { signal });
    canvas.addEventListener('pointercancel', (event) => this.pointerEnd(event), { signal });
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch = 0): void {
    this.position.set(x, y, z); this.velocity.set(0, 0, 0);
    this.yaw = yaw; this.pitch = THREE.MathUtils.clamp(pitch, -1.3, 1.3);
    this.onGround = true; this.applyLook();
    this.camera.position.copy(this.position);
  }
  private applyLook(): void {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
  private pointerDown(event: PointerEvent): void {
    try { this.canvas.setPointerCapture?.(event.pointerId); } catch { /* 合成事件可能已无活动指针 */ }
    this.moved = 0;
    if (event.pointerType === 'touch') {
      const left = event.clientX < innerWidth * 0.44;
      this.sticks.push({ id: event.pointerId, kind: left ? 'move' : 'look', sx: event.clientX, sy: event.clientY, x: event.clientX, y: event.clientY });
      this.showStick(left ? 'move' : 'look', event.clientX, event.clientY);
      if (!left) {
        this.pinchIds.add(event.pointerId);
        if (this.pinchIds.size === 2) {
          const points = this.sticks.filter((s) => this.pinchIds.has(s.id));
          if (points.length === 2) this.pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        }
      }
    } else {
      this.mouseDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  }
  private pointerMove(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      const stick = this.sticks.find((s) => s.id === event.pointerId); if (!stick) return;
      const dx = event.clientX - stick.x, dy = event.clientY - stick.y;
      stick.x = event.clientX; stick.y = event.clientY; this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.pinchIds.size === 2 && this.pinchIds.has(event.pointerId)) {
        const points = this.sticks.filter((s) => this.pinchIds.has(s.id));
        if (points.length === 2) {
          const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
          if (this.pinchDistance > 0 && distance > 0) this.walkSpeed = THREE.MathUtils.clamp(this.walkSpeed * Math.pow(distance / this.pinchDistance, 1.2), 1.4, 11);
          this.pinchDistance = distance;
        }
      } else if (stick.kind === 'look') {
        this.yaw -= dx * 0.0034; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0034, -1.3, 1.3); this.applyLook();
      }
      return;
    }
    if (this.locked) {
      this.yaw -= event.movementX * 0.00225; this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.00225, -1.3, 1.3); this.applyLook();
    } else if (this.mouseDrag?.id === event.pointerId) {
      const dx = event.clientX - this.mouseDrag.x, dy = event.clientY - this.mouseDrag.y;
      this.mouseDrag.x = event.clientX; this.mouseDrag.y = event.clientY;
      this.yaw -= dx * 0.0031; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0031, -1.3, 1.3); this.applyLook();
    }
  }
  private pointerEnd(event: PointerEvent): void {
    const index = this.sticks.findIndex((s) => s.id === event.pointerId);
    const kind = index >= 0 ? this.sticks[index].kind : null;
    const wasPinch = this.pinchIds.size === 2;
    if (index >= 0) this.sticks.splice(index, 1);
    if (kind) this.hideStick(kind);
    this.pinchIds.delete(event.pointerId);
    if (this.pinchIds.size < 2) this.pinchDistance = 0;
    if (wasPinch) this.onEvent?.(`步速 ${this.walkSpeed.toFixed(1)} m/s`);
    if (this.mouseDrag?.id === event.pointerId) this.mouseDrag = null;
    if (kind && this.moved < 6) {
      const now = performance.now();
      const double = now - this.lastTap.t < 320 && Math.hypot(event.clientX - this.lastTap.x, event.clientY - this.lastTap.y) < 48;
      this.lastTap = { t: now, x: event.clientX, y: event.clientY };
      if (double) this.jump();
    }
  }
  private showStick(kind: 'move' | 'look', x: number, y: number): void {
    if (!this.stickEls[kind]) {
      const element = document.createElement('div');
      element.className = `forest-stick ${kind}`;
      element.innerHTML = '<div class="knob"></div>';
      document.body.appendChild(element); this.stickEls[kind] = element;
    }
    const element = this.stickEls[kind]!;
    element.style.display = 'block'; element.style.left = `${x}px`; element.style.top = `${y}px`;
  }
  private hideStick(kind: 'move' | 'look'): void {
    const element = this.stickEls[kind]; if (!element) return;
    element.style.display = 'none';
    (element.querySelector('.knob') as HTMLElement).style.transform = 'translate(-50%, -50%)';
  }
  private jump(): void {
    if (this.onGround) { this.velocity.y = 5.1; this.onGround = false; }
  }
  get speed(): number { return Math.hypot(this.velocity.x, this.velocity.z); }

  update(dt: number): void {
    let forward = 0, side = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) forward += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) forward -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) side += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) side -= 1;
    const moveStick = this.sticks.find((s) => s.kind === 'move');
    if (moveStick) {
      const dx = moveStick.x - moveStick.sx, dy = moveStick.y - moveStick.sy, magnitude = Math.hypot(dx, dy);
      if (magnitude > 6) {
        const amount = Math.min(1, magnitude / 52);
        side = dx / magnitude * amount; forward = -dy / magnitude * amount;
      }
      const knob = this.stickEls.move?.querySelector('.knob') as HTMLElement | null;
      if (knob) {
        const amount = Math.min(1, magnitude / 52);
        knob.style.transform = `translate(calc(-50% + ${dx / (magnitude || 1) * amount * 26}px), calc(-50% + ${dy / (magnitude || 1) * amount * 26}px))`;
      }
    }
    const boost = this.keys.has('shift');
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3().crossVectors(f, this.up).normalize();
    const wish = new THREE.Vector3().addScaledVector(f, forward).addScaledVector(right, side);
    const moving = wish.lengthSq() > 0.0001; if (wish.lengthSq() > 1) wish.normalize();
    const groundBefore = terrainHeight(this.position.x, this.position.z);
    const waterBefore = waterLevelAt(this.position.x, this.position.z);
    const wadingBefore = Number.isFinite(waterBefore) && waterBefore > groundBefore + 0.04;
    let speed = this.walkSpeed * (boost ? 2.05 : 1);
    if (wadingBefore) speed *= 0.55;
    speed *= 1 - 0.42 * slopeAt(this.position.x, this.position.z);
    const target = wish.multiplyScalar(moving ? speed : 0);
    this.velocity.x += (target.x - this.velocity.x) * Math.min(dt * 9, 1);
    this.velocity.z += (target.z - this.velocity.z) * Math.min(dt * 9, 1);
    if (this.keys.has(' ') && this.onGround) this.jump();
    this.velocity.y -= 13.5 * dt;
    this.position.addScaledVector(this.velocity, dt);
    const distance = Math.hypot(this.position.x, this.position.z);
    if (distance > WORLD_R) { this.position.x *= WORLD_R / distance; this.position.z *= WORLD_R / distance; }
    const ground = terrainHeight(this.position.x, this.position.z) + FOREST_EYE;
    const water = waterLevelAt(this.position.x, this.position.z);
    this.wading = Number.isFinite(water) && water > ground - FOREST_EYE + 0.04 && water < ground + 0.4;
    const floor = this.wading ? Math.max(ground, water + 0.88) : ground;
    if (this.position.y <= floor) { this.position.y = floor; this.velocity.y = 0; this.onGround = true; }
    this.bobTime += dt * (3.6 + this.speed * 1.5);
    const bob = this.onGround ? Math.sin(this.bobTime) * 0.028 * Math.min(this.speed / 3, 1) : 0;
    this.camera.position.set(this.position.x, this.position.y + bob, this.position.z);
    const targetFov = 60 + (boost && this.speed > 3 ? 5 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(dt * 5, 1); this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.abort.abort();
    for (const element of Object.values(this.stickEls)) element?.remove();
  }
}
