import type { AudioStatus, WebAudioHost } from '../audio';
import type { HostSnapshot, WebHost } from '../host';
import { IconButton } from './controls';
import { useAudioStatus, useHostSnapshot } from './hooks';

export interface DockProps {
  readonly host: WebHost;
  readonly audio: WebAudioHost;
  readonly panelId: string;
  readonly toggleId: string;
  readonly panelOpen: boolean;
  readonly onTogglePanel: () => void;
}

/**
 * The bar floating under the plugin: mute and volume, play/stop and the
 * position, and the panel's button. Audio starts with the page's first
 * gesture (`startAudioOnGesture`), so it has no button of its own.
 */
export function Dock({
  host,
  audio,
  panelId,
  toggleId,
  panelOpen,
  onTogglePanel,
}: DockProps) {
  const { transport } = useHostSnapshot(host);
  const status = useAudioStatus(audio);
  const playing = transport?.playing ?? false;

  return (
    <div class="soundor-dock" role="toolbar" aria-label="Host">
      <AudioButton audio={audio} status={status} />
      <input
        class="soundor-volume"
        type="range"
        min="0"
        max="1"
        step="0.01"
        title="Output volume"
        aria-label="Output volume"
        value={status.volume}
        onInput={(event) => audio.setVolume(Number(event.currentTarget.value))}
      />
      <span class="soundor-divider" />
      <IconButton
        icon={playing ? 'pause' : 'play'}
        label={playing ? 'Pause' : 'Play'}
        pressed={playing}
        onClick={() => {
          if (playing) {
            host.pause();
            return;
          }
          // Starts audio from this click; playing goes on without it.
          void audio.start();
          host.play();
        }}
      />
      <IconButton icon="stop" label="Stop" onClick={() => host.stop()} />
      <span
        class={
          playing ? 'soundor-position soundor-playing' : 'soundor-position'
        }
        title="Position (bar.beat)"
      >
        {transport === null ? '' : barBeat(transport)}
      </span>
      <span class="soundor-divider" />
      <IconButton
        id={toggleId}
        icon="panel"
        label="Host settings"
        pressed={panelOpen}
        aria-expanded={panelOpen}
        aria-controls={panelId}
        onClick={onTogglePanel}
      />
    </div>
  );
}

/** Mutes and unmutes; where audio failed to start, retries it. */
function AudioButton({
  audio,
  status,
}: {
  readonly audio: WebAudioHost;
  readonly status: AudioStatus;
}) {
  const failed = status.state === 'failed';
  const label = failed ? 'Retry audio' : status.muted ? 'Unmute' : 'Mute';
  return (
    <IconButton
      icon={status.muted ? 'muted' : 'speaker'}
      label={label}
      title={
        failed && status.error !== null
          ? `Audio failed: ${status.error}`
          : label
      }
      pressed={failed ? undefined : status.muted}
      className="soundor-audio"
      data-state={status.state}
      onClick={() => {
        if (failed) void audio.start();
        else audio.setMuted(!status.muted);
      }}
    />
  );
}

/** The position as bar.beat (1-based), in the time signature's beats. */
export function barBeat(
  transport: NonNullable<HostSnapshot['transport']>,
): string {
  const { numerator, denominator } = transport.timeSignature;
  const beatLength = 4 / denominator;
  const barLength = numerator * beatLength;
  const bar = Math.floor(transport.barStartPpq / barLength) + 1;
  const beat =
    Math.floor((transport.ppqPosition - transport.barStartPpq) / beatLength) +
    1;
  return `${bar}.${beat}`;
}
