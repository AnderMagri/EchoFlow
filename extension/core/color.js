/**
 * Colour maths for consistency measurement.
 *
 * The point here is *perceptual* distance. A palette with #333333, #343434 and
 * #353535 is not a three-colour palette — it is one colour that leaked three
 * times. Counting distinct strings would call it three; counting perceptual
 * clusters calls it one, and reports the leak. That difference is the whole
 * reason this file exists.
 *
 * @module core/color
 */

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i;
const FUNC = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i;

/**
 * @param {string} input any CSS colour a computed style can hand us
 * @returns {{r:number,g:number,b:number,a:number}|null} null for transparent/keyword
 */
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'none' || s === 'currentcolor') return null;

  let m = s.match(HEX3);
  if (m) return { r: parseInt(m[1] + m[1], 16), g: parseInt(m[2] + m[2], 16), b: parseInt(m[3] + m[3], 16), a: 1 };

  m = s.match(HEX6);
  if (m) {
    return {
      r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16),
      a: m[4] ? parseInt(m[4], 16) / 255 : 1,
    };
  }

  m = s.match(FUNC);
  if (m) {
    const a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: +m[1], g: +m[2], b: +m[3], a: Number.isFinite(a) ? a : 1 };
  }
  return null;
}

/** @param {{r:number,g:number,b:number}} c */
export function toHex({ r, g, b }) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

const srgbToLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** CIE XYZ (D65). */
function toXYZ({ r, g, b }) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  return {
    x: R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    y: R * 0.2126729 + G * 0.7151522 + B * 0.0721750,
    z: R * 0.0193339 + G * 0.1191920 + B * 0.9503041,
  };
}

const LAB_E = 216 / 24389, LAB_K = 24389 / 27;
const f = (t) => (t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116);

/** CIELAB, the space where numeric distance tracks what the eye reports. */
export function toLab(rgb) {
  const { x, y, z } = toXYZ(rgb);
  const fx = f(x / 0.95047), fy = f(y / 1.0), fz = f(z / 1.08883);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * CIE76 delta-E. Rough rule of thumb:
 *   < 1   invisible to anyone
 *   < 2.3 the "just noticeable difference" — below this, two tokens are one token
 *   < 5   a designer notices side by side, a user never does
 */
export function deltaE(c1, c2) {
  const a = toLab(c1), b = toLab(c2);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/** Relative luminance, WCAG 2.x. */
export function luminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** @param {{r:number,g:number,b:number}} c */
export function toHSL({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const l = (max + min) / 2;
  if (!d) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h = Math.round(h * 60);
  return { h: h < 0 ? h + 360 : h, s: s * 100, l: l * 100 };
}

/**
 * Chroma in Lab — how colourful, independent of how light.
 * Use this and not HSL saturation. HSL saturation is unstable at the extremes:
 * for #f8f9fa the denominator (1 - |2L-1|) collapses toward zero, so a 2/255
 * channel spread reports as 17% "saturation" and an off-white gets filed as a
 * brand colour. Lab chroma reports it as 0.6, which is what the eye says.
 */
export function chroma(rgb) {
  const { a, b } = toLab(rgb);
  return Math.hypot(a, b);
}

/**
 * Neutrals cluster differently from chromatic colours — a grey ramp is allowed
 * to be long, a brand ramp is not. Threshold in Lab chroma units.
 */
export function isNeutral(rgb, chromaThreshold = 6) {
  return chroma(rgb) <= chromaThreshold;
}
