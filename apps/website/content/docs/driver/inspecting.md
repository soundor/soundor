---
title: 'Inspecting UI'
description: "Read a running plugin's native node tree, a node's bounds, layout, styles and accessibility, and find nodes with locators."
---

Inspection reads the engine's own nodes: the tree the plugin really renders,
not a reconstruction of its components. It needs no control of the target.

## The tree

```ts
const tree = await driver.getTree();
// { generation, revision, roots, nodes, truncated }
for (const node of tree.nodes)
  console.log(node.ref.id, node.type, node.debugId, node.text);
```

`roots` are the content root and the overlay root (where portals and modals
show). Each node of the snapshot has its reference (`ref`: an opaque `id` and
the runtime `generation`), `type` (`View`, `Text`, `Image`, `Scroll`,
`Input`, `Canvas`), `parent` and `children`, `debugId` and `text` when it has
them, `bounds`, `visible`, `focused`, and a summary of its accessibility
(`exposed`, `role`, `name`). A snapshot holds at most 5000 nodes, with
`truncated` set beyond.

The types are those of
[`@soundor/devtools-protocol`](/docs/contribute/devtools-protocol), which
`@soundor/driver` re-exports (`DebugTree`, `DebugNode`, `DebugTarget`,
`NodeRef`).

## A node

```ts
const node = await driver.getNode(ref);
```

returns the node with all its details, in separate groups; a group or field
the runtime cannot report is left out:

- `properties`: per type, such as `focusable`, an image's `source`, an
  input's `placeholder` and selection, a canvas's buffer size;
- `layout`: `frame` (in its parent), `bounds` (in the view), `contentBox`,
  `scrollOffset`, and the view's `scale`;
- `styles.base`: the style the plugin set, normalized;
- `presentation`: the style as shown now, with animations applied;
- `accessibility`: `role`, `name`, `description`, `states`, `value`,
  `focusable`, `focused`, and whether assistive technology sees it.

`getLayout(ref)`, `getStyles(ref)` and `getAccessibility(ref)` read one group.

## Coordinates

`bounds` is the node's box in the view's **logical pixels**, from the
top-left corner of the plugin's view, as it is shown: after its ancestors'
scrolling and the transforms presented now (animations included), as the
rectangle around the transformed box. `layout.frame` is the laid-out box in
its parent, before any of that. A display's scale (`layout.scale`) turns
logical pixels into device pixels.
See [coordinates](/docs/components/events#coordinates).

## Locators

A locator is a query for one node of the selected target:

```ts
const reset = driver.getByDebugId('reset');
const gain = driver.getByRole('adjustable', { name: 'Gain' });
const title = driver.getByText('Orbit');
const loose = driver.getByText('orb', { exact: false }); // case-insensitive, part
```

| Locator                    | Finds                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| `getByDebugId(id)`         | The node whose `debugId` is `id`.                                          |
| `getByRole(role, options)` | A node assistive technology sees with `role`, and `options.name` if given. |
| `getByText(text, options)` | A text or input node showing `text`.                                       |

`debugId` is a prop of every component (and `node.debugId` in
`soundor:ui`), for tools only: neither shown nor read to assistive
technology, at most 128 characters. It is the stable way to find a node,
whatever its text or language. Roles are those of
[accessibility](/docs/components/accessibility); a name matches exactly,
unless `exact: false`.

A locator holds no node reference. Each call takes a fresh snapshot and finds
its node in it, so a locator made once keeps working when the node is
rendered again or the plugin reloads:

```ts
await reset.getNode(); // the node, with its details
await reset.getBounds(); // { x, y, width, height }
await reset.getLayout();
await reset.getStyles();
await reset.getAccessibility();
await reset.count(); // how many nodes match now
await reset.all(); // their snapshot entries
```

Reads expect exactly one match: none fails with `ELEMENT_NOT_FOUND` (listing
the debug IDs there are, for `getByDebugId`), several with
`AMBIGUOUS_ELEMENT` (listing them). When the node goes between finding
and reading it, the locator finds it again, a few times at most.

## Waiting

`waitFor()` waits until a locator's node is in a state, looking again after
short pauses (20 ms up to 250 ms) until `timeout` (the Driver's command
timeout):

```ts
await driver.getByDebugId('preset-menu').waitFor(); // visible
await driver.getByDebugId('spinner').waitFor({ state: 'detached' });
```

| `state`    | Waits until                                          |
| ---------- | ---------------------------------------------------- |
| `visible`  | one node matches and is visible (the default)        |
| `attached` | one node matches                                     |
| `hidden`   | no node matches, or the one that does is not visible |
| `detached` | no node matches                                      |

A timeout fails with `TIMEOUT`, saying what it saw last ("matches no node").
`isVisible()` answers at once, without waiting.
