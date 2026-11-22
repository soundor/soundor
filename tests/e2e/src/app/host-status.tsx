import { Text, useHostState } from '@soundor/react';

import { text } from '../ui/theme';

/** The host's sample rate and transport, as the plugin sees them. */
export function HostStatus() {
  const { sampleRate, transport } = useHostState();
  return (
    <Text debugId="host.status" style={text.muted}>
      {`${Math.round(sampleRate)} Hz · ${
        transport
          ? `${transport.bpm.toFixed(0)} BPM ${transport.playing ? 'playing' : 'stopped'}`
          : 'no transport'
      }`}
    </Text>
  );
}
