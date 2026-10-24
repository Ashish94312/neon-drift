import * as THREE from "three";
import { TRACK } from "../core/Config";
import { curve } from "./CurvedWorld";

// The craft stays at z = 0 and the world scrolls. Shaders get track-space coords
// (x = lateral, s = distance along track), so grid lines move without moving geometry.
// uDist is wrapped to a multiple of every line spacing to keep float precision on long runs.
const WRAP = 1200;
const LENGTH = TRACK.near + TRACK.far;
const CENTER_Z = (TRACK.near - TRACK.far) / 2;

const VERTEX = /* glsl */ `
  uniform vec2 uCurve;
  uniform float uDist;
  varying vec2 vTrack;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vTrack = vec2(world.x, uDist - world.z);
    vec4 mvPosition = viewMatrix * world;
    mvPosition.xy += uCurve * (mvPosition.z * mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const LINE = /* glsl */ `
  float line(float c, float spacing, float width) {
    float f = abs(fract(c / spacing + 0.5) - 0.5) * spacing;
    return 1.0 - smoothstep(width, width + fwidth(c) * 1.5, f);
  }
`;

const TRACK_FRAGMENT = /* glsl */ `
  uniform float uDist;
  uniform float uPlayerX;
  uniform float uGlow;
  uniform float uHalfWidth;
  varying vec2 vTrack;
  #include <fog_pars_fragment>
  ${LINE}
  void main() {
    float x = vTrack.x;
    float s = vTrack.y;
    vec3 col = vec3(0.012, 0.008, 0.035);
    float lanes = line(x, 3.0, 0.035);
    col += vec3(0.0, 0.75, 1.0) * lanes * 0.35;
    col += vec3(0.55, 0.1, 1.0) * line(s, 6.0, 0.05) * 0.3;
    // Dashes on the lane dividers: the strongest speed cue.
    col += vec3(0.2, 0.9, 1.0) * line(x, 3.0, 0.07) * step(0.78, fract(s / 8.0)) * 0.6;
    col += vec3(1.0, 0.1, 0.65) * smoothstep(uHalfWidth - 0.5, uHalfWidth, abs(x)) * 0.8;
    vec2 d = vec2(x - uPlayerX, (s - uDist) * 0.55);
    col += vec3(0.0, 0.55, 1.0) * exp(-dot(d, d) * 0.45) * uGlow;
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

const GROUND_FRAGMENT = /* glsl */ `
  varying vec2 vTrack;
  #include <fog_pars_fragment>
  ${LINE}
  void main() {
    vec3 col = vec3(0.01, 0.0, 0.025);
    float g = max(line(vTrack.x, 10.0, 0.06), line(vTrack.y, 10.0, 0.06));
    col += vec3(0.7, 0.1, 0.9) * g * 0.35;
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

const RAIL_FRAGMENT = /* glsl */ `
  varying vec2 vTrack;
  #include <fog_pars_fragment>
  void main() {
    float pulse = step(0.85, fract(vTrack.y / 12.0));
    vec3 col = mix(vec3(1.0, 0.1, 0.6), vec3(0.3, 0.95, 1.0), pulse) * 0.9;
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

function material(fragmentShader: string, extra: Record<string, THREE.IUniform> = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uDist: { value: 0 }, ...extra }]),
  });
}

export class Track {
  readonly group = new THREE.Group();
  private materials: THREE.ShaderMaterial[] = [];
  private surface: THREE.ShaderMaterial;

  constructor() {
    this.surface = material(TRACK_FRAGMENT, {
      uPlayerX: { value: 0 },
      uGlow: { value: 0.5 },
      uHalfWidth: { value: TRACK.halfWidth },
    });
    const surfaceGeo = new THREE.PlaneGeometry(TRACK.halfWidth * 2, LENGTH, 8, 220);
    this.add(surfaceGeo, this.surface, 0, 0);

    const ground = material(GROUND_FRAGMENT);
    this.add(new THREE.PlaneGeometry(900, LENGTH, 40, 220), ground, -3.5, 0);

    const rail = material(RAIL_FRAGMENT);
    const railGeo = new THREE.BoxGeometry(0.25, 0.45, LENGTH, 1, 1, 220);
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(railGeo, rail);
      mesh.position.set(side * (TRACK.halfWidth + 0.15), 0.22, CENTER_Z);
      mesh.frustumCulled = false; // bent in the shader, so CPU bounds are wrong
      this.group.add(mesh);
    }
    this.materials.push(rail);

    // Shared bend uniform; ShaderMaterial uniforms are cloned by merge, so attach after.
    for (const m of this.materials) m.uniforms.uCurve = curve;
  }

  private add(geo: THREE.PlaneGeometry, mat: THREE.ShaderMaterial, y: number, x: number) {
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, CENTER_Z);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.materials.push(mat);
  }

  update(distance: number, playerX: number, glow: number): void {
    const wrapped = distance % WRAP;
    for (const m of this.materials) m.uniforms.uDist.value = wrapped;
    this.surface.uniforms.uPlayerX.value = playerX;
    this.surface.uniforms.uGlow.value = glow;
  }
}
