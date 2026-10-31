import * as THREE from 'three';

/**
 * Procedural "neon studio" used as the image-based lighting for every game.
 *
 * Real-time PBR needs something to reflect: without it metals look grey and glossy floors
 * look matte. This builds a small scene — a dark gradient dome, a big overhead softbox, two
 * coloured light strips and a warm fill — and pre-filters it with PMREM once at start-up,
 * so reflections and ambient light cost nothing per frame and need no downloaded HDRI.
 */
export function createStudioScene(opts: { top?: THREE.ColorRepresentation; bottom?: THREE.ColorRepresentation; left?: THREE.ColorRepresentation; right?: THREE.ColorRepresentation; back?: THREE.ColorRepresentation; key?: number } = {}) {
  const scene = new THREE.Scene();
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(r: T) => (disposables.push(r), r);

  // Gradient dome (inside of a sphere)
  const dome = new THREE.Mesh(
    track(new THREE.SphereGeometry(20, 32, 16)),
    track(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(opts.top ?? 0x1b2340) },
          bottom: { value: new THREE.Color(opts.bottom ?? 0x05060a) },
        },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float t = smoothstep(-0.35, 0.8, vP.y); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }',
      }),
    ),
  );
  scene.add(dome);

  const panel = (color: THREE.ColorRepresentation, intensity: number, w: number, h: number, pos: [number, number, number]) => {
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), track(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  const k = opts.key ?? 1;
  panel(0xffffff, 6 * k, 10, 6, [0, 14, 2]); // overhead softbox → clean highlights on balls, gems, floors
  panel(opts.left ?? 0x00e5ff, 5, 1.4, 12, [-13, 3, -4]); // cyan strip
  panel(opts.right ?? 0xff2d7a, 5, 1.4, 12, [13, 3, -4]); // magenta strip
  panel(0xffb066, 2.2, 8, 2, [0, 2, 14]); // warm front fill
  panel(opts.back ?? 0x6d5bff, 2, 16, 3, [0, 6, -15]); // back wash

  return {
    scene,
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

/**
 * Final image grade, run after tone mapping: gentle S-curve contrast, saturation, a vignette
 * that pulls the eye to the middle of the play field, and very soft edge chromatic fringing.
 */
export const GradeShader = {
  name: 'RAGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    contrast: { value: 1.08 },
    saturation: { value: 1.12 },
    vignette: { value: 0.32 },
    fringe: { value: 0.0012 },
    lift: { value: new THREE.Vector3(0.0, 0.004, 0.012) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    uniform float saturation;
    uniform float vignette;
    uniform float fringe;
    uniform vec3 lift;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * fringe * r2 * 8.0;
      vec4 c = texture2D(tDiffuse, vUv);
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.b = texture2D(tDiffuse, vUv - off).b;
      vec3 col = c.rgb;
      // contrast around mid-grey, then saturation
      col = (col - 0.5) * contrast + 0.5;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      // cool shadow lift keeps blacks from crushing on phone screens
      col += lift * (1.0 - l);
      // vignette
      col *= 1.0 - vignette * smoothstep(0.12, 0.62, r2 * 1.6);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }
  `,
};
