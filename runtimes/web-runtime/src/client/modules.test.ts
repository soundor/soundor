// Plugin code's view: soundor:* imported as a plugin bundle imports it,
// resolved by the runtime's Vite plugin to the page's one host context.

import * as hostModule from 'soundor:host';
import { plugin, snapshot, subscribe } from 'soundor:host';
import { parameters } from 'soundor:parameters';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { hostContext } from './context';

describe('soundor:parameters', () => {
  it('is the page parameter store: the same objects, one value', () => {
    const { parameters: store } = hostContext();
    expect(parameters.gain).toBe(store.byId['gain']);
    expect(Object.keys(parameters)).toEqual([
      'gain',
      'steps',
      'bypass',
      'mode',
    ]);

    parameters.gain.set(0.7);
    expect(store.byId['gain']!.get()).toBe(0.7);

    const heard = vi.fn<(value: number) => void>();
    const unsubscribe = parameters.gain.subscribe(heard);
    store.byId['gain']!.set(0.2);
    expect(heard).toHaveBeenCalledWith(0.2);
    unsubscribe();
  });

  it('matches the generated declarations', () => {
    expectTypeOf(parameters.mode.get()).toEqualTypeOf<
      'clean' | 'warm' | 'hot'
    >();
    expectTypeOf(parameters.bypass.set).parameter(0).toEqualTypeOf<boolean>();
    expect(parameters.steps.info).toMatchObject({ min: 1, max: 8 });
  });
});

describe('soundor:host', () => {
  it('reports the plugin and the Web host state', () => {
    expect(plugin).toEqual({ id: 'com.example.fixture', name: 'Fixture' });
    expect(Object.isFrozen(plugin)).toBe(true);
    expect(snapshot()).toBe(hostContext().host.snapshot());
    expect(snapshot().hostName).toBe('Soundor Web');
  });

  it('follows changes the host makes', () => {
    const seen = vi.fn<(bpm: number) => void>();
    const unsubscribe = subscribe((next) => seen(next.transport!.bpm));
    hostContext().host.setBpm(140);
    expect(seen).toHaveBeenCalledWith(140);
    expect(snapshot().transport?.bpm).toBe(140);
    unsubscribe();
  });

  it('lets the plugin observe the transport, not control it', () => {
    expect(Object.keys(hostModule).sort()).toEqual([
      'plugin',
      'snapshot',
      'subscribe',
    ]);
  });
});
