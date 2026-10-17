import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { typeTableGenerator, typeTableOptions } from './type-tables.ts';

let tables: Awaited<ReturnType<typeof typeTableGenerator>>;
beforeAll(async () => {
  tables = await typeTableGenerator();
});
afterAll(() => tables.close());

/** The table of `type` in @soundor/react's components, as a page asks. */
async function table(name: string, type?: string) {
  const [doc] = await tables.generator.generateTypeTable(
    { path: 'packages/react/src/components.tsx', name, type },
    typeTableOptions,
  );
  return Object.fromEntries(doc!.entries.map((entry) => [entry.name, entry]));
}

describe('type tables', () => {
  it("lists a component's own props, with their doc comments", async () => {
    const props = await table(
      'PressableOwnProps',
      'Omit<PressableProps, keyof EventProps | keyof AccessibilityProps>',
    );
    expect(Object.keys(props)).toContain('delayLongPress');
    expect(Object.keys(props)).not.toContain('onPointerDown');
    expect(props['delayLongPress']).toMatchObject({
      simplifiedType: 'number',
      description:
        'Milliseconds before a press is a long press: 500 by default.',
      required: false,
    });
  });

  it('shows short types in full, not as their kind', async () => {
    const props = await table('ViewProps');
    expect(props['focusable']?.simplifiedType).toBe('boolean');
    expect(props['ref']?.simplifiedType).toBe('Ref<UiNode>');
  });

  it("knows soundor:ui's types, which nothing imports by path", async () => {
    const style = await table('Style');
    expect(style['flexDirection']?.type).toContain('"row"');
    expect(style['flexDirection']?.description).toContain('column');
  });
});
