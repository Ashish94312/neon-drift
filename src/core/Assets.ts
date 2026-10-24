import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { bend } from "../world/CurvedWorld";
import craftUrl from "../models/vehicle_hovercraft_player.glb?url";
import barrierUrl from "../models/obstacle_hazard_barrier.glb?url";
import cellUrl from "../models/pickup_boost_cell.glb?url";

export interface ModelAsset {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

export interface Assets {
  craft: ModelAsset;
  barrier: ModelAsset;
  cell: ModelAsset;
  glow: THREE.Texture;
}

interface ModelOptions {
  /** Final size along one axis, in metres. */
  size: { axis: "x" | "y" | "z"; metres: number };
  rotateY?: number;
  /** Emissive mask: texels whose saturation·value falls in [lo, hi] fade in to full glow. */
  glow: { lo: number; hi: number; intensity: number };
  /** Multiplier on the base-colour texture; lifts near-black albedo so shapes read on a dark track. */
  albedo: number;
  metalness: number;
  roughness: number;
}

// The source models are AI-generated: no normals, no emissive map, unit-sized and quantized by
// meshopt. Everything is fixed here so the rest of the game gets clean, metre-scaled geometry.
async function loadModel(loader: GLTFLoader, url: string, opts: ModelOptions): Promise<ModelAsset> {
  const gltf = await loader.loadAsync(url);
  let source: THREE.Mesh | undefined;
  gltf.scene.traverse((o) => {
    if (!source && (o as THREE.Mesh).isMesh) source = o as THREE.Mesh;
  });
  if (!source) throw new Error(`No mesh in ${url}`);
  source.updateWorldMatrix(true, false);

  let geometry = toFloat(source.geometry).applyMatrix4(source.matrixWorld);
  if (opts.rotateY) geometry.rotateY(opts.rotateY);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const extent = box.getSize(new THREE.Vector3());
  const k = opts.size.metres / extent[opts.size.axis];
  geometry.scale(k, k, k);
  geometry.computeBoundingBox();
  const b = geometry.boundingBox!;
  // Centre on X/Z, sit the base on y = 0.
  geometry.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geometry = toCreasedNormals(geometry, THREE.MathUtils.degToRad(35));
  geometry.computeBoundingSphere();

  const original = source.material as THREE.MeshStandardMaterial;
  const map = original.map;
  const material = new THREE.MeshStandardMaterial({
    map,
    color: new THREE.Color().setScalar(opts.albedo),
    metalness: opts.metalness,
    roughness: opts.roughness,
    emissive: 0xffffff,
    emissiveIntensity: opts.glow.intensity,
    emissiveMap: map ? glowMask(map, opts.glow.lo, opts.glow.hi) : null,
  });
  return { geometry, material: bend(material) };
}

/** Copy every attribute into plain Float32 (meshopt quantizes to normalized ints). */
function toFloat(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const array = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < a.itemSize; c++) array[i * a.itemSize + c] = a.getComponent(i, c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, a.itemSize));
  }
  if (src.index) out.setIndex(Array.from(src.index.array));
  return out;
}

/** Emissive map from the bright, saturated texels of the base colour (the baked-in neon strips). */
function glowMask(map: THREE.Texture, lo: number, hi: number): THREE.Texture {
  const image = map.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const max = Math.max(d[i], d[i + 1], d[i + 2]);
    const min = Math.min(d[i], d[i + 1], d[i + 2]);
    const glow = max === 0 ? 0 : ((max - min) / max) * (max / 255);
    const w = THREE.MathUtils.smoothstep(glow, lo, hi);
    d[i] *= w;
    d[i + 1] *= w;
    d[i + 2] *= w;
  }
  ctx.putImageData(pixels, 0, 0);
  // Clone keeps the map's flipY / wrap / UV transform; a new Source avoids replacing the map's image.
  const mask = map.clone();
  mask.source = new THREE.TextureSource(canvas);
  mask.needsUpdate = true;
  return mask;
}

/** Soft radial sprite used for thruster glow. */
function glowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export async function loadAssets(): Promise<Assets> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [craft, barrier, cell] = await Promise.all([
    // Model nose faces +Z; the game drives toward −Z.
    loadModel(loader, craftUrl, {
      size: { axis: "z", metres: 3 },
      rotateY: Math.PI,
      glow: { lo: 0.25, hi: 0.45, intensity: 2.2 },
      albedo: 2.2,
      metalness: 0.45,
      roughness: 0.4,
    }),
    loadModel(loader, barrierUrl, {
      size: { axis: "x", metres: 3 },
      glow: { lo: 0.3, hi: 0.5, intensity: 1.4 },
      albedo: 2.6,
      metalness: 0.3,
      roughness: 0.55,
    }),
    loadModel(loader, cellUrl, {
      size: { axis: "y", metres: 1.1 },
      glow: { lo: 0.3, hi: 0.55, intensity: 1.6 },
      albedo: 1,
      metalness: 0.2,
      roughness: 0.3,
    }),
  ]);
  return { craft, barrier, cell, glow: glowTexture() };
}
