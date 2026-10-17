---
title: 'render'
description: 'Renders a React element into a fresh plugin view for a test, with queries, rerender and unmount.'
---

```ts
import { render } from '@soundor/testing-library/react';

function render(
  element: ReactNode,
  options?: {
    container?: NodeTarget;
    wrapper?: ComponentType<{ children?: ReactNode }>;
  },
): Promise<RenderResult>;
```

`render` mounts `element` with Soundor's real React renderer into a new view
in the test's runtime, applies every update it causes, and resolves when it
has. Await it.

```tsx
const { rerender, unmount } = await render(<GainFader />);
await rerender(<GainFader disabled />);
await unmount();
```

## Options

| Option      | What it does                                                               |
| ----------- | -------------------------------------------------------------------------- |
| `container` | Render into this node instead of a new one; queries are then scoped to it. |
| `wrapper`   | A component around the element: context providers, say.                    |

## The result

| Field                                   | What it is                                                  |
| --------------------------------------- | ----------------------------------------------------------- |
| `container`                             | The node the element rendered into.                         |
| `getByRole`, `queryByText`, … , `debug` | The [queries](/docs/testing/queries), as `screen` has them. |
| `rerender(element)`                     | Renders a new element into the same root (new props, say).  |
| `unmount()`                             | Unmounts it, running effects' cleanups.                     |

## Good to know

- **Cleanup is automatic:** every root is unmounted after each test, even a
  failed one. `await cleanup()` unmounts them all earlier.
- **`screen` sees everything** the test rendered, portals and modals
  included; prefer it to the result's queries.
- **`act`** is exported too, for updates from outside React that a test
  makes itself: `await act(() => store.update())`. Testing Library's own
  calls are already wrapped.
- **One test at a time** in a file: `test.concurrent` is not supported (test
  files still run in parallel).
