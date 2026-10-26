/**
 * Bump mapping without a texture or UVs: a height pattern computed in the fragment shader (from world or local
 * position) tilts the normal by its screen-space derivatives (three.js's perturbNormalArb, here under its own
 * name so it does not clash when a material has a bump map). Detail fades with distance so it does not shimmer.
 * Used for slate courses and render on buildings, grass and rock on the ground, leaf clumps on trees.
 */
export const BUMP_GLSL = `
vec3 bumpTilt(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
float bumpFade(float near, float far) {
  return smoothstep(far, near, length(vViewPosition));
}
`;

/** GLSL that tilts `normal` by the height `h` (an expression) with a strength, fading out by `far` metres. */
export function bumpBlock(h: string, strength: number, near: number, far: number): string {
  return `{
    float bumpH = ${h};
    float bumpK = ${strength.toFixed(3)} * bumpFade(${near.toFixed(1)}, ${far.toFixed(1)});
    if (bumpK > 0.0) normal = bumpTilt(-vViewPosition, normal, vec2(dFdx(bumpH), dFdy(bumpH)) * bumpK, faceDirection);
  }`;
}
