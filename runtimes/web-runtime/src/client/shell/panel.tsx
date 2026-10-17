import { useId, useRef, useState } from 'preact/hooks';

import type { AudioSource, WebAudioHost } from '../audio';
import type { HostSnapshot, WebHost } from '../host';
import type { ParameterStore } from '../parameters';
import { IconButton, Row, Section } from './controls';
import { useAudioStatus, useHostSnapshot } from './hooks';
import { ParameterControl } from './parameter';

const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8'];

export interface PanelProps {
  readonly id: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly pluginName: string;
  readonly host: WebHost;
  readonly audio: WebAudioHost;
  readonly parameters: ParameterStore;
  /** Shows the host state (the `dev` presentation). */
  readonly inspect: boolean;
}

/**
 * Host settings beside the plugin: the transport, the audio, the
 * parameters and, in `dev`, the host state. Hidden rather than unmounted
 * when closed, so it keeps what was open in it.
 */
export function Panel(props: PanelProps) {
  const { id, open, onClose, pluginName, host, audio, parameters } = props;
  const snapshot = useHostSnapshot(host);
  return (
    <aside
      id={id}
      class="soundor-panel"
      hidden={!open}
      aria-label="Host settings"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div class="soundor-panel-header">
        <div class="soundor-heading">
          <span class="soundor-title">{pluginName}</span>
          <span class="soundor-subtitle">Soundor Web host</span>
        </div>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </div>
      <div class="soundor-panel-body">
        <Transport host={host} snapshot={snapshot} />
        <Audio audio={audio} snapshot={snapshot} />
        <Section title="Parameters">
          {parameters.list.length === 0 ? (
            <div class="soundor-empty">None declared</div>
          ) : (
            parameters.list.map((parameter) => (
              <ParameterControl key={parameter.id} parameter={parameter} />
            ))
          )}
        </Section>
        {props.inspect ? (
          <details class="soundor-section soundor-inspector">
            <summary>Host state</summary>
            <pre>{JSON.stringify(snapshot, round, 2)}</pre>
          </details>
        ) : null}
      </div>
    </aside>
  );
}

function Transport({
  host,
  snapshot,
}: {
  readonly host: WebHost;
  readonly snapshot: HostSnapshot;
}) {
  const ids = { bpm: useId(), signature: useId() };
  // What is typed into the tempo field until it is committed: the
  // transport's own tempo does not overwrite it meanwhile.
  const [draft, setDraft] = useState<string | null>(null);
  const transport = snapshot.transport;
  if (transport === null) return null;
  const { numerator, denominator } = transport.timeSignature;
  return (
    <Section title="Transport">
      <Row label="Tempo (BPM)" id={ids.bpm}>
        <input
          id={ids.bpm}
          class="soundor-field"
          type="number"
          min="20"
          max="999"
          step="1"
          value={draft ?? String(Math.round(transport.bpm))}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            if (Number.isFinite(value) && event.currentTarget.value !== '')
              host.setBpm(value);
            setDraft(null);
          }}
          onBlur={() => setDraft(null)}
        />
      </Row>
      <Row label="Time signature" id={ids.signature}>
        <select
          id={ids.signature}
          class="soundor-field"
          value={`${numerator}/${denominator}`}
          onChange={(event) => {
            const [top, bottom] = event.currentTarget.value
              .split('/')
              .map(Number);
            host.setTimeSignature(top!, bottom!);
          }}
        >
          {TIME_SIGNATURES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Loop">
        <IconButton
          icon="loop"
          label="Loop"
          pressed={transport.looping}
          onClick={() => host.setLooping(!transport.looping)}
        />
      </Row>
    </Section>
  );
}

function Audio({
  audio,
  snapshot,
}: {
  readonly audio: WebAudioHost;
  readonly snapshot: HostSnapshot;
}) {
  const status = useAudioStatus(audio);
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const fail = (error: unknown): void =>
    setFailure(error instanceof Error ? error.message : String(error));
  // Rendering again shows the source in use (a file dialog was cancelled).
  const [, setRenders] = useState(0);
  const revert = (): void => setRenders((count) => count + 1);
  const error = status.error ?? failure;

  return (
    <Section title="Audio">
      <Row label="Input" id={id}>
        <select
          id={id}
          class="soundor-field"
          value={status.source}
          onChange={(event) => {
            const value = event.currentTarget.value as AudioSource;
            setFailure(null);
            void audio.start();
            if (value === 'file') file.current?.click();
            else void audio.setSource(value).catch(fail);
          }}
        >
          <option value="oscillator">Oscillator</option>
          <option value="file">Audio file…</option>
          <option value="none">No input</option>
        </select>
      </Row>
      <input
        ref={file}
        type="file"
        accept="audio/*"
        hidden
        onCancel={revert}
        onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          if (chosen === undefined) {
            revert();
            return;
          }
          void audio
            .start()
            .then(() => audio.setSource('file', chosen))
            .catch(fail);
        }}
      />
      <div class="soundor-status">
        <span>
          {snapshot.sampleRate / 1000} kHz · {snapshot.blockSize} samples
        </span>
        <span>
          {status.state === 'running'
            ? `Audio on${status.fileName !== null && status.source === 'file' ? ` · ${status.fileName}` : ''}`
            : status.state === 'starting'
              ? 'Starting audio…'
              : status.state === 'failed'
                ? 'Audio failed'
                : 'Audio off'}
        </span>
        {error === null ? null : (
          <span class="soundor-audio-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </Section>
  );
}

function round(_key: string, value: unknown): unknown {
  return typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
}
