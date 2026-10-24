import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Rng } from "../core/Rng";
import { bend, curve, BEND_GLSL } from "./CurvedWorld";

// Horizon colour, shared by fog and sky so distant geometry dissolves into the sky.
const HORIZON = new THREE.Color().setRGB(0.07, 0.012, 0.12, THREE.LinearSRGBColorSpace);

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec2 uCurve;
  uniform vec3 uHorizon;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    vec3 col = mix(uHorizon, vec3(0.0, 0.0, 0.012), smoothstep(0.0, 0.45, d.y));
    col = mix(col, vec3(0.02, 0.0, 0.04), smoothstep(0.0, -0.2, d.y));
    // Synthwave sun, nudged toward where the bent track leads.
    vec3 sunDir = normalize(vec3(uCurve.x * 380.0, 0.2 + uCurve.y * 380.0, -1.0));
    float ang = acos(clamp(dot(d, sunDir), -1.0, 1.0));
    float disc = 1.0 - smoothstep(0.17, 0.175, ang);
    float t = clamp((d.y - sunDir.y + 0.17) / 0.34, 0.0, 1.0);
    vec3 sunCol = mix(vec3(1.0, 0.08, 0.5), vec3(1.0, 0.85, 0.2), t);
    float band = fract((d.y - sunDir.y) * 55.0);
    float cut = t > 0.55 ? 1.0 : step((0.55 - t) * 1.2, band);
    col += sunCol * disc * cut * 0.8;
    col += vec3(1.0, 0.2, 0.6) * exp(-ang * ang * 18.0) * 0.1;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const DUST_VERTEX = /* glsl */ `
  uniform vec2 uCurve;
  uniform float uOffset;
  uniform float uScale;
  varying float vFade;
  void main() {
    vec3 p = position;
    p.z = mod(p.z + uOffset, 330.0) - 300.0;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    ${BEND_GLSL}
    vFade = smoothstep(-300.0, -200.0, p.z) * smoothstep(20.0, 4.0, p.z);
    gl_PointSize = uScale / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const DUST_FRAGMENT = /* glsl */ `
  varying float vFade;
  void main() {
    float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vFade;
    gl_FragColor = vec4(vec3(0.5, 0.85, 1.0) * 1.3, a);
  }
`;

interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

const SKYLINE = { count: 150, zMin: -470, zMax: 40 };

export class Environment {
  private sky: THREE.Mesh;
  private dust: THREE.Points;
  private dustMat: THREE.ShaderMaterial;
  private buildings: Building[] = [];
  private blocks: THREE.InstancedMesh;
  private caps: THREE.InstancedMesh;
  private strips: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    scene.background = HORIZON.clone();
    scene.fog = new THREE.Fog(HORIZON.clone(), 110, 400);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.6;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0x8a5cff, 0x080010, 0.7));
    // Key light from behind the camera, so the faces the player sees are lit.
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 8, 12);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x00e5ff, 0.6);
    rim.position.set(-6, 3, -10);
    scene.add(rim);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms: { uCurve: curve, uHorizon: { value: HORIZON } },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    const rng = new Rng(7);
    for (let i = 0; i < SKYLINE.count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (22 + rng.next() * 75);
      this.buildings.push({
        x,
        z: rng.range(SKYLINE.zMin, SKYLINE.zMax),
        w: rng.range(4, 12),
        d: rng.range(4, 12),
        h: (6 + Math.pow(rng.next(), 2) * 55) * (0.6 + Math.abs(x) / 80),
      });
    }
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.blocks = this.instanced(box, bend(new THREE.MeshStandardMaterial({ color: 0x0a0618, roughness: 0.85, metalness: 0.2 })));
    this.caps = this.instanced(box, bend(new THREE.MeshBasicMaterial({ color: 0xffffff })));
    this.strips = this.instanced(box, bend(new THREE.MeshBasicMaterial({ color: 0xffffff })));
    const neon = [new THREE.Color(0x00e5ff), new THREE.Color(0xff2bd6), new THREE.Color(0x8a5cff)];
    this.buildings.forEach((_, i) => {
      const c = neon[rng.int(0, neon.length - 1)].clone().multiplyScalar(2.2);
      this.caps.setColorAt(i, c);
      this.strips.setColorAt(i, c.clone().multiplyScalar(0.7));
    });

    const dustCount = 600;
    const pos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      pos[i * 3] = rng.range(-40, 40);
      pos[i * 3 + 1] = rng.range(-2, 14);
      pos[i * 3 + 2] = rng.range(0, 330);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      uniforms: { uCurve: curve, uOffset: { value: 0 }, uScale: { value: 60 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(dustGeo, this.dustMat);
    this.dust.frustumCulled = false;
    scene.add(this.dust);
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, SKYLINE.count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  setPixelScale(heightPx: number): void {
    this.dustMat.uniforms.uScale.value = heightPx * 0.09;
  }

  update(distance: number, camera: THREE.Camera): void {
    this.sky.position.copy(camera.position);
    this.dustMat.uniforms.uOffset.value = distance % 330;

    const span = SKYLINE.zMax - SKYLINE.zMin;
    const o = this.dummy;
    this.buildings.forEach((b, i) => {
      const z = (((b.z + distance - SKYLINE.zMin) % span) + span) % span + SKYLINE.zMin;
      o.position.set(b.x, -3.5, z);
      o.scale.set(b.w, b.h, b.d);
      o.updateMatrix();
      this.blocks.setMatrixAt(i, o.matrix);
      o.position.y = -3.5 + b.h;
      o.scale.set(b.w * 1.02, 0.35, b.d * 1.02);
      o.updateMatrix();
      this.caps.setMatrixAt(i, o.matrix);
      // Vertical neon strip on the face toward the track.
      o.position.set(b.x - Math.sign(b.x) * (b.w / 2 + 0.05), -3.5, z);
      o.scale.set(0.12, b.h * 0.85, 0.5);
      o.updateMatrix();
      this.strips.setMatrixAt(i, o.matrix);
    });
    this.blocks.instanceMatrix.needsUpdate = true;
    this.caps.instanceMatrix.needsUpdate = true;
    this.strips.instanceMatrix.needsUpdate = true;
  }
}
