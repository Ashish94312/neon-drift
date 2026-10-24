import * as THREE from "three";

// "Curved world": every vertex is pushed sideways/up by k·z² in view space. The track reads as
// curving and climbing while gameplay stays on a straight 2D plane.
export const curve = { value: new THREE.Vector2() };

export const BEND_GLSL = /* glsl */ `mvPosition.xy += uCurve * (mvPosition.z * mvPosition.z);`;

/** Patch a built-in material so it follows the bend. */
export function bend<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCurve = curve;
    shader.vertexShader =
      "uniform vec2 uCurve;\n" +
      shader.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>\n${BEND_GLSL}\ngl_Position = projectionMatrix * mvPosition;`,
      );
  };
  material.customProgramCacheKey = () => "bend";
  return material;
}
