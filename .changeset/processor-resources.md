---
'@soundor/core': minor
'@soundor/config': minor
'soundor': minor
---

The Rust audio processor gains audio resources: immutable data of any length that the processing reads, such as a wavetable, an impulse response or a lookup table. Declare them under `native.resources` (`wavetable: { type: 'buffer<float32>' }`), publish them from `prepare()` (`ctx.resources.wavetable.publish(table)`, which moves the value instead of copying it), and read them in `process()` (`ctx.resources.wavetable.get()`, a `&[f32]` that stays the same for the whole block). The latest publication wins.

Taking and reading a resource never allocates, frees, locks or waits. A replaced resource is freed off the audio thread: by the next publication, the next `prepare()`, or when the processor is destroyed. Resources are not saved with the plugin and are not part of presets or History. They live in the Rust SDK alone, so the processor ABI is unchanged.
