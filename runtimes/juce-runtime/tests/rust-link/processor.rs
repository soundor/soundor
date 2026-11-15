//! Link fixture: an independent Rust staticlib with the standard library and
//! unwind support, alongside the prebuilt C++ engine in a real JUCE VST3.

#[unsafe(no_mangle)]
pub extern "C" fn soundor_rust_initialize() -> usize {
    // Initialization is outside the audio callback. Pull in std and unwind
    // machinery so the original AccessKit runtime-symbol conflict is covered.
    std::panic::catch_unwind(|| std::hint::black_box(vec![0.5_f32; 8]).len()).unwrap_or(0)
}

/// # Safety
/// `samples` must address `count` writable floats for the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn soundor_rust_process(samples: *mut f32, count: usize, gain: f32) {
    let buffer = unsafe { std::slice::from_raw_parts_mut(samples, count) };
    for sample in buffer {
        *sample *= gain;
    }
}
