---
title: 'ByText'
description: "Finds nodes by the text they show, including a text input's value and placeholder."
---

```ts
screen.getByText(text: TextMatch, options?: MatchOptions): TestNode;
// also queryByText, getAllByText, queryAllByText, findByText, findAllByText
```

Finds nodes by the text they show: a `Text`'s text (nested ones included),
and a text input's value or placeholder.

```ts
screen.getByText('0.50');
screen.getByText(/Test DAW · 96000 Hz/);
screen.getByText('Preset', { exact: false });
```

## Good to know

- **For what is not a control:** a value shown, a message. For a control,
  [`ByRole`](/docs/testing/by-role) with its name says more: what it is, and
  that a screen reader finds it.
- **Whitespace is normalized** and the whole text must match, unless
  `exact: false` (part of it, ignoring case) or a regular expression.
- Options as for every [query](/docs/testing/queries#text-matching).
