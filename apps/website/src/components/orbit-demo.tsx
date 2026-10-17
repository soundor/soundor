import { ArrowUpRight, Maximize2, Minimize2 } from 'lucide-react';
import { useRef } from 'react';

import { useHydrated } from './live/figure';
import { useFullscreen } from './live/use-fullscreen';

/** A playable homepage demo, with the host's audio controls and no editor. */
export function OrbitDemo() {
  const figure = useRef<HTMLElement>(null);
  const fullscreen = useFullscreen(figure);
  const hydrated = useHydrated();

  return (
    <figure
      ref={figure}
      className={`orbit-demo ${fullscreen.expanded ? 'orbit-demo-expanded' : ''}`}
      aria-label="Try Orbit, a stereo delay built with Soundor"
    >
      <div className="orbit-window-bar">
        <div className="orbit-window-name">
          <span className="orbit-window-mark" aria-hidden>
            ◉
          </span>
          <strong>Orbit</strong>
          <span>Stereo delay</span>
        </div>
        <div className="orbit-window-actions">
          <span className="orbit-live">
            <span /> Live demo
          </span>
          <button
            type="button"
            disabled={!hydrated}
            onClick={() =>
              fullscreen.expanded ? fullscreen.collapse() : fullscreen.expand()
            }
            aria-label={
              fullscreen.expanded ? 'Exit full screen' : 'Full screen'
            }
            title={fullscreen.expanded ? 'Exit full screen' : 'Full screen'}
          >
            {fullscreen.expanded ? (
              <Minimize2 size={15} />
            ) : (
              <Maximize2 size={15} />
            )}
          </button>
        </div>
      </div>
      <iframe
        src="/examples/orbit/index.html"
        title="Orbit — playable stereo delay"
        allow="autoplay; microphone"
      />
      <figcaption className="orbit-window-caption">
        <span>
          Press <strong>▶ Play</strong> below the plugin. Drag an echo. Make it
          yours.
        </span>
        <a href="/docs/examples/orbit">
          Explore the example <ArrowUpRight size={14} aria-hidden />
        </a>
      </figcaption>
    </figure>
  );
}
