# @soundor/test-runtime

Internal, framework independent simulation of Soundor's observable runtime.
It executes JavaScript in Node, without React, Vitest, Hermes, JUCE or a browser.
Applications normally install the Vitest integration and Testing Library rather
than this package directly.

```ts
import { createTestRuntime } from '@soundor/test-runtime';
const runtime = createTestRuntime({
  parameters: [
    { id: 'gain', label: 'Gain', type: 'float', min: 0, max: 1, default: 0.5 },
  ],
});
const node = runtime.create('view', { opacity: 0 });
runtime.root.appendChild(node);
const animation = node.animate([{ opacity: 1 }], {
  duration: 250,
  fill: 'forwards',
});
runtime.advanceTime(125);
console.log(node.presentation.opacity); // 0.5; base style stays at 0
runtime.advanceTime(125);
await animation.finished;
runtime.dispose();
```

Each instance owns its roots, registry, focus, pointer and keyboard state,
parameter subscriptions, service mocks, storage, animations and virtual clock.
Cross-instance tree insertion and animation targets fail. Disposal is idempotent,
cancels animations, removes listeners and clears clock callbacks and stored data.
Use a fresh instance for each test.

`fire`, `TestEvent`, `pressKey`, `releaseKey` and pointer operations provide
capture, target and bubble dispatch, input default actions and focus traversal.
Pressables recognize keyboard activation and virtual-clock long presses.
`semantics()` returns Soundor roles, accessible names, descriptions, state and
values, using semantic ownership for portals and hiding content outside the
active modal. It reports `textinput` and `adjustable`, rather than DOM roles.

Parameters use the production Web runtime's clamping, rounding, enum validation,
change notifications and nested gesture semantics. `setHost` publishes snapshots;
`mockNative` configures deterministic functions (missing mocks throw).
Storage serializes JSON on write and returns independent copies on read.

Animations expose playback, seeking, completion, cancellation, repetition,
sequence/parallel/stagger descriptions and observable `presentation`. The spring
solver is shared with the Web runtime through `@soundor/core/spring`.
Only `activeAnimations` are sampled;
`animations` tracks live ownership (running, paused, and retained forward fills).
Completed effects without forward fill and cancelled effects leave both runtime
and node registries. Presentation looks up only a node's owners. Replayable
handles retain their own compiled description and reacquire ownership on replay.
Explicit node removal cancels programs targeting its subtree, including programs
with other targets; reparenting preserves them. Disposal clears all ownership.
The temporary React test adapter records animation call history separately for
existing renderer assertions and clears that history between tests.

Modal focus eligibility uses the same semantic ownership/visibility snapshot as
`semantics()`. Tab and new direct focus requests exclude background controls,
including content outside the active nested modal, and include portals owned by
that modal. This models Soundor's full modal behavior without React: the raw
native surface's accessibility modal flag only filters its semantic tree;
React's `Modal` supplies its keyboard trap through `FocusScope`. As on the native
surface, hiding a currently focused node retains focus until it moves; Tab skips
hidden nodes, and detaching the focused subtree clears focus without a blur.

Explicit simulated removal releases animation work immediately; native raw tree
detachment keeps externally held animation handles until cancellation or node
release. This deliberate eager cleanup avoids depending on garbage collection in
tests. Both runtimes preserve animations during reparenting.

`advanceTime` also drives long-press callbacks. It does not advance Node timers.

Limitations: no layout, graphics, pixel hit testing, audio, engine execution or
persistent files. Geometry getters fail explicitly; canvas contexts return null.
Paint animation interpolation accepts hex colors and transparent. JavaScript
callbacks execute synchronously during clock advancement; completion uses normal
promise microtasks. This simulation cannot validate native rendering or DSP.

Vitest integration uses the worker context helpers (`getTestRuntime`,
`subscribeTestRuntime`, and lifecycle/cleanup helpers) exported by this internal
package. The environment owns a symbol-keyed worker context shared across Node
and Vite module copies. Creating ordinary standalone runtimes does not install
or modify that context. Consumer tests normally access the active runtime via
Testing Library queries, focus assertions and simulated setup helpers instead.
`getTestRuntime` from `@soundor/vitest` is a deprecated advanced escape hatch.
