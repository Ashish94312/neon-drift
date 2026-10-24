import * as THREE from "three";
import { TRACK } from "../core/Config";
import { bend, curve, BEND_GLSL } from "./CurvedWorld";

const HALF = TRACK.halfWidth + 0.9;
const HEIGHT = 7.4;

const CURTAIN_VERTEX = /* glsl */ `
  uniform vec2 uCurve;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    ${BEND_GLSL}
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// Scanlines rising through the gate; fades with fog instead of tinting (it's additive).
const CURTAIN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    float lines = smoothstep(0.82, 1.0, fract(vUv.y * 14.0 - uTime * 1.5));
    float edge = smoothstep(0.08, 0.0, min(vUv.x, 1.0 - vUv.x));
    float a = 0.04 + lines * 0.2 + edge * 0.3;
    #ifdef USE_FOG
      a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    gl_FragColor = vec4(vec3(0.2, 0.9, 1.0) * 1.4, a);
  }
`;

// Neon arch spanning the track every km, with a lit distance sign on top.
export class Checkpoint {
  readonly group = new THREE.Group();
  private curtain: THREE.ShaderMaterial;
  private sign: THREE.CanvasTexture;
  private km = -1;

  constructor() {
    const frame = bend(new THREE.MeshStandardMaterial({ color: 0x120a20, metalness: 0.6, roughness: 0.35 }));
    const cyan = bend(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x00e5ff).multiplyScalar(2.6) }));
    const magenta = bend(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2bd6).multiplyScalar(2.2) }));
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.frustumCulled = false;
      this.group.add(m);
    };
    for (const side of [-1, 1]) {
      box(0.7, HEIGHT, 0.7, side * HALF, HEIGHT / 2, 0, frame);
      box(0.12, HEIGHT - 0.4, 0.12, side * (HALF - 0.4), HEIGHT / 2 - 0.2, 0.36, cyan);
      box(0.12, HEIGHT, 0.12, side * (HALF + 0.4), HEIGHT / 2, 0.36, magenta);
    }
    box(HALF * 2 + 0.7, 0.7, 0.7, 0, HEIGHT, 0, frame);
    box(HALF * 2 - 0.8, 0.12, 0.12, 0, HEIGHT - 0.4, 0.36, cyan);

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    this.sign = new THREE.CanvasTexture(canvas);
    this.sign.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(5.4, 1.35),
      bend(new THREE.MeshBasicMaterial({ map: this.sign, transparent: true, color: new THREE.Color(1.6, 1.6, 1.6), depthWrite: false })),
    );
    sign.position.set(0, HEIGHT + 1.15, 0.2);
    sign.frustumCulled = false;
    this.group.add(sign);

    this.curtain = new THREE.ShaderMaterial({
      vertexShader: CURTAIN_VERTEX,
      fragmentShader: CURTAIN_FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.curtain.uniforms.uCurve = curve;
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 - 0.7, HEIGHT - 0.35, 1, 8), this.curtain);
    curtain.position.y = (HEIGHT - 0.35) / 2;
    curtain.frustumCulled = false;
    this.group.add(curtain);
    this.group.visible = false;
  }

  private setKm(km: number): void {
    if (km === this.km) return;
    this.km = km;
    const c = this.sign.image as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = 'italic 800 96px "Saira", system-ui, sans-serif';
    ctx.fontStretch = "expanded";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f1edff";
    ctx.fillText(`${km} km`, c.width / 2, c.height / 2 + 4);
    this.sign.needsUpdate = true;
  }

  /** Show the gate for `km` at view-space z, or hide it with null. */
  place(km: number | null, z: number, time: number): void {
    this.group.visible = km !== null;
    if (km === null) return;
    this.setKm(km);
    this.group.position.z = z;
    this.curtain.uniforms.uTime.value = time;
  }
}
