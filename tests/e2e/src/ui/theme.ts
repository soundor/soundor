import { StyleSheet } from '@soundor/react';

/**
 * The colors the tests read back from screenshots (e2e/rendering.test.ts):
 * pure, opaque and far apart, so a pixel is one or the other.
 */
export const swatch = {
  view: '#ff0000',
  canvas: '#00ff00',
  webgl: '#0000ff',
  image: '#ff00ff',
} as const;

export const colors = {
  background: '#202020',
  panel: '#2c2c2c',
  control: '#3c3c3c',
  accent: '#ffcc00',
  text: '#f0f0f0',
  muted: '#a0a0a0',
} as const;

export const text = StyleSheet.create({
  body: { color: colors.text, fontSize: 13 },
  muted: { color: colors.muted, fontSize: 12 },
});
