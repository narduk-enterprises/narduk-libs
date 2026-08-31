import type { GridValueKind } from '../core/models.js'

/**
 * The GLSL the WebGL2 paths share, plus the handful of GL calls that always
 * come in the same shape.
 *
 * ## Why this is a module and not two copies
 *
 * There are now two WebGL2 consumers — the viewport backend
 * (`render/webgl2.ts`) and the tile baker (`tile/baker.ts`) — and the thing they
 * share is the part that must not diverge: the 2×2 NaN-aware kernel, the
 * log/linear normalization, the coverage rule, and the LUT read. A tile that
 * colors a value differently from the overlay drawn over the same water is the
 * exact failure `core/reference-render.ts` was written to prevent, and copying
 * the fragment source into a second file is how that happens.
 *
 * The two differ in **one** function: how a screen UV becomes a data UV. The
 * overlay's is an affine viewport transform; a tile's is the Web-Mercator
 * inverse. That is the `projection` parameter, and it is the only seam.
 */

export type GridShaderProjection = 'viewport' | 'mercator'

export function vertexShader(): string {
  return `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
  vUv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}`
}

export function stencilSnippet(): string {
  return `
uniform sampler2D stencil;
uniform int useStencil;
uniform vec2 stencilUvOffset;
uniform vec2 stencilUvScale;

float stencilAlpha(vec2 screenUv) {
  if (useStencil == 0) return 1.0;
  vec2 suv = stencilUvOffset + screenUv * stencilUvScale;
  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) return 0.0;
  return texture(stencil, suv).a;
}
`
}

/**
 * `dataUv` — the one function the two WebGL2 consumers do not share.
 *
 * `viewport` is the affine blit the overlay has always done: the caller's
 * `dataUvTransform` has already reduced the viewport and the bbox to an offset
 * and a scale.
 *
 * `mercator` is the tile inverse, with every term that can be differenced ahead
 * of time already differenced in double by `tileProjection` in
 * `tile/mercator.ts`. Read the measured precision table there before trusting
 * this at deep zoom: the `tileMercArg.x + screenUv.y * tileMercArg.y` addition
 * below is the dominant `highp float` error term, worth ~0.11 px of
 * registration at z15 and ~3.7 px at z20, and the reformulation is a modest win
 * over the naive form only above about z16.
 */
function projectionSnippet(projection: GridShaderProjection): string {
  if (projection === 'viewport') {
    return `
uniform vec2 uvOffset;
uniform vec2 uvScale;

vec2 dataUv(vec2 screenUv) {
  return uvOffset + screenUv * uvScale;
}
`
  }
  return `
uniform vec2 tileU;      // x: data u at screenUv.x = 0, y: du/dScreenUv.x
uniform vec2 tileMercArg; // x: pi*(1 - 2*worldV) at screenUv.y = 0, y: its derivative
uniform vec2 tileLat;     // x: bbox north, y: 1 / (north - south)

vec2 dataUv(vec2 screenUv) {
  float latitude = degrees(atan(sinh(tileMercArg.x + screenUv.y * tileMercArg.y)));
  return vec2(tileU.x + screenUv.x * tileU.y, (tileLat.x - latitude) * tileLat.y);
}
`
}

function gridPositionSnippet(): string {
  return `
/** uv -> texel-center space; the two anchors differ by exactly half a cell. */
vec2 gridPosition(vec2 uv, vec2 size) {
  return anchorCenter == 1 ? uv * (size - 1.0) : uv * size - 0.5;
}
`
}

/**
 * The scalar pass, in whichever value dialect the frames arrived in.
 *
 * The only textual difference between the two dialect variants is the sampler
 * type; `float(texelFetch(...).r)` is well-formed for both a `uint` and a
 * `float` channel, and `displayValue` is the identity for `float32` because
 * those samples are already in display units.
 *
 * Exported so its **structure** can be asserted. There is no GL context in a
 * Node test and this package takes no dependency to invent one, so the
 * alternative to a structural check is no check at all — and the thing most
 * worth checking is exactly the thing a reviewer cannot see by reading: whether
 * this shader normalizes over `displayRange` while decoding over `valueRange`,
 * and whether it guards both the way the CPU reference does.
 * `tests/display-range-render.test.ts` asserts that. Full pixel parity against a
 * real GPU remains the browser leg's job.
 *
 * Not re-exported from the package barrel: this is a seam for the repository's
 * own tests, not API.
 */
export function scalarFragmentShader(
  valueKind: GridValueKind,
  projection: GridShaderProjection = 'viewport',
): string {
  const float32 = valueKind === 'float32'
  const sampler = float32 ? 'sampler2D' : 'usampler2D'
  const decode = float32
    ? `float displayValue(float raw) { return raw; }`
    : `float displayValue(float encoded) {
  float normalized = encoded / 65535.0;
  if (scaleLog == 1 && valueRange.x > 0.0 && valueRange.y > 0.0) {
    return exp2(log2(valueRange.x) + normalized * (log2(valueRange.y) - log2(valueRange.x)));
  }
  return valueRange.x + normalized * (valueRange.y - valueRange.x);
}`

  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
in vec2 vUv;
uniform ${sampler} values0;
uniform ${sampler} values1;
uniform usampler2D mask0;
uniform usampler2D mask1;
uniform sampler2D lut;
uniform float progress;
uniform vec2 valueRange;
uniform vec2 displayRange;
uniform int scaleLog;
uniform int coastal;
uniform int anchorCenter;
${projectionSnippet(projection)}
${stencilSnippet()}
out vec4 color;

${decode}
${gridPositionSnippet()}

/**
 * The 2x2 NaN-aware kernel. Literal port of GeoGridKit's
 * sampleScalarBilinearSoft / sampleScalarBilinearCoastal.
 *
 * A missing texel is skipped rather than substituted, and the surviving weights
 * are renormalized. The mask decides, never isnan(): under fast-math several
 * drivers fold x != x to false, and every hole would then sample as garbage.
 * Note the value is never even read for a masked-out texel, so a NaN in an R32F
 * plane cannot leak into the sum through a zero weight.
 *
 * Returns vec3(value, coverage, weightSum).
 */
vec3 sampleScalar(${sampler} values, usampler2D mask, vec2 pos) {
  vec2 size = vec2(textureSize(values, 0));
  vec2 maxPos = size - 1.0;
  vec2 p = clamp(pos, vec2(0.0), maxPos);
  vec2 base = floor(p);
  vec2 f = p - base;
  ivec2 i0 = ivec2(base);
  ivec2 i1 = ivec2(min(base + 1.0, maxPos));

  float w[4];
  w[0] = (1.0 - f.x) * (1.0 - f.y);
  w[1] = f.x * (1.0 - f.y);
  w[2] = (1.0 - f.x) * f.y;
  w[3] = f.x * f.y;
  ivec2 texels[4];
  texels[0] = ivec2(i0.x, i0.y);
  texels[1] = ivec2(i1.x, i0.y);
  texels[2] = ivec2(i0.x, i1.y);
  texels[3] = ivec2(i1.x, i1.y);

  float valueSum = 0.0;
  float weightSum = 0.0;
  float missingWeight = 0.0;
  for (int i = 0; i < 4; i++) {
    if (w[i] <= 0.0) continue;
    if (texelFetch(mask, texels[i], 0).r != uint(0)) {
      valueSum += w[i] * float(texelFetch(values, texels[i], 0).r);
      weightSum += w[i];
    } else {
      missingWeight += w[i];
    }
  }
  if (weightSum <= 0.0) return vec3(0.0);
  float cov = coastal == 1 ? weightSum : (missingWeight > 0.0 ? 0.0 : 1.0);
  return vec3(valueSum / weightSum, cov, weightSum);
}

/**
 * Port of normalizedScalar; -1.0 stands for "outside the sampling domain".
 *
 * Normalizes over displayRange, never valueRange -- the stretch is a render
 * decision and the wire domain has already done its one job in displayValue
 * above. Both are guarded, and both collapse onto the same numbers on an
 * unstretched layer, so the CPU reference's twin guard stays a mirror.
 * (No backticks in here: this whole shader lives inside a template literal.)
 */
float normalizedScalar(float value) {
  // Negated less-than rather than greater-or-equal, so a NaN bound is rejected
  // too: every comparison against NaN is false, so !(x < y) is true where
  // x >= y is false. An inverted range used to fall straight through here and
  // render the ramp backwards. The CPU guard is written the same way, on
  // purpose, so both paths agree on a corrupt range rather than one painting.
  if (!(valueRange.x < valueRange.y)) return -1.0;
  if (!(displayRange.x < displayRange.y)) return -1.0;
  if (scaleLog == 1) {
    if (value <= 0.0 || displayRange.x <= 0.0 || displayRange.y <= 0.0) return -1.0;
    return clamp(
      (log2(value) - log2(displayRange.x)) / (log2(displayRange.y) - log2(displayRange.x)),
      0.0,
      1.0);
  }
  return clamp((value - displayRange.x) / (displayRange.y - displayRange.x), 0.0, 1.0);
}

void main() {
  vec2 uv = dataUv(vUv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { color = vec4(0.0); return; }
  vec3 s0 = sampleScalar(values0, mask0, gridPosition(uv, vec2(textureSize(values0, 0))));
  vec3 s1 = sampleScalar(values1, mask1, gridPosition(uv, vec2(textureSize(values1, 0))));
  bool valid0 = s0.y > 0.0;
  bool valid1 = s1.y > 0.0;
  if (!valid0 && !valid1) { color = vec4(0.0); return; }

  // Blend in sample space (encoded for the u16 dialect, display units for
  // float32), then decode once — the log wire quantization is only linear there.
  float raw0 = valid0 ? s0.x : s1.x;
  float raw1 = valid1 ? s1.x : s0.x;
  float normalized = normalizedScalar(displayValue(mix(raw0, raw1, progress)));
  // Negated, so a NaN is caught: NaN < 0.0 is false and would otherwise let a
  // NaN through to index the LUT. The mask prevents that for any frame this
  // package decoded, but GridFrame is a public type -- a caller can hand over a
  // mask claiming a NaN cell is real, and clamp() on a NaN is not defined to
  // rescue it. Costs one token and needs no isnan().
  if (!(normalized >= 0.0)) { color = vec4(0.0); return; }

  float cov0 = valid0 ? s0.y : s1.y;
  float cov1 = valid1 ? s1.y : s0.y;
  float coverage = mix(cov0, cov1, progress);
  if (coastal == 1) coverage = smoothstep(0.0, 0.55, coverage);

  vec4 ramp = texture(lut, vec2(normalized, 0.5));
  float alpha = ramp.a * coverage * stencilAlpha(vUv);
  if (alpha <= 0.0) { color = vec4(0.0); return; }
  color = vec4(ramp.rgb, alpha);
}`
}

export function rgbFragmentShader(): string {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
in vec2 vUv;
uniform sampler2D values0;
uniform sampler2D values1;
uniform usampler2D mask0;
uniform usampler2D mask1;
uniform sampler2D green0;
uniform sampler2D green1;
uniform sampler2D blue0;
uniform sampler2D blue1;
uniform float progress;
uniform vec2 uvOffset;
uniform vec2 uvScale;
uniform int coastal;
uniform int anchorCenter;
${stencilSnippet()}
${gridPositionSnippet()}
out vec4 color;

/**
 * Mask-aware 2x2 RGB bilinear. Missing colors are never read or replaced with
 * black; the real neighbors are renormalized and alpha carries their support.
 */
struct RgbSample {
  vec3 color;
  float coverage;
  bool nearestValid;
};

RgbSample sampleRgb(sampler2D r, sampler2D g, sampler2D b, usampler2D mask, vec2 pos) {
  vec2 size = vec2(textureSize(r, 0));
  vec2 maxPos = size - 1.0;
  vec2 p = clamp(pos, vec2(0.0), maxPos);
  // Preserve the old R8UI NEAREST lookup exactly. This hard gate is before
  // any RGB read: a valid 2x2 neighbor may improve a visible cell's color,
  // but can never make the nearest-invalid cell visible.
  ivec2 nearest = clamp(ivec2(floor(p + vec2(0.5))), ivec2(0), ivec2(maxPos));
  if (texelFetch(mask, nearest, 0).r == uint(0)) {
    return RgbSample(vec3(0.0), 0.0, false);
  }
  vec2 base = floor(p);
  vec2 f = p - base;
  ivec2 i0 = ivec2(base);
  ivec2 i1 = ivec2(min(base + 1.0, maxPos));

  float w[4];
  w[0] = (1.0 - f.x) * (1.0 - f.y);
  w[1] = f.x * (1.0 - f.y);
  w[2] = (1.0 - f.x) * f.y;
  w[3] = f.x * f.y;
  ivec2 texels[4];
  texels[0] = ivec2(i0.x, i0.y);
  texels[1] = ivec2(i1.x, i0.y);
  texels[2] = ivec2(i0.x, i1.y);
  texels[3] = ivec2(i1.x, i1.y);

  vec3 colorSum = vec3(0.0);
  float weightSum = 0.0;
  float missingWeight = 0.0;
  for (int i = 0; i < 4; i++) {
    if (w[i] <= 0.0) continue;
    if (texelFetch(mask, texels[i], 0).r != uint(0)) {
      colorSum += w[i] * vec3(
        texelFetch(r, texels[i], 0).r,
        texelFetch(g, texels[i], 0).r,
        texelFetch(b, texels[i], 0).r);
      weightSum += w[i];
    } else {
      missingWeight += w[i];
    }
  }
  if (weightSum <= 0.0) return RgbSample(vec3(0.0), 0.0, true);
  float coverage = coastal == 1 ? weightSum : (missingWeight > 0.0 ? 0.0 : 1.0);
  return RgbSample(colorSum / weightSum, coverage, true);
}

void main() {
  vec2 uv = uvOffset + vUv * uvScale;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { color = vec4(0.0); return; }
  RgbSample sampled0 = sampleRgb(
    values0, green0, blue0, mask0,
    gridPosition(uv, vec2(textureSize(values0, 0))));
  RgbSample sampled1 = sampleRgb(
    values1, green1, blue1, mask1,
    gridPosition(uv, vec2(textureSize(values1, 0))));
  bool valid0 = sampled0.nearestValid;
  bool valid1 = sampled1.nearestValid;
  if (!valid0 && !valid1) { color = vec4(0.0); return; }
  vec3 first = sampled0.color;
  vec3 second = sampled1.color;
  if (!valid0) first = second;
  if (!valid1) second = first;
  float coverage0 = valid0 ? sampled0.coverage : sampled1.coverage;
  float coverage1 = valid1 ? sampled1.coverage : sampled0.coverage;
  float coverage = mix(coverage0, coverage1, progress);
  // The valid0/valid1 check above is the hard legacy footprint gate. This only
  // attenuates that already-visible footprint toward unsupported neighbors.
  if (coastal == 1) coverage = smoothstep(0.25, 1.0, coverage);
  float alpha = coverage * stencilAlpha(vUv);
  if (alpha <= 0.0) { color = vec4(0.0); return; }
  color = vec4(mix(first, second, progress), alpha);
}`
}

/**
 * Scale-aware temporal RGB shader.
 *
 * Each frame occupies two RGBA8 textures: base RGB + observed confidence, then
 * observed RGB + a packed validity byte. Bit 0 of that byte is base-valid and
 * bit 1 is observed-valid. All reads use `texelFetch`; the packed flags are
 * never filtered. Base/detail composition and lower/upper temporal blend both
 * happen in linear-sRGB before the final display-sRGB encode.
 */
export function rgbCompositionFragmentShader(): string {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D baseConfidence0;
uniform sampler2D observedMasks0;
uniform sampler2D baseConfidence1;
uniform sampler2D observedMasks1;
uniform float progress;
uniform float observationWeight;
uniform vec2 uvOffset;
uniform vec2 uvScale;
uniform int coastal;
uniform int anchorCenter;
${stencilSnippet()}
${gridPositionSnippet()}
out vec4 color;

const int BASE_VALID = 1;
const int OBSERVED_VALID = 2;

struct ComponentSample {
  vec3 color;
  float confidence;
  float coverage;
  bool nearestValid;
};

struct FrameSample {
  vec3 color;
  float coverage;
  bool nearestValid;
};

vec3 srgbToLinear(vec3 value) {
  vec3 low = value / 12.92;
  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), value));
}

vec3 linearToSrgb(vec3 value) {
  vec3 bounded = clamp(value, vec3(0.0), vec3(1.0));
  vec3 low = bounded * 12.92;
  vec3 high = 1.055 * pow(bounded, vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), bounded));
}

/** Mask-aware 2x2 sample. Packed validity is fetched as a byte, never filtered. */
ComponentSample sampleComponent(
  sampler2D colors,
  sampler2D confidenceTexture,
  sampler2D packedMasks,
  int maskBit,
  vec2 pos
) {
  vec2 size = vec2(textureSize(colors, 0));
  vec2 maxPos = size - 1.0;
  vec2 p = clamp(pos, vec2(0.0), maxPos);
  // Match the previous packed-mask nearest lookup before reading a single
  // color or confidence byte. Base and observed have independent support.
  ivec2 nearest = clamp(ivec2(floor(p + vec2(0.5))), ivec2(0), ivec2(maxPos));
  int nearestFlags = int(round(texelFetch(packedMasks, nearest, 0).a * 255.0));
  if ((nearestFlags & maskBit) == 0) {
    return ComponentSample(vec3(0.0), 0.0, 0.0, false);
  }
  vec2 base = floor(p);
  vec2 f = p - base;
  ivec2 i0 = ivec2(base);
  ivec2 i1 = ivec2(min(base + 1.0, maxPos));

  float w[4];
  w[0] = (1.0 - f.x) * (1.0 - f.y);
  w[1] = f.x * (1.0 - f.y);
  w[2] = (1.0 - f.x) * f.y;
  w[3] = f.x * f.y;
  ivec2 texels[4];
  texels[0] = ivec2(i0.x, i0.y);
  texels[1] = ivec2(i1.x, i0.y);
  texels[2] = ivec2(i0.x, i1.y);
  texels[3] = ivec2(i1.x, i1.y);

  vec3 colorSum = vec3(0.0);
  float confidenceSum = 0.0;
  float weightSum = 0.0;
  float missingWeight = 0.0;
  for (int i = 0; i < 4; i++) {
    if (w[i] <= 0.0) continue;
    int flags = int(round(texelFetch(packedMasks, texels[i], 0).a * 255.0));
    if ((flags & maskBit) != 0) {
      colorSum += w[i] * texelFetch(colors, texels[i], 0).rgb;
      confidenceSum += w[i] * texelFetch(confidenceTexture, texels[i], 0).a;
      weightSum += w[i];
    } else {
      missingWeight += w[i];
    }
  }
  if (weightSum <= 0.0) return ComponentSample(vec3(0.0), 0.0, 0.0, true);
  float coverage = coastal == 1 ? weightSum : (missingWeight > 0.0 ? 0.0 : 1.0);
  return ComponentSample(colorSum / weightSum, confidenceSum / weightSum, coverage, true);
}

/** Compose one date in linear-sRGB while preserving independent support. */
FrameSample composeFrame(sampler2D baseConfidence, sampler2D observedMasks, vec2 pos) {
  ComponentSample base = sampleComponent(
    baseConfidence, baseConfidence, observedMasks, BASE_VALID, pos);
  ComponentSample observed = sampleComponent(
    observedMasks, baseConfidence, observedMasks, OBSERVED_VALID, pos);
  bool validBase = base.nearestValid;
  bool validObserved = observed.nearestValid;
  if (!validBase && !validObserved) return FrameSample(vec3(0.0), 0.0, false);
  vec3 baseLinear = srgbToLinear(base.color);
  vec3 observedLinear = srgbToLinear(observed.color);
  if (!validBase) return FrameSample(observedLinear, observed.coverage, true);
  if (!validObserved) return FrameSample(baseLinear, base.coverage, true);
  float weight = clamp(observationWeight, 0.0, 1.0) * clamp(observed.confidence, 0.0, 1.0);
  return FrameSample(
    mix(baseLinear, observedLinear, weight),
    mix(base.coverage, observed.coverage, weight),
    true);
}

void main() {
  vec2 uv = uvOffset + vUv * uvScale;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    color = vec4(0.0);
    return;
  }
  vec2 pos0 = gridPosition(uv, vec2(textureSize(baseConfidence0, 0)));
  vec2 pos1 = gridPosition(uv, vec2(textureSize(baseConfidence1, 0)));
  FrameSample sampled0 = composeFrame(baseConfidence0, observedMasks0, pos0);
  FrameSample sampled1 = composeFrame(baseConfidence1, observedMasks1, pos1);
  bool valid0 = sampled0.nearestValid;
  bool valid1 = sampled1.nearestValid;
  if (!valid0 && !valid1) { color = vec4(0.0); return; }
  vec3 first = valid0 ? sampled0.color : sampled1.color;
  vec3 second = valid1 ? sampled1.color : first;
  float coverage0 = valid0 ? sampled0.coverage : sampled1.coverage;
  float coverage1 = valid1 ? sampled1.coverage : coverage0;
  float coverage = mix(coverage0, coverage1, progress);
  if (coastal == 1) coverage = smoothstep(0.25, 1.0, coverage);
  float alpha = coverage * stencilAlpha(vUv);
  if (alpha <= 0.0) { color = vec4(0.0); return; }
  color = vec4(linearToSrgb(mix(first, second, progress)), alpha);
}`
}

export function setClampFilter(gl: WebGL2RenderingContext, filter: number): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
}

export function setClampNearest(gl: WebGL2RenderingContext): void {
  setClampFilter(gl, gl.NEAREST)
}

export function bindTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture,
  location: WebGLUniformLocation | null,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.uniform1i(location, unit)
}

/**
 * Compile and link, leaking nothing on the failure paths.
 *
 * Every caller swallows the throw and falls back to drawing nothing, so a
 * shader that fails to compile on some driver would otherwise leak a shader
 * object — and its sibling, and possibly the program — on every single render
 * attempt, for as long as the renderer lives.
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  let vertex: WebGLShader | null = null
  let fragment: WebGLShader | null = null
  let program: WebGLProgram | null = null
  try {
    vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
    program = gl.createProgram()
    if (!program) throw new Error('WebGL program unavailable')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || 'WebGL link failed'
      gl.deleteProgram(program)
      program = null
      throw new Error(log)
    }
    return program
  } catch (error: unknown) {
    if (program) gl.deleteProgram(program)
    throw error
  } finally {
    // Safe once attached: deletion is deferred until the program releases them.
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('WebGL shader unavailable')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'WebGL compile failed')
  }
  return shader
}
