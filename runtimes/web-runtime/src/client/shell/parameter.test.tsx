// @vitest-environment happy-dom
import { fireEvent, getByLabelText, getByRole } from '@testing-library/dom';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { mount } from '../testing/preact';
import { storeOf } from '../testing/store';
import { ParameterControl } from './parameter';

afterEach(() => document.body.replaceChildren());

const store = storeOf({
  gain: {
    type: 'float32',
    label: 'Gain',
    min: -60,
    max: 12,
    default: 0,
    step: 0.1,
    unit: 'dB',
  },
  voices: { type: 'int32', label: 'Voices', min: 1, max: 8, default: 4 },
  bypass: { type: 'boolean', label: 'Bypass', default: false },
  mode: {
    type: 'choice',
    label: 'Mode',
    options: [
      { value: 'clean', label: 'Clean' },
      { value: 'warm', label: 'Warm' },
      { value: 'hot', label: 'Hot' },
    ],
    default: 'clean',
  },
  frequency: {
    type: 'float32',
    label: 'Frequency',
    min: 20,
    max: 20000,
    default: 1000,
    mapping: 'log',
    unit: 'Hz',
  },
  meter: {
    type: 'float32',
    label: 'Meter',
    min: -60,
    max: 0,
    default: 0,
    unit: 'dB',
    access: 'readOnly',
  },
});
const parameter = (id: string) => store.byId[id]!;

afterEach(() => {
  parameter('gain').set(0);
  parameter('voices').set(4);
  parameter('bypass').set(false);
  parameter('mode').set('clean');
});

describe('a float parameter', () => {
  it('is a slider over its range, showing the value with its unit', () => {
    const { container } = mount(
      <ParameterControl parameter={parameter('gain')} />,
    );
    const slider = getByRole<HTMLInputElement>(container, 'slider', {
      name: 'Gain',
    });
    // Positions through the parameter's mapping, as a host's slider moves.
    expect([slider.min, slider.max, slider.step]).toEqual(['0', '1000', '1']);
    expect(slider.value).toBe('833');
    expect(container.querySelector('output')?.textContent).toBe('0.0 dB');

    fireEvent.input(slider, { target: { value: '500' } });
    expect(parameter('gain').get()).toBe(-24);
    expect(container.querySelector('output')?.textContent).toBe('-24.0 dB');
  });

  it("follows a value set elsewhere, shown in the parameter's text", () => {
    const { container } = mount(
      <ParameterControl parameter={parameter('gain')} />,
    );
    act(() => parameter('gain').set(-3.14159));
    expect(parameter('gain').get()).toBe(Math.fround(-3.1));
    expect(container.querySelector('output')?.textContent).toBe('-3.1 dB');
  });

  it('moves along a log curve, as hosts do', () => {
    const { container } = mount(
      <ParameterControl parameter={parameter('frequency')} />,
    );
    const slider = getByRole<HTMLInputElement>(container, 'slider');
    fireEvent.input(slider, { target: { value: '500' } });
    expect(container.querySelector('output')?.textContent).toBe('632 Hz');
    parameter('frequency').set(1000);
  });

  it('shows a read-only parameter without editing it', () => {
    const { container } = mount(
      <ParameterControl parameter={parameter('meter')} />,
    );
    expect(getByRole<HTMLInputElement>(container, 'slider').disabled).toBe(
      true,
    );
    expect(container.querySelector('output')?.textContent).toBe('0.0 dB');
  });

  it('makes a gesture of a drag, however the pointer lets go', () => {
    const { container } = mount(
      <ParameterControl parameter={parameter('gain')} />,
    );
    const slider = getByRole(container, 'slider');
    fireEvent.pointerDown(slider);
    expect(parameter('gain').inGesture).toBe(true);
    fireEvent.pointerUp(slider);
    expect(parameter('gain').inGesture).toBe(false);

    fireEvent.pointerDown(slider);
    fireEvent(slider, new Event('lostpointercapture'));
    expect(parameter('gain').inGesture).toBe(false);
  });
});

describe('an integer parameter', () => {
  it('steps by one, and the parameter rounds what it is given', () => {
    const { container } = mount(
      <ParameterControl parameter={parameter('voices')} />,
    );
    const slider = getByRole<HTMLInputElement>(container, 'slider', {
      name: 'Voices',
    });
    // One position per value: 1 to 8.
    expect([slider.max, slider.step, slider.value]).toEqual(['7', '1', '3']);
    expect(container.querySelector('output')?.textContent).toBe('4');
    fireEvent.input(slider, { target: { value: '6' } });
    expect(parameter('voices').get()).toBe(7);
    expect(container.querySelector('output')?.textContent).toBe('7');
  });
});

describe('a boolean parameter', () => {
  it('is a checkbox both ways', () => {
    const { container } = mount(
      <ParameterControl parameter={parameter('bypass')} />,
    );
    const box = getByRole<HTMLInputElement>(container, 'checkbox', {
      name: 'Bypass',
    });
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(parameter('bypass').get()).toBe(true);
    act(() => parameter('bypass').set(false));
    expect(box.checked).toBe(false);
  });
});

describe('a choice parameter', () => {
  it('is a menu of its options, by label', () => {
    const { container } = mount(
      <ParameterControl parameter={parameter('mode')} />,
    );
    const menu = getByRole<HTMLSelectElement>(container, 'combobox', {
      name: 'Mode',
    });
    expect([...menu.options].map((option) => option.value)).toEqual([
      'clean',
      'warm',
      'hot',
    ]);
    expect([...menu.options].map((option) => option.text)).toEqual([
      'Clean',
      'Warm',
      'Hot',
    ]);
    fireEvent.change(menu, { target: { value: 'hot' } });
    expect(parameter('mode').get()).toBe('hot');
    act(() => parameter('mode').set('warm'));
    expect(menu.value).toBe('warm');
  });
});

describe('a control given another parameter', () => {
  it('follows the new one and lets go of the old', () => {
    const { container, rerender } = mount(
      <ParameterControl parameter={parameter('gain')} />,
    );
    rerender(<ParameterControl parameter={parameter('voices')} />);
    const slider = getByLabelText<HTMLInputElement>(container, 'Voices');
    expect(slider.value).toBe('3');

    act(() => parameter('gain').set(-20));
    expect(slider.value).toBe('3');
    act(() => parameter('voices').set(2));
    expect(slider.value).toBe('1');
  });
});
