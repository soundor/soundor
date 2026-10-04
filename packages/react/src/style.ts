import type { Style } from 'soundor:ui';

/** A style, or several to merge (later wins), as in React Native. */
export type StyleProp<T = Style> =
  | T
  | null
  | undefined
  | false
  | readonly StyleProp<T>[];

/** Merges a StyleProp into one style object. */
export function flattenStyle<T extends object = Style>(
  style: StyleProp<T> | unknown,
): T {
  if (!style) return {} as T;
  if (!Array.isArray(style)) return style as T;
  const out: Record<string, unknown> = {};
  for (const part of style) Object.assign(out, flattenStyle<T>(part));
  return out as T;
}

/**
 * Names styles once, typed, for reuse (React Native's StyleSheet.create).
 * The objects are returned as they are.
 */
export const StyleSheet = {
  create<const Styles extends Record<string, Style>>(styles: Styles): Styles {
    return styles;
  },
  flatten: flattenStyle,
};
