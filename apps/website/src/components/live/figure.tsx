import { Maximize2, Minimize2 } from 'lucide-react';
import {
  type ComponentType,
  type ReactNode,
  type RefObject,
  useState,
  useSyncExternalStore,
} from 'react';

import type { CodeEditorProps } from './editor';
import type { Fullscreen } from './use-fullscreen';

const noChanges = () => () => {};

/** Whether the page has hydrated: its buttons work only then. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noChanges,
    () => true,
    () => false,
  );
}

/** The editor (CodeMirror, TypeScript), loaded only for readers who edit. */
export function useEditor() {
  const [Editor, setEditor] = useState<ComponentType<CodeEditorProps> | null>(
    null,
  );
  const [opening, setOpening] = useState(false);
  return {
    Editor,
    opening,
    open: () => {
      if (opening) return;
      setOpening(true);
      void import('./editor').then((module) =>
        setEditor(() => module.CodeEditor),
      );
    },
  };
}

export function ActionButton({
  onClick,
  disabled = false,
  strong = false,
  children,
}: {
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly strong?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 hover:text-fd-foreground disabled:opacity-60 ${strong ? 'font-medium text-fd-foreground hover:underline' : ''}`}
    >
      {children}
    </button>
  );
}

export function FullscreenButton({
  fullscreen,
  onExpand,
  disabled,
}: {
  readonly fullscreen: Fullscreen;
  /** Before expanding: the editor opens beside the preview. */
  readonly onExpand: () => void;
  readonly disabled: boolean;
}) {
  const { expanded } = fullscreen;
  return (
    <ActionButton
      disabled={disabled}
      onClick={() => {
        if (expanded) {
          fullscreen.collapse();
        } else {
          onExpand();
          fullscreen.expand();
        }
      }}
    >
      {expanded ? (
        <Minimize2 className="size-3.5" aria-hidden />
      ) : (
        <Maximize2 className="size-3.5" aria-hidden />
      )}
      {expanded ? 'Exit full screen' : 'Full screen'}
    </ActionButton>
  );
}

export interface LiveFigureProps {
  /** The figure, which full screen fills the screen with. */
  readonly figure: RefObject<HTMLElement | null>;
  readonly fullscreen: Fullscreen;
  readonly frame: RefObject<HTMLIFrameElement | null>;
  /** The host page the preview shows. */
  readonly src: string;
  readonly title: string;
  /** The preview's height in pixels, out of full screen. */
  readonly height: number;
  /** The editor, once open: beside the preview in full screen. */
  readonly editor: ReactNode;
  /** What shows under the preview while the editor is closed (its code). */
  readonly code?: ReactNode;
  readonly caption: ReactNode;
  readonly actions: ReactNode;
}

/**
 * A live preview: a host page in an iframe, its code or editor under it (or
 * beside it, full screen), a caption and actions.
 */
export function LiveFigure({
  figure,
  fullscreen,
  frame,
  src,
  title,
  height,
  editor,
  code,
  caption,
  actions,
}: LiveFigureProps) {
  const { expanded } = fullscreen;
  return (
    <figure
      ref={figure}
      className={`not-prose flex flex-col overflow-hidden ${expanded ? 'fixed inset-0 z-[100] bg-fd-background' : 'my-6 rounded-xl border bg-fd-card'}`}
    >
      <div
        className={
          expanded
            ? 'grid min-h-0 flex-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1'
            : undefined
        }
      >
        <iframe
          ref={frame}
          src={src}
          title={title}
          loading="lazy"
          allow="autoplay"
          className={`block w-full border-0 ${expanded ? 'h-full lg:order-2 lg:border-l' : ''}`}
          style={expanded ? undefined : { height }}
        />
        {editor ? (
          <div className={expanded ? 'min-h-0 lg:order-1' : undefined}>
            {editor}
          </div>
        ) : (
          code
        )}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-sm text-fd-muted-foreground">
        <span>{caption}</span>
        <span className="flex flex-wrap gap-4">{actions}</span>
      </figcaption>
    </figure>
  );
}
