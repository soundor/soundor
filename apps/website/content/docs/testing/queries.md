---
title: 'Queries'
description: 'Find nodes as a user does: by role, text or label; one or all; now or eventually.'
---

Queries find nodes as a user does: by what they are and what they are
called. Every query comes in variants:

| Variant       | Finds                | When nothing matches  | When several match |
| ------------- | -------------------- | --------------------- | ------------------ |
| `getBy…`      | One node             | Throws                | Throws             |
| `queryBy…`    | One node             | `null`                | Throws             |
| `getAllBy…`   | Every match          | Throws                | An array           |
| `queryAllBy…` | Every match          | `[]`                  | An array           |
| `findBy…`     | One node, awaited    | Rejects after waiting | Rejects            |
| `findAllBy…`  | Every match, awaited | Rejects after waiting | An array           |

The three queries: [`ByRole`](/docs/testing/by-role) (first choice),
[`ByLabelText`](/docs/testing/by-label-text) and
[`ByText`](/docs/testing/by-text).

```ts
screen.getByRole('button', { name: 'Save' }); // it must be there
expect(screen.queryByRole('dialog')).toBeNull(); // it must not
await screen.findByText('Preset loaded'); // it will be
```

## `screen` and `within`

`screen` queries everything the test rendered, portals and modals included.
[`within(node)`](/docs/testing/within) queries inside one node.

## Text matching

A name or text is matched by a string (whole, whitespace normalized), a
regular expression, or a function `(text, node) => boolean`. Options:

| Option       | What it does                                              |
| ------------ | --------------------------------------------------------- |
| `exact`      | `false` matches part of the text, ignoring case.          |
| `hidden`     | `true` also finds hidden nodes, and those behind a modal. |
| `normalizer` | Replaces the default whitespace normalization.            |

## `screen.debug()`

Prints the semantic tree (roles, names, states, values), as assistive
technology sees it, bounded in size. A query that finds nothing, or too
much, prints it in its error.

```ts
screen.debug(); // everything
screen.debug(screen.getByRole('dialog')); // one part
```
