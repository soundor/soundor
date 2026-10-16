// The test plugins' UI, on soundor:ui itself (no React): what every plugin's
// UI reads, the generated parameters and the host. Each plugin's src/main.ts
// mounts it.
import { snapshot, subscribe } from 'soundor:host';
import { parameters } from 'soundor:parameters';
import { createText, createView, pressable, root } from 'soundor:ui';

export function mount(): void {
  const column = root.appendChild(
    createView({
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    }),
  );
  const gain = column.appendChild(createText());
  const bypass = column.appendChild(createText());
  const host = column.appendChild(createText());

  const showGain = (value: number) => {
    gain.text = `${parameters.gain.info.label}: ${value.toFixed(2)}`;
  };
  const showBypass = (value: boolean) => {
    bypass.text = value ? 'Bypassed' : 'Active';
  };
  const showHost = () => {
    host.text = snapshot().hostName || 'No host';
  };

  showGain(parameters.gain.get());
  showBypass(parameters.bypass.get());
  showHost();
  parameters.gain.subscribe(showGain);
  parameters.bypass.subscribe(showBypass);
  subscribe(showHost);
  pressable(bypass, {
    onPress: () => parameters.bypass.set(!parameters.bypass.get()),
  });
}
