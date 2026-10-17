import { startSimulatedRuntime } from '@soundor/devtools-server/testing';
import { expect, it } from 'vitest';

import { setup, until } from './helpers';

it('captures the view, previews it, offers a download, and frees it on close', async () => {
  const { native, page: tab } = await setup();
  await tab.ready();
  // Observers can capture: it reads the view.
  tab.click('screenshot');
  await until(() => !!tab.get('capture'));
  expect(tab.text('capture-meta')).toContain('160×140 px · scale 1');
  expect(native.captures).toBe(1);
  const image = tab.get('capture-image') as unknown as HTMLImageElement;
  const url = image.getAttribute('src')!;
  expect(url).toMatch(/^\/browser\/captures\/[\w-]+$/);
  const download = tab.get('capture-download') as unknown as HTMLAnchorElement;
  expect(download.getAttribute('href')).toBe(url);
  expect(download.getAttribute('download')).toMatch(
    /^Gain-Plugin-\d{4}-.*\.png$/,
  );
  // The image is this session's, read with the tab's cookie.
  const fetched = await tab.win.fetch(url);
  expect(fetched.status).toBe(200);
  expect([
    ...new Uint8Array(await fetched.arrayBuffer()).subarray(0, 4),
  ]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  tab.click('capture-close');
  await until(() => !tab.get('capture'));
  // The server's copy goes with the preview.
  let status = 0;
  for (const deadline = Date.now() + 3000; Date.now() < deadline;) {
    status = (await tab.win.fetch(url)).status;
    if (status === 404) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(status).toBe(404);
});

it('explains a capture the target cannot make', async () => {
  const { native, page: tab } = await setup();
  await tab.ready();
  native.failCaptures('Nothing is rendered yet');
  tab.click('screenshot');
  await until(() => tab.text('notice').includes('Nothing is rendered yet'));
  expect(tab.text('notice')).toContain('CAPTURE_UNAVAILABLE');
  expect(tab.get('capture')).toBeNull();
});

it('offers no screenshot for a target without the capture capability', async () => {
  const { server, native, page: tab } = await setup();
  await native.close();
  const limited = await startSimulatedRuntime({
    connection: server.connection,
    capture: false,
  });
  try {
    await until(() => tab.text('target-meta').includes('inspector'));
    expect(tab.get('screenshot').hidden).toBe(true);
  } finally {
    await limited.close();
  }
});
