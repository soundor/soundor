// @vitest-environment happy-dom
import { fireEvent, getByLabelText, getByRole } from '@testing-library/dom';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { createParameterStore } from '../parameters';
import { mount } from '../testing/preact';
import { ParameterControl } from './parameter';

afterEach(() => document.body.replaceChildren());

const store = createParameterStore([
  {
    id: 'gain',
    label: 'Gain',
    type: 'float',
    min: -60,
    max: 12,
    default: 0,
    unit: 'dB',
  },
  { id: 'voices', label: 'Voices', type: 'int', min: 1, max: 8, default: 4 },
  { id: 'bypass', label: 'Bypass', type: 'bool', default: false },
  {
    id: 'mode',
    label: 'Mode',
    type: 'enum',
    values: ['clean', 'warm', 'hot'],
    default: 'clean',
  },
]);
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
    expect([slider.min, slider.max, slider.step]).toEqual([
      '-60',
      '12',
      '0.072',
    ]);
    expect(container.querySelector('output')?.textContent).toBe('0 dB');

    fireEvent.input(slider, { target: { value: '-6.5' } });
    expect(parameter('gain').get()).toBe(-6.5);
    expect(container.querySelector('output')?.textContent).toBe('-6.5 dB');
  });

  it('follows a value set elsewhere, rounded for display', () => {
    const { container } = mount(
      <ParameterControl parameter={parameter('gain')} />,
    );
    act(() => parameter('gain').set(-3.14159));
    expect(getByRole<HTMLInputElement>(container, 'slider').value).toBe(
      '-3.14159',
    );
    expect(container.querySelector('output')?.textContent).toBe('-3.142 dB');
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

describe('an int parameter', () => {
  it('steps by one, and the parameter rounds what it is given', () => {
    const { container } = mount(
      <ParameterControl parameter={parameter('voices')} />,
    );
    const slider = getByRole<HTMLInputElement>(container, 'slider', {
      name: 'Voices',
    });
    expect(slider.step).toBe('1');
    expect(container.querySelector('output')?.textContent).toBe('4');
    fireEvent.input(slider, { target: { value: '6.6' } });
    expect(parameter('voices').get()).toBe(7);
    expect(container.querySelector('output')?.textContent).toBe('7');
  });
});

describe('a bool parameter', () => {
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

describe('an enum parameter', () => {
  it('is a menu of its values', () => {
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
    expect(slider.value).toBe('4');

    act(() => parameter('gain').set(-20));
    expect(slider.value).toBe('4');
    act(() => parameter('voices').set(2));
    expect(slider.value).toBe('2');
  });
});
