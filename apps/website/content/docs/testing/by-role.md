---
title: 'ByRole'
description: 'Finds nodes by their accessibility role and name: the first query to reach for.'
---

```ts
screen.getByRole(role: AccessibilityRole, options?: RoleOptions): TestNode;
// also queryByRole, getAllByRole, queryAllByRole, findByRole, findAllByRole
```

Finds nodes by their role (`button`, `adjustable`, `textinput`, `dialog`,
…) and, usually, their accessible name: what a screen reader announces. A
test that finds a control this way also checks that it is accessible.

```ts
screen.getByRole('button', { name: 'Reset gain' });
screen.getByRole('adjustable', { name: 'Gain', value: { now: 0.5 } });
screen.getByRole('switch', { name: 'Bypass', checked: true });
```

## Options

| Option                          | Matches                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| `name`                          | The accessible name: a string, regular expression or function.        |
| `description`                   | The accessible description (the hint).                                |
| `disabled`                      | Disabled, or not.                                                     |
| `selected`                      | Selected, or not.                                                     |
| `checked`                       | `true`, `false` or `'mixed'`.                                         |
| `expanded`                      | Expanded, or not.                                                     |
| `busy`                          | Busy, or not.                                                         |
| `value`                         | `{ min, max, now, text }`: an adjustable's or a progress bar's value. |
| `exact`, `hidden`, `normalizer` | As for every [query](/docs/testing/queries#text-matching).            |

## Good to know

- **Roles are Soundor's:** a `Pressable` is a `button` unless given another
  role, a `TextInput` is a `textinput`, a `Modal` a `dialog`. See
  [Accessibility](/docs/components/accessibility) for every role and default.
- **The name** is the label (`accessibilityLabel`), else the text inside: a
  `Pressable` with `<Text>Save</Text>` is the button "Save".
- **Hidden nodes,** and everything behind an open modal, are not found unless
  `hidden: true`: as a screen reader would not find them.
