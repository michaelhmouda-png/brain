export type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

function assertChannel(channel: number): number {
  if (!Number.isFinite(channel) || channel < 0 || channel > 255) {
    throw new RangeError('RGB channels must be finite numbers between 0 and 255.');
  }
  return channel;
}

export function parseHexColor(value: string): RgbColor {
  const normalized = value.trim().replace(/^#/, '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((character) => `${character}${character}`).join('')
    : normalized;

  if (!/^[\da-f]{6}$/i.test(expanded)) {
    throw new TypeError(`Expected a three- or six-digit hexadecimal color, received "${value}".`);
  }

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

export function linearizeSrgbChannel(channel: number): number {
  const srgb = assertChannel(channel) / 255;
  return srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: RgbColor | string): number {
  const { red, green, blue } = typeof color === 'string' ? parseHexColor(color) : color;
  return (
    0.2126 * linearizeSrgbChannel(red)
    + 0.7152 * linearizeSrgbChannel(green)
    + 0.0722 * linearizeSrgbChannel(blue)
  );
}

export function contrastRatio(foreground: RgbColor | string, background: RgbColor | string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}
