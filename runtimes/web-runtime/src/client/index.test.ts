// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.doUnmock('soundor:internal/ui');
  vi.resetModules();
  vi.restoreAllMocks();
});

async function start(ui?: { hasUi: boolean; loadUi: () => Promise<unknown> }) {
  if (ui !== undefined) vi.doMock('soundor:internal/ui', () => ui);
  const { startSoundorWebHost } = await import('./index');
  return startSoundorWebHost();
}

describe('startSoundorWebHost', () => {
  it('renders the host page with the plugin viewport into #soundor', async () => {
    const container = document.createElement('div');
    container.id = 'soundor';
    document.body.append(container);

    const host = await start();

    expect(container.contains(host.element)).toBe(true);
    expect(host.element.querySelector('.soundor-title')?.textContent).toBe(
      'Fixture',
    );
    expect(host.viewport.style.width).toBe('800px');
    expect(host.viewport.style.height).toBe('600px');
    host.dispose();
    expect(container.children).toHaveLength(0);
  });

  it('shows an empty viewport notice for a plugin without UI', async () => {
    const host = await start();
    expect(host.viewport.textContent).toContain('This plugin has no UI.');
  });

  it('evaluates the plugin UI bundle', async () => {
    const loadUi = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const host = await start({ hasUi: true, loadUi });
    expect(loadUi).toHaveBeenCalledOnce();
    expect(host.viewport.textContent).toBe('');
  });

  it('reports a UI that fails to load and keeps the host running', async () => {
    const error = new SyntaxError('Unexpected token');
    // happy-dom has no reportError(); the host then uses console.error.
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = await start({
      hasUi: true,
      loadUi: () => Promise.reject(error),
    });
    expect(host.viewport.textContent).toContain(
      'The plugin UI failed to load.',
    );
    expect(host.viewport.textContent).toContain(
      'SyntaxError: Unexpected token',
    );
    expect(reported).toHaveBeenCalledWith(error);
  });
});
