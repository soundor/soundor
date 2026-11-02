/**
 * The plugin editor's size: shared by every runtime, so the JUCE editor and
 * the Web host's plugin view open at the same size and resize within the
 * same limits. Runtimes read it through {@link resolveEditor}, never with
 * defaults of their own.
 */

import { z } from 'zod';

import type { ConfigIssue } from './errors';

/** The fields every editor config has, whether it is resizable or not. */
interface EditorConfigBase {
  /** Width the editor opens at; 800 by default. */
  width?: number;
  /** Height the editor opens at; 600 by default. */
  height?: number;
  /**
   * Smallest width a resizable editor can be made; `width` by default, so it
   * only grows. Ignored unless `resizable`.
   */
  minWidth?: number;
  /**
   * Smallest height a resizable editor can be made; `height` by default.
   * Ignored unless `resizable`.
   */
  minHeight?: number;
  /**
   * Largest width a resizable editor asks for; none by default (`Infinity`).
   * The Standalone and the Web host's handle keep to it, and a host that
   * asks is offered it; a host that sets a wider window anyway gets it, and
   * `fit` decides what the UI does beyond it. Ignored unless `resizable`.
   */
  maxWidth?: number;
  /** Largest height a resizable editor asks for, as `maxWidth`. */
  maxHeight?: number;
}

/** An editor the user cannot resize: it keeps the size it opens at. */
export interface FixedEditorConfig extends EditorConfigBase {
  /** Whether the user can resize the editor: `false` by default. */
  resizable?: false;
  /** Ignored: a fixed editor neither lays out again nor scales. */
  resize?: EditorResize;
  /** Only for a resizable editor. */
  fit?: never;
  /** Only for an editor that scales (`resize: 'scale'`). */
  keepAspectRatio?: never;
}

/** A resizable editor that lays its UI out again at every new size. */
export interface LayoutEditorConfig extends EditorConfigBase {
  /** The user can resize the editor (where the host lets them). */
  resizable: true;
  /** `'layout'` (the default): the UI is laid out again at the new size. */
  resize?: 'layout';
  /**
   * What the UI does in a window larger than its maximum (a host that sets
   * one regardless, a Web page that embeds it): `'contain'` (the default)
   * lays it out at most at `maxWidth`×`maxHeight`, centred, with bands of
   * the editor's background around it; `'cover'` lays it out over the whole
   * window, `viewSize().safeArea` being the part, at most the maximum and
   * centred, that keeps to it.
   */
  fit?: EditorFit;
  /** Only for an editor that scales (`resize: 'scale'`). */
  keepAspectRatio?: never;
}

/**
 * A resizable editor that keeps its layout at `width`×`height` and draws it
 * larger or smaller, so nothing moves.
 */
export interface ScaleEditorConfig extends EditorConfigBase {
  /** The user can resize the editor (where the host lets them). */
  resizable: true;
  /**
   * `'scale'`: the layout keeps its size and is drawn at the window's, at
   * the zoom of its smaller side, never beyond the zoom the maximum allows.
   */
  resize: 'scale';
  /**
   * How the layout fills a window of another shape, or one larger than its
   * maximum (a host that does not keep the aspect ratio or the limits, a
   * Web page that fills an iframe, or any window without
   * `keepAspectRatio`): `'contain'` (the default) draws it at its zoom,
   * centred, with bands of the editor's background around it; `'cover'`
   * lays it out over the whole window, `viewSize().safeArea` being the
   * `width`×`height` in the middle that is always shown.
   */
  fit?: EditorFit;
  /**
   * Whether the editor asks to keep the shape of `width`×`height`: `true`
   * (the default) offers that aspect ratio to the host (which may still
   * ignore it), and keeps it in the Standalone's window and the Web host's
   * resize handle. `false` lets the window take any shape within its limits.
   */
  keepAspectRatio?: boolean;
}

/**
 * The plugin editor's size, in logical pixels. Every field is optional: an
 * omitted `editor` is a fixed 800×600 view, as before resizing existed.
 */
export type EditorConfig =
  | FixedEditorConfig
  | LayoutEditorConfig
  | ScaleEditorConfig;

/** What resizing an editor does: lays its UI out again, or scales it. */
export type EditorResize = 'layout' | 'scale';

/**
 * How a resizable editor fills a window it was not made for (another shape,
 * or larger than its maximum): within bands (`'contain'`), or with its
 * layout extended over the whole window around a safe area (`'cover'`).
 */
export type EditorFit = 'contain' | 'cover';

/** The fields of a {@link ResolvedEditorConfig}, every kind of editor. */
interface ResolvedEditorBase {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

/**
 * An {@link EditorConfig} with every field decided. A fixed editor's limits
 * are its size, so a runtime can always apply them; an unbounded maximum is
 * `Infinity`. Only a resizable editor has a `fit` other than `'contain'`,
 * and only one that scales an aspect ratio to keep (`keepAspectRatio`,
 * false for every other editor).
 */
export type ResolvedEditorConfig = ResolvedEditorBase &
  (
    | {
        readonly resizable: false;
        readonly resize: 'layout';
        readonly fit: 'contain';
        readonly keepAspectRatio: false;
      }
    | {
        readonly resizable: true;
        readonly resize: 'layout';
        readonly fit: EditorFit;
        readonly keepAspectRatio: false;
      }
    | {
        readonly resizable: true;
        readonly resize: 'scale';
        readonly fit: EditorFit;
        readonly keepAspectRatio: boolean;
      }
  );

/** The size an editor opens at when the config does not say. */
export const DEFAULT_EDITOR_SIZE = { width: 800, height: 600 } as const;

const dimension = z
  .number()
  .int('expected a whole number of logical pixels')
  .positive('expected a positive number of logical pixels');
/** A maximum: a dimension, or Infinity for none. */
const maximum = z.union([dimension, z.literal(Infinity)], {
  error: 'expected a whole number of logical pixels, or Infinity',
});

export const editorSchema = z.object({
  width: dimension.optional(),
  height: dimension.optional(),
  minWidth: dimension.optional(),
  minHeight: dimension.optional(),
  maxWidth: maximum.optional(),
  maxHeight: maximum.optional(),
  resizable: z.boolean().optional(),
  resize: z.enum(['layout', 'scale']).optional(),
  fit: z.enum(['contain', 'cover']).optional(),
  keepAspectRatio: z.boolean().optional(),
});

/** What {@link resolveEditor} and {@link checkEditor} read: a config, typed or not. */
type EditorInput = z.infer<typeof editorSchema>;

/**
 * Decides every field of an editor config (validated, or already resolved:
 * resolving twice gives the same result).
 */
export function resolveEditor(
  editor: EditorConfig | ResolvedEditorConfig | EditorInput | undefined,
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
      fit: 'contain',
      keepAspectRatio: false,
    };
  }
  // By default the editor only grows, and as far as the host lets it.
  const limits = {
    width,
    height,
    minWidth: editor.minWidth ?? width,
    minHeight: editor.minHeight ?? height,
    maxWidth: editor.maxWidth ?? Infinity,
    maxHeight: editor.maxHeight ?? Infinity,
  };
  const fit = editor.fit ?? 'contain';
  return editor.resize === 'scale'
    ? {
        ...limits,
        resizable: true,
        resize: 'scale',
        fit,
        keepAspectRatio: editor.keepAspectRatio ?? true,
      }
    : {
        ...limits,
        resizable: true,
        resize: 'layout',
        fit,
        keepAspectRatio: false,
      };
}

/** Reports limits that contradict each other or the size the editor opens at. */
export function checkEditor(
  editor: EditorInput,
  path: string,
  issues: ConfigIssue[],
): void {
  // What every other editor resolves to ('contain', no aspect ratio kept)
  // is accepted, so a resolved config validates again; the rest means
  // nothing unless the editor is resizable, or scales.
  if (editor.fit === 'cover' && editor.resizable !== true) {
    issues.push({
      path: `${path}.fit`,
      message: "fit: 'cover' only applies with resizable: true",
    });
  }
  if (
    editor.keepAspectRatio === true &&
    !(editor.resizable === true && editor.resize === 'scale')
  ) {
    issues.push({
      path: `${path}.keepAspectRatio`,
      message:
        "keepAspectRatio only applies with resizable: true and resize: 'scale'",
    });
  }
  const contradicting = new Set<string>();
  for (const axis of ['Width', 'Height'] as const) {
    const min = editor[`min${axis}`];
    const max = editor[`max${axis}`];
    if (min !== undefined && max !== undefined && min > max) {
      contradicting.add(axis);
      issues.push({
        path: `${path}.min${axis}`,
        message: `min${axis} (${min}) must be <= max${axis} (${max})`,
      });
    }
  }
  if (editor.resizable !== true) return;
  const resolved = resolveEditor(editor);
  for (const [axis, key] of [
    ['Width', 'width'],
    ['Height', 'height'],
  ] as const) {
    if (contradicting.has(axis)) continue;
    const value = resolved[key];
    const min = resolved[`min${axis}`];
    const max = resolved[`max${axis}`];
    if (value > max && editor[`min${axis}`] === undefined) {
      issues.push({
        path: `${path}.max${axis}`,
        message: `max${axis} (${max}) is below ${key} (${value}), the size the editor opens at`,
      });
    } else if (value < min || value > max) {
      issues.push({
        path: `${path}.${key}`,
        message: `${key} (${value}) is outside the resize limits; set it within [${min}, ${max}]`,
      });
    }
  }
}
