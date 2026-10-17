---
title: 'user.press'
description: 'Focuses a control and presses Enter: activating it from the keyboard.'
---

```ts
await user.press(node: NodeTarget): Promise<void>;
```

Focuses `node`, which must be focusable, then presses and releases Enter:
how a keyboard user activates a control.

```ts
await user.press(screen.getByRole('button', { name: 'Save' }));
```

## Good to know

- **It checks keyboard access:** a control that works with `click` but not
  with `press` is one a keyboard user cannot use.
- **A node that is not focusable throws**, saying so.
- To reach the control by tabbing, as a user would, use
  [`tab`](/docs/testing/tab) and [`keyboard('{Enter}')`](/docs/testing/keyboard).
