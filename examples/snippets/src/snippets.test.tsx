import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, userEvent } from '@soundor/testing-library/react';
import { describe, expect, test } from 'vitest';

import { Frame } from './frame';
import { Picker } from './Picker';
import { snippets } from './snippets';

const dir = join(import.meta.dirname, 'snippets');
const files = readdirSync(dir).filter((file) => file !== 'index.ts');

describe('every snippet', () => {
  test('is listed under its file name', () => {
    expect(Object.keys(snippets).sort()).toEqual(
      files.map((file) => file.replace(/\.tsx$/, '')).sort(),
    );
  });

  // Readers edit a snippet in the page, where only these exist.
  test.each(files)('%s imports only what the docs page has', (file) => {
    const code = readFileSync(join(dir, file), 'utf-8');
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const specifier of imports) {
      // …and the images in src/assets/, which the docs page serves.
      expect(specifier).toMatch(
        /^(react|@soundor\/react(?:\/svg)?|soundor:[a-z]+|\.\.\/assets\/[\w-]+\.(png|jpe?g|webp|svg))$/,
      );
    }
    expect(code).toMatch(/^export default function /m);
  });

  test.each(Object.entries(snippets))('%s renders', async (_, Snippet) => {
    await expect(
      render(
        <Frame>
          <Snippet />
        </Frame>,
      ),
    ).resolves.toBeDefined();
  });
});

test('the picker shows the snippet chosen', async () => {
  const user = userEvent.setup();
  await render(<Picker />);
  expect(screen.getByText('Preset loaded')).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'parameters' }));
  expect(screen.getByText('Voices')).toBeDefined();
});

test('snippets use the parameters of every type', async () => {
  const user = userEvent.setup();
  const Parameters = snippets['parameters']!;
  await render(<Parameters />);
  await user.click(screen.getByRole('button', { name: 'warm' }));
  expect(
    screen.getByRole('button', { name: 'warm', selected: true }),
  ).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Off' }));
  expect(screen.getByRole('button', { name: 'On' })).toBeDefined();
});
