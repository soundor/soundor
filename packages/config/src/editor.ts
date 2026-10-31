/**
 * The plugin editor's size: shared by every runtime, so the JUCE editor and
 * the Web host's plugin view open at the same size and resize within the
 * same limits. Runtimes read it through {@link resolveEditor}, never with
 * defaults of their own.
 */

import { z } from 'zod';

import type { ConfigIssue } from './errors';

/**
 * The plugin editor's size, in logical pixels. Every field is optional: an
 * omitted `editor` is a fixed 800×600 view, as before resizing existed.
 */
export interface EditorConfig {
  /** Width the editor opens at; 800 by default. */
  width?: number;
  /** Height the editor opens at; 600 by default. */
  height?: number;
  /**
   * Smallest width a resizable editor can be made; by default 480, or
   * `width` if that is smaller. Ignored unless `resizable`.
   */
  minWidth?: number;
  /**
   * Smallest height a resizable editor can be made; by default 320, or
   * `height` if that is smaller. Ignored unless `resizable`.
   */
  minHeight?: number;
  /**
   * Largest width a resizable editor can be made; by default 1600, or
   * `width` if that is larger. Ignored unless `resizable`.
   */
  maxWidth?: number;
  /**
   * Largest height a resizable editor can be made; by default 1200, or
   * `height` if that is larger. Ignored unless `resizable`.
   */
  maxHeight?: number;
  /**
   * Whether the user can resize the editor (where the host lets them).
   * `false` by default.
   */
  resizable?: boolean;
  /**
   * What resizing does: `'layout'` (the default) lays the UI out again at
   * the new size; `'scale'` keeps its layout at `width`×`height` and draws
   * it larger or smaller, the window keeping its aspect ratio, so nothing
   * moves. Ignored unless `resizable`.
   */
  resize?: EditorResize;
}

/** What resizing an editor does: lays its UI out again, or scales it. */
export type EditorResize = 'layout' | 'scale';

/**
 * An {@link EditorConfig} with every field decided. A fixed editor's limits
 * are its size, so a runtime can always apply them.
 */
export interface ResolvedEditorConfig {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly resizable: boolean;
  /** `'layout'` for a fixed editor. */
  readonly resize: EditorResize;
}

/** The size an editor opens at when the config does not say. */
export const DEFAULT_EDITOR_SIZE = { width: 800, height: 600 } as const;
/**
 * The limits a resizable editor that lays out again gets when the config
 * does not set them. One that scales gets half and twice its size.
 */
export const DEFAULT_EDITOR_LIMITS = {
  minWidth: 480,
  minHeight: 320,
  maxWidth: 1600,
  maxHeight: 1200,
} as const;

const dimension = z
  .number()
  .int('expected a whole number of logical pixels')
  .positive('expected a positive number of logical pixels');

export const editorSchema = z.object({
  width: dimension.optional(),
  height: dimension.optional(),
  minWidth: dimension.optional(),
  minHeight: dimension.optional(),
  maxWidth: dimension.optional(),
  maxHeight: dimension.optional(),
  resizable: z.boolean().optional(),
  resize: z.enum(['layout', 'scale']).optional(),
});

/**
 * Decides every field of an editor config (validated, or already resolved:
 * resolving twice gives the same result).
 */
export function resolveEditor(
  editor: EditorConfig | undefined,
): ResolvedEditorConfig {
  const width = editor?.width ?? DEFAULT_EDITOR_SIZE.width;
  const height = editor?.height ?? DEFAULT_EDITOR_SIZE.height;
  if (editor?.resizable !== true) {
    return {
      width,
      height,
      minWidth: width,
      minHeight: height,
      maxWidth: width,
      maxHeight: height,
      resizable: false,
      resize: 'layout',
    };
  }
  const resize = editor.resize ?? 'layout';
  const defaults =
    resize === 'scale'
      ? {
          minWidth: Math.round(width / 2),
          minHeight: Math.round(height / 2),
          maxWidth: width * 2,
          maxHeight: height * 2,
        }
      : DEFAULT_EDITOR_LIMITS;
  const minWidth = editor.minWidth ?? Math.min(defaults.minWidth, width);
  const minHeight = editor.minHeight ?? Math.min(defaults.minHeight, height);
  return {
    width,
    height,
    minWidth,
    minHeight,
    maxWidth: editor.maxWidth ?? Math.max(defaults.maxWidth, width, minWidth),
    maxHeight:
      editor.maxHeight ?? Math.max(defaults.maxHeight, height, minHeight),
    resizable: true,
    resize,
  };
}

/** Reports limits that contradict each other or the size the editor opens at. */
export function checkEditor(
  editor: EditorConfig,
  path: string,
  issues: ConfigIssue[],
): void {
  for (const axis of ['Width', 'Height'] as const) {
    const min = editor[`min${axis}`];
    const max = editor[`max${axis}`];
    if (min !== undefined && max !== undefined && min > max) {
      issues.push({
        path: `${path}.min${axis}`,
        message: `min${axis} (${min}) must be <= max${axis} (${max})`,
      });
    }
  }
  if (editor.resizable !== true) return;
  const resolved = resolveEditor(editor);
  for (const [key, min, max] of [
    ['width', resolved.minWidth, resolved.maxWidth],
    ['height', resolved.minHeight, resolved.maxHeight],
  ] as const) {
    const value = resolved[key];
    if (min <= max && (value < min || value > max)) {
      issues.push({
        path: `${path}.${key}`,
        message: `${key} (${value}) is outside the resize limits; set it within [${min}, ${max}]`,
      });
    }
  }
}
