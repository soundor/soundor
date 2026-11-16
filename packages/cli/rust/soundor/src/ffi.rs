//! The C ABI between a runtime and the processor: what [`export!`](crate::export)
//! defines in the project's crate, and what the JUCE runtime calls
//! (`RustProcessor.h` declares the same structures).
//!
//! Its rules:
//!
//! - Every structure starts with its `size` and the `abi_version`; a call
//!   with another version returns [`Status::AbiMismatch`]. Fields are only
//!   ever added at the end, with a new version.
//! - The processor is an opaque handle, made by `create` and freed by
//!   `destroy`, both outside the audio thread. Every other call takes it.
//! - The runtime owns every buffer it passes, for the duration of the call:
//!   counts are explicit, and nothing is kept after a call returns.
//! - Nothing unwinds across the boundary: a panic becomes a status, and the
//!   processor stays silent until prepared again.
//! - The calls on one handle never overlap; `process` and `reset` are
//!   realtime-safe, `create`, `prepare` and `destroy` are not.

use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};

use crate::ABI_VERSION;
pub use crate::instance::Status;
use crate::instance::{Block, Instance, MAX_BUSES};
use crate::plugin::{PUBLISHED, Parameters, STATE_SIZE, STREAMS, StateSnapshot};
use crate::processor::Processor;
use crate::streams::{NoStreams, StreamSink};
use crate::transport::Transport;

/// What the processor was built from: the runtime checks it against what it
/// was generated from, so a stale build is refused rather than misread.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SoundorProcessorInfo {
    pub size: u32,
    pub abi_version: u32,
    pub parameter_count: u32,
    pub published_count: u32,
    pub stream_count: u32,
    /// The size of the state snapshot the processor reads.
    pub state_size: u32,
}

/// `prepare`'s configuration.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SoundorPrepare {
    pub size: u32,
    pub abi_version: u32,
    pub sample_rate: f64,
    pub max_frames: u32,
    pub input_bus_count: u32,
    /// `input_bus_count` channel counts.
    pub input_channels: *const u32,
    pub output_bus_count: u32,
    /// `output_bus_count` channel counts.
    pub output_channels: *const u32,
    /// Every parameter's current plain value, in the config's order, as the
    /// processor's `prepare` sees them; null keeps the last ones.
    pub parameter_count: u32,
    pub parameters: *const f64,
    /// The state the processor reads, as `prepare` sees it: `state_size`
    /// bytes laid out as [`StateSnapshot`], aligned for it; null is the
    /// config's defaults.
    pub state_size: u32,
    pub state: *const c_void,
}

/// The host's transport; NaN where the host does not say.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SoundorTransport {
    pub tempo: f64,
    pub time_seconds: f64,
    pub position_beats: f64,
    /// Bit 0: playing.
    pub flags: u32,
    /// 0 when the host does not say.
    pub time_signature_numerator: u32,
    pub time_signature_denominator: u32,
}

impl SoundorTransport {
    fn read(&self) -> Transport {
        let known = |value: f64| value.is_finite().then_some(value);
        Transport {
            playing: self.flags & 1 != 0,
            tempo: known(self.tempo).filter(|tempo| *tempo > 0.0),
            time_signature: (self.time_signature_numerator > 0
                && self.time_signature_denominator > 0)
                .then_some((
                    self.time_signature_numerator,
                    self.time_signature_denominator,
                )),
            time_seconds: known(self.time_seconds),
            position_beats: known(self.position_beats),
        }
    }
}

/// The runtime's native streams, as callbacks. Each is realtime-safe.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SoundorStreamSink {
    pub user: *mut c_void,
    /// Publishes stream `index`'s value (a number stream).
    pub publish: Option<unsafe extern "C" fn(user: *mut c_void, index: u32, value: f64)>,
    /// Stream `index`'s storage (a buffer stream), of its element type, and
    /// its capacity in elements; null when it has none.
    pub buffer: Option<
        unsafe extern "C" fn(user: *mut c_void, index: u32, capacity: *mut u32) -> *mut c_void,
    >,
    /// Publishes the first `length` elements of stream `index`'s storage.
    pub commit: Option<unsafe extern "C" fn(user: *mut c_void, index: u32, length: u32)>,
}

struct NativeStreams<'a>(&'a SoundorStreamSink);

impl StreamSink for NativeStreams<'_> {
    fn publish(&self, index: u32, value: f64) {
        if let Some(publish) = self.0.publish {
            // SAFETY: the runtime passed this callback for this call.
            unsafe { publish(self.0.user, index, value) };
        }
    }

    fn buffer(&self, index: u32) -> (*mut u8, usize) {
        let Some(buffer) = self.0.buffer else {
            return (std::ptr::null_mut(), 0);
        };
        let mut capacity = 0;
        // SAFETY: as `publish`.
        let pointer = unsafe { buffer(self.0.user, index, &mut capacity) };
        let declared = STREAMS
            .get(index as usize)
            .and_then(|(_, length)| *length)
            .unwrap_or(0);
        (pointer.cast(), (capacity as usize).min(declared))
    }

    fn commit(&self, index: u32, length: usize) {
        if let Some(commit) = self.0.commit {
            let length = u32::try_from(length).unwrap_or(u32::MAX);
            // SAFETY: as `publish`.
            unsafe { commit(self.0.user, index, length) };
        }
    }
}

/// One block.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SoundorBlock {
    pub size: u32,
    pub abi_version: u32,
    pub frames: u32,
    /// One pointer per channel of each prepared input bus, in bus order.
    pub input_count: u32,
    pub inputs: *const *const f32,
    /// One pointer per channel of each prepared output bus, in bus order. Main
    /// input channel `c` may be the very pointer of main output channel `c`.
    pub output_count: u32,
    pub outputs: *const *mut f32,
    /// Every parameter's plain value, in the config's order; null keeps the
    /// last block's.
    pub parameter_count: u32,
    pub parameters: *const f64,
    /// Where the read-only parameters' values go, one per slot of
    /// `SoundorProcessorInfo::published_count`: NaN when the block published
    /// none. May be null.
    pub published_count: u32,
    pub published: *mut f64,
    /// May be null.
    pub transport: *const SoundorTransport,
    /// May be null.
    pub streams: *const SoundorStreamSink,
    /// The block's state: `state_size` bytes laid out as [`StateSnapshot`],
    /// aligned for it, which nothing writes during the call; null is the
    /// config's defaults.
    pub state_size: u32,
    pub state: *const c_void,
}

/// The state at `pointer`: `None` for null, and an error when its size or
/// alignment is not the snapshot's.
///
/// # Safety
///
/// `pointer` is null, or valid for `size` reads of a snapshot nothing
/// writes for `'a`.
unsafe fn state<'a>(
    pointer: *const c_void,
    size: u32,
) -> Result<Option<&'a StateSnapshot>, Status> {
    if pointer.is_null() {
        return Ok(None);
    }
    if size as usize != STATE_SIZE
        || !(pointer as usize).is_multiple_of(std::mem::align_of::<StateSnapshot>())
    {
        return Err(Status::InvalidArgument);
    }
    // SAFETY: as the caller promises; the runtime writes the snapshot with
    // its layout, so every field holds a valid value.
    Ok(Some(unsafe { &*pointer.cast::<StateSnapshot>() }))
}

/// The processor behind a handle.
pub struct Handle<P: Processor> {
    instance: Instance<P>,
}

impl<P: Processor> Handle<P> {
    /// Its resources' handoff, which the plugin's controller publishes to.
    pub(crate) fn resource_slots(&self) -> std::sync::Arc<crate::plugin::ResourceSlots> {
        self.instance.resource_slots()
    }
}

/// # Safety
///
/// `pointer` is null or valid for `count` reads.
unsafe fn slice<'a, T>(pointer: *const T, count: u32) -> Option<&'a [T]> {
    if count == 0 {
        return Some(&[]);
    }
    if pointer.is_null() || !(pointer as usize).is_multiple_of(std::mem::align_of::<T>()) {
        return None;
    }
    // SAFETY: as the caller promises.
    Some(unsafe { std::slice::from_raw_parts(pointer, count as usize) })
}

fn guarded(call: impl FnOnce() -> Status) -> i32 {
    catch_unwind(AssertUnwindSafe(call)).unwrap_or(Status::Panicked) as i32
}

/// What `soundor_processor_info` fills in.
pub fn info() -> SoundorProcessorInfo {
    SoundorProcessorInfo {
        size: std::mem::size_of::<SoundorProcessorInfo>() as u32,
        abi_version: ABI_VERSION,
        parameter_count: Parameters::COUNT as u32,
        published_count: PUBLISHED.len() as u32,
        stream_count: STREAMS.len() as u32,
        state_size: STATE_SIZE as u32,
    }
}

/// `soundor_processor_create`: null when the processor's construction panicked.
pub fn create<P: Processor>() -> *mut Handle<P> {
    catch_unwind(|| {
        Box::into_raw(Box::new(Handle {
            instance: Instance::<P>::new(),
        }))
    })
    .unwrap_or(std::ptr::null_mut())
}

/// `soundor_processor_destroy`.
///
/// # Safety
///
/// `handle` is null, or came from [`create`] and is not used again.
pub unsafe fn destroy<P: Processor>(handle: *mut Handle<P>) {
    if handle.is_null() {
        return;
    }
    // SAFETY: as the caller promises. A panicking drop is contained.
    let owned = unsafe { Box::from_raw(handle) };
    let _ = catch_unwind(AssertUnwindSafe(move || drop(owned)));
}

/// `soundor_processor_prepare`.
///
/// # Safety
///
/// `handle` came from [`create`]; `config` is null or valid, with its
/// arrays valid for their counts.
pub unsafe fn prepare<P: Processor>(handle: *mut Handle<P>, config: *const SoundorPrepare) -> i32 {
    guarded(|| {
        // SAFETY: as the caller promises.
        let (Some(handle), Some(config)) = (unsafe { handle.as_mut() }, unsafe { config.as_ref() })
        else {
            return Status::InvalidArgument;
        };
        if config.abi_version != ABI_VERSION
            || (config.size as usize) < std::mem::size_of::<SoundorPrepare>()
        {
            return Status::AbiMismatch;
        }
        if config.input_bus_count as usize > MAX_BUSES
            || config.output_bus_count as usize > MAX_BUSES
        {
            return Status::InvalidArgument;
        }
        let mut inputs = [0usize; MAX_BUSES];
        let mut outputs = [0usize; MAX_BUSES];
        // SAFETY: as the caller promises.
        let (Some(input_channels), Some(output_channels)) = (
            unsafe { slice(config.input_channels, config.input_bus_count) },
            unsafe { slice(config.output_channels, config.output_bus_count) },
        ) else {
            return Status::InvalidArgument;
        };
        for (count, &channels) in inputs.iter_mut().zip(input_channels) {
            *count = channels as usize;
        }
        for (count, &channels) in outputs.iter_mut().zip(output_channels) {
            *count = channels as usize;
        }
        let parameters = if config.parameters.is_null() {
            None
        } else {
            // SAFETY: as the caller promises.
            match unsafe { slice(config.parameters, config.parameter_count) } {
                Some(values) => Some(values),
                None => return Status::InvalidArgument,
            }
        };
        // SAFETY: as the caller promises.
        let state = match unsafe { state(config.state, config.state_size) } {
            Ok(state) => state,
            Err(status) => return status,
        };
        handle.instance.prepare(
            config.sample_rate,
            config.max_frames as usize,
            &inputs[..input_channels.len()],
            &outputs[..output_channels.len()],
            parameters,
            state,
        )
    })
}

/// `soundor_processor_process`.
///
/// # Safety
///
/// `handle` came from [`create`]; `block` is null or valid, its arrays valid
/// for their counts and each channel pointer for `frames` samples, as
/// [`SoundorBlock`] describes.
pub unsafe fn process<P: Processor>(handle: *mut Handle<P>, block: *const SoundorBlock) -> i32 {
    guarded(|| {
        // SAFETY: as the caller promises.
        let (Some(handle), Some(block)) = (unsafe { handle.as_mut() }, unsafe { block.as_ref() })
        else {
            return Status::InvalidArgument;
        };
        if block.abi_version != ABI_VERSION
            || (block.size as usize) < std::mem::size_of::<SoundorBlock>()
        {
            return Status::AbiMismatch;
        }
        // SAFETY: as the caller promises.
        let (Some(inputs), Some(outputs)) =
            (unsafe { slice(block.inputs, block.input_count) }, unsafe {
                slice(block.outputs, block.output_count)
            })
        else {
            return Status::InvalidArgument;
        };
        let parameters = if block.parameters.is_null() {
            None
        } else {
            // SAFETY: as the caller promises.
            match unsafe { slice(block.parameters, block.parameter_count) } {
                Some(values) => Some(values),
                None => return Status::InvalidArgument,
            }
        };
        // SAFETY: as the caller promises.
        let state = match unsafe { state(block.state, block.state_size) } {
            Ok(state) => state,
            Err(status) => return status,
        };
        // SAFETY: as the caller promises.
        let transport = unsafe { block.transport.as_ref() }
            .map(SoundorTransport::read)
            .unwrap_or_default();
        // SAFETY: as the caller promises.
        let sink = unsafe { block.streams.as_ref() };
        let native = sink.map(NativeStreams);
        let streams: &dyn StreamSink = match &native {
            Some(native) => native,
            None => &NoStreams,
        };
        let status = handle.instance.process(Block {
            frames: block.frames as usize,
            inputs,
            outputs,
            parameters,
            transport,
            streams,
            state,
        });
        if !block.published.is_null() {
            let count = (block.published_count as usize).min(PUBLISHED.len());
            // SAFETY: as the caller promises: `published_count` writable slots.
            let slots = unsafe { std::slice::from_raw_parts_mut(block.published, count) };
            slots.copy_from_slice(&handle.instance.published()[..count]);
        }
        status
    })
}

/// `soundor_processor_reset`.
///
/// # Safety
///
/// `handle` came from [`create`].
pub unsafe fn reset<P: Processor>(handle: *mut Handle<P>) -> i32 {
    guarded(|| {
        // SAFETY: as the caller promises.
        match unsafe { handle.as_mut() } {
            Some(handle) => handle.instance.reset(),
            None => Status::InvalidArgument,
        }
    })
}

/// The exported functions, for tests that call the very symbols a runtime
/// links (see [`crate::testing::NativeProcessor`]).
#[derive(Clone, Copy)]
pub struct Exports {
    pub info: unsafe extern "C" fn(*mut SoundorProcessorInfo) -> i32,
    pub create: unsafe extern "C" fn() -> *mut c_void,
    pub prepare: unsafe extern "C" fn(*mut c_void, *const SoundorPrepare) -> i32,
    pub process: unsafe extern "C" fn(*mut c_void, *const SoundorBlock) -> i32,
    pub reset: unsafe extern "C" fn(*mut c_void) -> i32,
    pub destroy: unsafe extern "C" fn(*mut c_void),
}

pub use crate::controller_ffi as controller;

/// Defines what a runtime calls: the processor's C ABI and, compiled to
/// WebAssembly, its module's exports (see [`crate::wasm`]), and natively the
/// controller's C ABI. Invoke it once, in the crate's root, with the type
/// that implements [`Processor`](crate::Processor), and the one that
/// implements [`Controller`](crate::Controller):
///
/// ```ignore
/// soundor::export!(PluginProcessor, PluginController);
/// ```
///
/// A controller must implement the config's generated
/// [`NativeMethods`](crate::NativeMethods): every method soundor.config
/// declares, with its types, which the compiler checks here. A controller is
/// required even when no methods are declared; the generated trait then
/// provides a blanket implementation.
#[macro_export]
macro_rules! export {
    ($processor:ty) => {
        compile_error!("Every Soundor plugin requires a controller: use soundor::export!(PluginProcessor, PluginController)");
    };
    ($processor:ty, $controller:ty) => {
        $crate::export!(@processor $processor);
        $crate::__export_controller!($processor, $controller);
        $crate::__export_wasm_controller!($controller);
    };
    (@processor $processor:ty) => {
        /// The processor's ABI, as `soundor::export!` defines it.
        #[doc(hidden)]
        pub mod __soundor_exports {
            use super::*;
            use ::std::ffi::c_void;
            use $crate::ffi::{Handle, SoundorBlock, SoundorPrepare, SoundorProcessorInfo};

            type __Exported = $processor;

            /// Fills in what the processor was built from.
            ///
            /// # Safety
            /// `info` is null or writable.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_processor_info(
                info: *mut SoundorProcessorInfo,
            ) -> i32 {
                // SAFETY: as the caller promises.
                match unsafe { info.as_mut() } {
                    Some(info) => {
                        *info = $crate::ffi::info();
                        0
                    }
                    None => 1,
                }
            }

            /// A new processor, or null.
            #[unsafe(no_mangle)]
            pub extern "C" fn soundor_processor_create() -> *mut c_void {
                $crate::ffi::create::<__Exported>().cast()
            }

            /// # Safety
            /// See `soundor::ffi::prepare`.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_processor_prepare(
                handle: *mut c_void,
                config: *const SoundorPrepare,
            ) -> i32 {
                // SAFETY: as the caller promises.
                unsafe {
                    $crate::ffi::prepare::<__Exported>(handle.cast::<Handle<__Exported>>(), config)
                }
            }

            /// # Safety
            /// See `soundor::ffi::process`.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_processor_process(
                handle: *mut c_void,
                block: *const SoundorBlock,
            ) -> i32 {
                // SAFETY: as the caller promises.
                unsafe {
                    $crate::ffi::process::<__Exported>(handle.cast::<Handle<__Exported>>(), block)
                }
            }

            /// # Safety
            /// See `soundor::ffi::reset`.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_processor_reset(handle: *mut c_void) -> i32 {
                // SAFETY: as the caller promises.
                unsafe { $crate::ffi::reset::<__Exported>(handle.cast::<Handle<__Exported>>()) }
            }

            /// # Safety
            /// See `soundor::ffi::destroy`.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_processor_destroy(handle: *mut c_void) {
                // SAFETY: as the caller promises.
                unsafe { $crate::ffi::destroy::<__Exported>(handle.cast::<Handle<__Exported>>()) }
            }

            /// The functions above, for tests.
            pub fn exports() -> $crate::ffi::Exports {
                $crate::ffi::Exports {
                    info: soundor_processor_info,
                    create: soundor_processor_create,
                    prepare: soundor_processor_prepare,
                    process: soundor_processor_process,
                    reset: soundor_processor_reset,
                    destroy: soundor_processor_destroy,
                }
            }
        }

        $crate::__export_wasm!($processor);
    };
}
