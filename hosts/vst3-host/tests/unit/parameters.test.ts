import { describe, expect, test } from 'vitest';

import { parameterTitled } from '../../src/host.ts';
import type { ParameterInfo } from '../../src/types.ts';

function parameter(id: number, title: string, bypass = false): ParameterInfo {
  return { id, title, flags: { bypass } } as ParameterInfo;
}

describe('parameterTitled', () => {
  test('finds the one with the title', () => {
    const parameters = [parameter(1, 'Gain'), parameter(2, 'Mix')];
    expect(parameterTitled(parameters, 'Mix').id).toBe(2);
  });

  test('finds a host bypass alone by its title', () => {
    expect(parameterTitled([parameter(1, 'Bypass', true)], 'Bypass').id).toBe(
      1,
    );
  });

  test("prefers the plugin's own over the bypass JUCE adds", () => {
    const parameters = [parameter(1, 'Bypass'), parameter(2, 'Bypass', true)];
    expect(parameterTitled(parameters, 'Bypass').id).toBe(1);
  });

  test('names what the plugin has for an unknown title', () => {
    expect(() => parameterTitled([parameter(1, 'Gain')], 'Nope')).toThrow(
      'No parameter is titled "Nope"; the plugin has: "Gain"',
    );
  });

  test('refuses to guess between others of one title', () => {
    const parameters = [parameter(1, 'Level'), parameter(2, 'Level')];
    expect(() => parameterTitled(parameters, 'Level')).toThrow(
      '2 parameters are titled "Level"',
    );
  });
});
