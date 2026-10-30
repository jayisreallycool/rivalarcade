import * as THREE from 'three';
import type { GameEngine } from './GameEngine';

export interface BurstOptions {
  count?: number;
  speed?: number;
  /** 0 = straight up, 1 = full sphere */
  spread?: number;
  life?: number;
  size?: number;
  gravity?: number;
  /** Extra velocity added to every particle (e.g. world scroll). */
  drift?: THREE.Vector3;
}

/**
 * GPU-friendly particle bursts: ONE InstancedMesh (one draw call) for every spark on screen.
 * Colours are boosted above 1.0 and not tone-mapped so they feed the bloom pass.
 */
export class ParticleBursts {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private alive = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly gravity: Float32Array;
  private readonly colors: THREE.Color[];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly e = new THREE.Euler();

  constructor(engine: GameEngine, geometry: THREE.BufferGeometry = new THREE.OctahedronGeometry(0.09, 0)) {
    this.capacity = engine.quality.maxParticles;
    const material = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);

    const n = this.capacity;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.colors = Array.from({ length: n }, () => new THREE.Color());

    engine.scene.add(this.mesh);
    engine.addUpdate((dt) => this.update(dt));
  }

  emit(origin: THREE.Vector3, color: THREE.ColorRepresentation, opts: BurstOptions = {}) {
    const count = opts.count ?? 12;
    const speed = opts.speed ?? 4;
    const spread = opts.spread ?? 1;
    const life = opts.life ?? 0.6;
    const size = opts.size ?? 1;
    const gravity = opts.gravity ?? 6;
    this.c.set(color).multiplyScalar(2.2); // HDR boost → blooms

    for (let k = 0; k < count; k++) {
      // Reuse the oldest slot when full
      const i = this.alive < this.capacity ? this.alive++ : Math.floor(Math.random() * this.capacity);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - Math.random() * (1 + spread));
      const sp = speed * (0.5 + Math.random() * 0.7);
      this.pos[i * 3] = origin.x;
      this.pos[i * 3 + 1] = origin.y;
      this.pos[i * 3 + 2] = origin.z;
      this.vel[i * 3] = Math.sin(phi) * Math.cos(theta) * sp + (opts.drift?.x ?? 0);
      this.vel[i * 3 + 1] = Math.cos(phi) * sp + (opts.drift?.y ?? 0);
      this.vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * sp + (opts.drift?.z ?? 0);
      this.life[i] = this.maxLife[i] = life * (0.7 + Math.random() * 0.6);
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.gravity[i] = gravity;
      this.colors[i].copy(this.c);
    }
  }

  clear() {
    this.alive = 0;
    this.mesh.count = 0;
  }

  private update(dt: number) {
    let i = 0;
    while (i < this.alive) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.swapRemove(i);
        continue;
      }
      const i3 = i * 3;
      this.vel[i3 + 1] -= this.gravity[i] * dt;
      this.vel[i3] *= 1 - 1.5 * dt;
      this.vel[i3 + 2] *= 1 - 1.5 * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const t = this.life[i] / this.maxLife[i];
      const sc = this.size[i] * t;
      this.v.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
      this.s.set(sc, sc, sc);
      this.e.set(t * 6 + i, t * 4, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.colors[i]);
      i++;
    }
    this.mesh.count = this.alive;
    if (this.alive > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
    }
  }

  private swapRemove(i: number) {
    const last = --this.alive;
    if (i === last) return;
    for (let k = 0; k < 3; k++) {
      this.pos[i * 3 + k] = this.pos[last * 3 + k];
      this.vel[i * 3 + k] = this.vel[last * 3 + k];
    }
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size[i] = this.size[last];
    this.gravity[i] = this.gravity[last];
    this.colors[i].copy(this.colors[last]);
  }
}
