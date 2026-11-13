---
'@soundor/engine': minor
---

`js::EventSource` (`soundor/js/Events.h`) delivers native events from any thread to the JavaScript contexts connected to it: publishing queues a value for each, under a short lock, without running or waiting for JavaScript, and `RuntimeHost::tick()` delivers them (`js::deliverEvents()`) on the context's thread, in the order published. Each context holds at most `Options::capacity` (1024) undelivered events, drops newer ones and logs how many; with no context connected, an event is dropped; either side may go first. `TickStatistics::events` times the delivery. Bindings connect a source with `bind::connectEvents()`, export its subscribable `events` with `bind::installEvents()` and call them with `bind::dispatchEvent()`.
