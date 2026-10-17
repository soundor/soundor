---
title: 'within'
description: 'Queries inside one node: a dialog, a panel, a list item.'
---

```ts
within(node: NodeTarget): Queries;
```

`within(node)` has every [query](/docs/testing/queries), limited to what is
inside `node`: useful when the same control appears in several places.

```ts
const dialog = screen.getByRole('dialog', { name: 'Preset settings' });
await user.click(within(dialog).getByRole('button', { name: 'Save' }));
```

## Good to know

- **Inside means as assistive technology sees it:** a portal opened from a
  dialog belongs to the dialog, wherever it draws.
- `render(…, { container })` returns queries scoped the same way.
