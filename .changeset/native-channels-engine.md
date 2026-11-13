---
'@soundor/engine': minor
---

Latest-value channels (`soundor/js/Channels.h`): `js::ValueChannel<T>` and `js::BufferChannel<T>` carry a number, or a buffer of up to `maxLength` numbers, from one producer thread to the UI. Publishing (`publish()`, or a buffer's `buffer()` then `commit()`, in place) takes no lock, never allocates and never waits, so the audio callback can publish: a triple buffer hands whole values over with one atomic exchange, and the UI never reads a partly written one. `RuntimeHost::tick()` delivers the newest value of each connected channel (`js::deliverChannels()`), skipping the ones in between, so a slow, hidden or closed UI accumulates nothing; a context connected later starts with the value published last. `TickStatistics::channels` times it, `Channel::statistics()` counts what was published and taken, and `soundor_channel_benchmark` measures it. Bindings connect channels with `bind::connectChannels()` and export them with `bind::installChannels()`.
