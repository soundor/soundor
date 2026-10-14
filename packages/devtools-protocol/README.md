# @soundor/devtools-protocol

Soundor Debug Protocol v1: browser-safe types and Zod validation schemas for
native UI developer tools. It depends on no runtime, engine, renderer or browser
UI. The local server lives in the `soundor` CLI and runs only during supported,
enabled development sessions.

## Session and transports

The CLI creates one server per development session, binding **127.0.0.1 only**.
Browser HTTP, browser WebSockets and native IPC share its actual selected port.
An implicit 4545 advances on collision; an explicitly configured port fails
with an actionable error. Sessions do not discover one another by port scanning.

`ctx.devtools` gives a supported runtime `endpoint`, `sessionId`, `token` and
`descriptorPath`. The JSON descriptor is created exclusively under
`.soundor/dev/sessions/<sessionId>.json` with mode 0600 (directory 0700 on Unix),
and removed on shutdown. Windows uses the user's project-directory access
permissions. Never log its contents or bake it into an artifact. A launcher can
give its child only the descriptor path through an environment variable, or a
future adapter can use another protected means to deliver the same credentials.
Direct CLI launch is not part of the protocol contract.

Native HTTP requests require `Authorization: Bearer <token>` and
`X-Soundor-Session: <sessionId>`; requests carrying browser Origin headers are
rejected. All requests validate Host to resist DNS rebinding. Native operations
are intended for a worker; tree access and mutations must be dispatched to the
engine's owning thread. Never issue blocking IPC on UI or audio threads.

1. `POST /runtime/register` with `{version:1, sessionId, name, runtime,
generation:1, capabilities, processId?}`. Receive `{version:1, targetId,
targetToken}`. Each registration gets a fresh unpredictable instance ID.
   Instance capabilities must be a subset of the runtime's static declaration.
2. Further requests also require `X-Soundor-Target` and
   `X-Soundor-Target-Token`. This prevents one registered instance from replying
   to another's commands, even within the same session.
3. `GET /runtime/poll` returns `{commands:[...]}` immediately when there is work
   or after up to 20 seconds. Keep one poll outstanding, off the owning thread.
4. `POST /runtime/messages` accepts one response or typed runtime event.
5. `POST /runtime/disconnect` unregisters the instance. Idle/crashed targets
   expire after 60 seconds. Reconnect by registration; old target IDs remain
   invalid. After a server restart obtain the new designated session descriptor.

Commands include `request`, `cancel`, `subscribe` (the union of browser event
subscriptions), and `resetControl`. Reset must clear highlights, picker mode,
profiling and any temporary overrides. Also reset independently when transport
is lost, without waiting for another poll. Drop cancelled and expired work
before it reaches the owning thread. Responses to cancelled requests are stale.

## Browser connections

Navigating to the dashboard grants no access to debugging data. Authorize it
with the `browserKey` from the protected session descriptor, or set
`devtools.open:true`: automatic opening uses a separate short-lived, one-use
ticket in a URL fragment. The page removes the fragment and exchanges it via
`POST /browser/auth` for a session-specific HttpOnly, SameSite=Strict cookie.
Neither keys nor ticket URLs are printed in logs. Only the credential-free URL
is shown. A ticket expires after 60 seconds and cannot be reused; the native
authentication token cannot authorize a browser.

Manual authorization reads a key from the descriptor; there is no server-side
filesystem-reading endpoint. Other local processes cannot obtain a browser
cookie merely by fetching the dashboard. Access depends on descriptor filesystem
permissions, including the user's Windows project ACLs. Cross-origin dashboard
and authentication requests are rejected. `/browser` upgrades only with that
cookie and an exact Origin matching this session's localhost or 127.0.0.1 URL.
Credentials never go in WebSocket URLs. Cookies are unique to each session, so
different projects on localhost do not share authentication.

The server sends `{type:'hello',version:1,sessionId,clientId,project}`. A browser
must answer `{type:'hello',version:1}` before issuing requests. Incompatible
clients are closed. Server WebSocket ping/pong drives heartbeat expiry.

## Requests, responses and identity

```ts
import type { Request, Response } from '@soundor/devtools-protocol';

const request: Request<'UI.getNode'> = {
  type: 'request',
  id: 'browser-request-1',
  targetId: 'instance-id',
  method: 'UI.getNode',
  params: { node: { generation: 1, id: 'engine-node-id' } },
};
// Response<'UI.getNode'> contains a DebugNode or a structured DebugError.
```

Every response repeats the browser request ID and target ID. The dispatcher
rewrites request IDs to unpredictable transport IDs before routing to a target;
the native response repeats that transport ID. Send either `result` or
`error:{code,message}`, never both. Schemas validate both requests and results.
Errors distinguish authentication, protocol mismatch, missing capabilities,
lost leases, stale nodes, disconnects, cancellation, timeouts and overload.

Node refs pair an opaque string ID with a positive generation, scoped by the
request's target ID. Never expose a pointer. Node IDs must never be reused
within a generation; removed IDs return STALE_NODE. On host replacement, send
`Runtime.generationChanged` with a strictly increasing generation. The server
invalidates pending work and requests control reset. Snapshots and node results
from another generation are rejected.

## Methods and events

| Methods                                              | Behavior                                                |
| ---------------------------------------------------- | ------------------------------------------------------- |
| Runtime.getTargets                                   | Current registered instance metadata and controller IDs |
| Control.acquire / release                            | Explicit per-target exclusive control                   |
| Events.subscribe                                     | Replace this browser's event subscription for a target  |
| UI.getTree / getNode                                 | Bounded actual engine snapshots, not a DOM tree         |
| UI.getLayout / getStyles / getAccessibility          | Available engine properties                             |
| UI.highlightNode / clearHighlight / setPickerEnabled | Native debug interaction, requires control              |
| Animation.getActive                                  | Actual animation metadata where supported               |
| Diagnostics.getMetrics / setRecording                | Read measured counters; control demand-driven recording |

Targets negotiate `inspector`, `accessibility`, `animations` and `performance`.
Unsupported operations return MISSING_CAPABILITY. Omit unsupported properties
rather than filling them with inferred values. Layout, base/computed styles,
presentation and accessibility are distinct JSON property groups.

Typed runtime events are `UI.treeChanged` (revision invalidation; subscribers
may request a new snapshot), `UI.nodeSelected`, `UI.pickerChanged`,
`Runtime.generationChanged`, `Console.message`, `Animation.changed` and
`Diagnostics.metrics`. Notifications are sent only to subscribers. Native
producers must coalesce geometry and revision notifications and enable expensive
instrumentation only when requested. `Runtime.targetsChanged` is a server event
delivered to every tab, including controller ownership changes.

The CLI reuses its source-mapped logging pipeline. Since the current shared log
file lacks instance IDs, these messages have `scope:'session'` and no target ID.
Instance-specific runtime log events carry a target ID and follow subscriptions.

## Leases and bounds

Observers can read without control. Acquire explicitly before native picking,
highlighting or profiling. A valid lease cannot be stolen: LEASE_BUSY identifies
another controller. Disconnect or heartbeat timeout releases it and sends reset.
At most one interactive command is outstanding per target; competing commands
receive BUSY and may retry after completion. Read-only operations may overlap.
The server validates ownership before forwarding every interactive command.

Messages are limited to 1 MiB; trees to 5000 nodes (with `truncated` reported),
sessions to 64 targets and 32 browser connections, pending requests to 64 and
native command queues to 128. Polls deliver at most 32 commands. Slow browser
connections exceeding their bounded outgoing buffer are disconnected. Commands
time out after 5 seconds. A browser can send `{type:'cancel',id}`. Shutdown
invalidates pending requests, subscriptions, transports and the descriptor.

Future E2E clients can reuse queries and controlled selection through this same
protocol. Input automation and audio processing are not part of v1.

## License

MIT
