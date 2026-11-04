import * as THREE from 'three';

/** Same look, cheaper shader: MeshPhysicalMaterial → MeshStandardMaterial with the shared fields. */
export function toStandard(m: THREE.MeshPhysicalMaterial) {
  const s = new THREE.MeshStandardMaterial({
    name: m.name,
    color: m.color.clone(),
    map: m.map,
    emissive: m.emissive.clone(),
    emissiveMap: m.emissiveMap,
    emissiveIntensity: m.emissiveIntensity,
    // Clear-coated surfaces read glossier: approximate with lower roughness.
    roughness: Math.max(0.05, m.roughness * (m.clearcoat > 0.5 ? 0.6 : 1)),
    metalness: m.metalness,
    roughnessMap: m.roughnessMap,
    metalnessMap: m.metalnessMap,
    normalMap: m.normalMap,
    envMapIntensity: m.envMapIntensity,
    flatShading: m.flatShading,
    transparent: m.transparent,
    opacity: m.opacity,
    side: m.side,
    depthWrite: m.depthWrite,
    vertexColors: m.vertexColors,
    alphaTest: m.alphaTest,
    toneMapped: m.toneMapped,
    fog: m.fog,
  });
  return s;
}
