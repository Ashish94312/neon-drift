import * as THREE from "three";

const VERTEX = /* glsl */ `
  attribute float aLife;
  uniform float uScale;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uScale * (0.4 + aLife) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vLife;
  void main() {
    float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vLife;
    gl_FragColor = vec4(uColor, a);
  }
`;

const LIFETIME = 0.35;

// Thruster exhaust: a ring buffer of additive points left behind as the world scrolls past.
export class Trail {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private life: Float32Array;
  private next = 0;
  private material: THREE.ShaderMaterial;

  constructor(private count = 240) {
    this.pos = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aLife", new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uColor: { value: new THREE.Color() }, uScale: { value: 300 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setPixelScale(heightPx: number): void {
    this.material.uniforms.uScale.value = heightPx * 0.16;
  }

  emit(p: THREE.Vector3): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.12;
    this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.12;
    this.pos[i * 3 + 2] = p.z;
    this.life[i] = 1;
  }

  update(dt: number, scroll: number, boosting: boolean): void {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] = Math.max(0, this.life[i] - dt / LIFETIME);
      this.pos[i * 3 + 2] += scroll * dt * 0.85;
    }
    this.material.uniforms.uColor.value.set(boosting ? 0xff5ae6 : 0x00e5ff).multiplyScalar(boosting ? 1.4 : 0.9);
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aLife.needsUpdate = true;
  }
}
