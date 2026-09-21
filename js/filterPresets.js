// CSS-syntax filter presets, used for canvas (ctx.filter) and live <video> preview.
export const CSS_PRESETS = {
  none: '',
  bw: 'grayscale(1)',
  sepia: 'sepia(0.8)',
  vintage: 'sepia(0.35) contrast(0.9) brightness(1.05) saturate(0.75)',
  cold: 'brightness(1.02) contrast(1.05) saturate(0.9) hue-rotate(15deg)',
  warm: 'brightness(1.03) contrast(1.02) saturate(1.1) hue-rotate(-12deg) sepia(0.12)',
  vivid: 'saturate(1.6) contrast(1.15) brightness(1.03)',
};

export function buildCssFilter({ brightness = 100, contrast = 100, saturate = 100, blur = 0, preset = 'none' }) {
  const base = CSS_PRESETS[preset] || '';
  const adj = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%)${blur ? ` blur(${blur}px)` : ''}`;
  return `${base} ${adj}`.trim();
}
