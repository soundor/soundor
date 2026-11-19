// The test plugin's UI, on soundor:ui itself (no React): its parameters,
// its state and the Rust controller's method, shown as text.
import { twice } from 'soundor:native';
import { parameters } from 'soundor:parameters';
import { state } from 'soundor:state';
import { createText, createView, root } from 'soundor:ui';

const column = root.appendChild(createView());
column.style = {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  backgroundColor: '#203040',
};
const gain = column.appendChild(createText());
const label = column.appendChild(createText());
const native = column.appendChild(createText());
for (const text of [gain, label, native])
  text.style = { color: '#ffffff', fontSize: 18 };

const showGain = (value: number) => {
  gain.text = `Gain ${value.toFixed(2)}`;
};
const showLabel = (value: string) => {
  label.text = `Label ${value}`;
};
showGain(parameters.gain.get());
showLabel(state.label.get());
parameters.gain.subscribe(showGain);
state.label.subscribe(showLabel);
native.text = `Twice ${twice(21)}`;
