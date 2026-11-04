import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { AvatarConfig } from './avatar-types';
import { create3DAvatar, type Avatar3DInstance, type AvatarAction } from './avatar-3d-model';
import { poseAction } from './avatar-slots';
import { toStandard } from './engine/materials';

/**
 * The studio every 3D avatar is shown in (interactive viewer and list snapshots): soft key +
 * rim lights, image-based reflections where the GPU can afford them, and a contact shadow.
 */
export interface AvatarStage {
  scene: THREE.Scene;
  key: THREE.DirectionalLight;
  ground: THREE.Mesh;
  dispose: () => void;
}

export function buildStage(renderer: THREE.WebGLRenderer, opts: { shadows: boolean; env: boolean }): AvatarStage {
  const scene = new THREE.Scene();
  const owned: { dispose: () => void }[] = [];
  if (opts.env) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      scene.environment = env;
      scene.environmentIntensity = 0.5;
      owned.push(env);
    } catch {
      /* no float targets: lights alone */
    }
  }
  scene.add(new THREE.HemisphereLight(0xdbe7ff, 0x1a1030, opts.env ? 1.0 : 1.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.3);
  key.position.set(2.2, 4, 3);
  key.target.position.set(0, 0.9, 0);
  scene.add(key, key.target);
  if (opts.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -1.4;
    key.shadow.camera.right = 1.4;
    key.shadow.camera.top = 2.4;
    key.shadow.camera.bottom = -0.4;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 10;
    key.shadow.bias = -0.0008;
    key.shadow.radius = 4;
  }
  const rim = new THREE.DirectionalLight(0x8be9ff, 1.6);
  rim.position.set(-3, 2.2, -2.5);
  const fill = new THREE.DirectionalLight(0xf0abfc, 0.6);
  fill.position.set(3, 0.6, -1.5);
  scene.add(rim, fill);

  // Contact shadow + a soft glowing stage ring.
  const groundGeo = new THREE.CircleGeometry(1.25, 48);
  const groundMat = opts.shadows ? new THREE.ShadowMaterial({ opacity: 0.38 }) : new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.005;
  ground.receiveShadow = true;
  if (!opts.shadows) ground.scale.setScalar(0.45);
  const ringGeo = new THREE.RingGeometry(0.62, 0.66, 64);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.45, toneMapped: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0;
  scene.add(ground, ring);
  owned.push(groundGeo, groundMat, ringGeo, ringMat);

  return { scene, key, ground, dispose: () => owned.forEach((o) => o.dispose()) };
}

/** Build an avatar for the stage: shadows on, physical materials swapped for standard on weak GPUs. */
export function stageAvatar(avatar: AvatarConfig, lite: boolean): Avatar3DInstance {
  const inst = create3DAvatar(avatar);
  const swaps = new Map<THREE.Material, THREE.Material>();
  inst.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    if (lite && (m.material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
      const src = m.material as THREE.MeshPhysicalMaterial;
      let dst = swaps.get(src);
      if (!dst) swaps.set(src, (dst = toStandard(src)));
      m.material = dst;
    }
  });
  if (swaps.size) {
    const base = inst.dispose;
    inst.dispose = () => {
      base();
      swaps.forEach((m) => m.dispose());
    };
  }
  return inst;
}

/** The animation the 3D avatar plays for a UI action (at rest it plays its equipped emote). */
export function stageAction(avatar: AvatarConfig, action: string | undefined): AvatarAction {
  if (!action || action === 'idle') return poseAction(avatar) ?? 'idle';
  return action as AvatarAction;
}
