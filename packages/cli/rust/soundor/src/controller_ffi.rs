//! The controller's C ABI: what [`export!`](crate::export) defines beside
//! the processor's, and what a native runtime calls (the engine's
//! `RustControllerAbi.h` declares the same).
//!
//! - Every structure starts with its `size` and the
//!   [`CONTROLLER_ABI_VERSION`]; the engine checks the controller's
//!   descriptor, its native methods and types, against what it was
//!   generated from.
//! - A controller is an opaque handle, one per plugin instance, made by
//!   `create` and freed by `destroy`. Every call but `create` and `destroy`
//!   is on the control thread, one at a time; `destroy` too, after the
//!   others.
//! - Arguments and results cross as [`crate::wire`] bytes. Bytes for the
//!   other side go through a [`SoundorWriter`], which copies them, so each
//!   side frees only its own memory.
//! - Nothing unwinds across the boundary: a panic becomes a status and a
//!   message.

use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

use crate::controller::{CallError, Instance, Ran};
use crate::ffi::Handle;
use crate::host::Host;
pub use crate::host::{
    CONTROLLER_ABI_VERSION, HistoryAction, SoundorControllerHost, SoundorWriter,
};
use crate::plugin::{DESCRIPTOR, METHODS, NativeMethods, ResourceSlots};
use crate::processor::Processor;

/// What the controller was built from.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SoundorControllerInfo {
    pub size: u32,
    pub abi_version: u32,
    /// 1 when the plugin exports a controller (`export!(P, C)`), 0 when it
    /// exports a processor only.
    pub present: u32,
    pub method_count: u32,
    /// The descriptor of its native methods and types, as the runtime's
    /// generated code has it: equal bytes, or a stale build.
    pub descriptor: *const u8,
    pub descriptor_size: usize,
}

impl Default for SoundorControllerInfo {
    fn default() -> Self {
        Self {
            size: 0,
            abi_version: 0,
            present: 0,
            method_count: 0,
            descriptor: std::ptr::null(),
            descriptor_size: 0,
        }
    }
}

/// A call's status.
pub mod status {
    /// It succeeded; the result was written.
    pub const OK: i32 = 0;
    /// The method failed; its message was written.
    pub const FAILED: i32 = 1;
    /// No such method, the other kind of method, or malformed arguments.
    pub const INVALID: i32 = 2;
    /// The controller panicked; the message was written.
    pub const PANICKED: i32 = 3;
    /// A call during one of the controller's own calls.
    pub const REENTRANT: i32 = 4;
    /// The plugin instance shut down.
    pub const SHUT_DOWN: i32 = 5;
}

/// What `soundor_controller_run` did.
pub mod ran {
    /// The control queue was empty.
    pub const NOTHING: i32 = 0;
    /// It ran one scheduled callback.
    pub const TASK: i32 = 1;
    /// An async method succeeded: its operation, and its result written.
    pub const COMPLETED: i32 = 2;
    /// An async method failed: its operation, and its message written.
    pub const FAILED: i32 = 3;
    /// Called during one of the controller's own calls.
    pub const REENTRANT: i32 = 4;
}

fn code(error: &CallError) -> i32 {
    match error {
        CallError::NoSuchMethod | CallError::WrongKind | CallError::Malformed(_) => status::INVALID,
        CallError::Reentrant => status::REENTRANT,
        CallError::ShutDown => status::SHUT_DOWN,
        CallError::Panicked(_) => status::PANICKED,
        CallError::Failed(_) => status::FAILED,
    }
}

/// `soundor_controller_info`.
pub fn info(present: bool) -> SoundorControllerInfo {
    SoundorControllerInfo {
        size: std::mem::size_of::<SoundorControllerInfo>() as u32,
        abi_version: CONTROLLER_ABI_VERSION,
        present: u32::from(present),
        method_count: METHODS.len() as u32,
        descriptor: DESCRIPTOR.as_ptr(),
        descriptor_size: DESCRIPTOR.len(),
    }
}

/// The controller behind a handle.
pub struct ControllerHandle<C: NativeMethods> {
    instance: Instance<C>,
}

/// `soundor_controller_create`: null when `host` is not usable, or a store's
/// construction panicked. `processor` is the plugin instance's processor
/// (`soundor_processor_create`'s handle), whose audio resources the
/// controller publishes to, or null for none.
///
/// # Safety
///
/// `host` is null or valid for the call, and its callbacks valid until
/// `destroy`; `processor` is null or a live handle of `P`, used only during
/// the call.
pub unsafe fn create<P: Processor, C: NativeMethods>(
    host: *const SoundorControllerHost,
    processor: *mut c_void,
) -> *mut ControllerHandle<C> {
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: as the caller promises.
        let Some(table) = (unsafe { host.as_ref() }) else {
            return std::ptr::null_mut();
        };
        let Some(host) = Host::new(*table) else {
            return std::ptr::null_mut();
        };
        // SAFETY: as the caller promises.
        let slots = match unsafe { processor.cast::<Handle<P>>().as_ref() } {
            Some(processor) => processor.resource_slots(),
            None => Arc::new(ResourceSlots::default()),
        };
        let wake = host.waker();
        Box::into_raw(Box::new(ControllerHandle {
            instance: Instance::<C>::new(host, wake, slots),
        }))
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// `soundor_controller_destroy`: shuts the controller down (its queued
/// callbacks never run, its tasks are dropped, its worker joined) and frees
/// it.
///
/// # Safety
///
/// `handle` is null, or came from [`create`] and is not used again.
pub unsafe fn destroy<C: NativeMethods>(handle: *mut ControllerHandle<C>) {
    if handle.is_null() {
        return;
    }
    // SAFETY: as the caller promises.
    let owned = unsafe { Box::from_raw(handle) };
    let _ = catch_unwind(AssertUnwindSafe(move || drop(owned)));
}

/// # Safety
///
/// `pointer` is null or valid for `length` bytes.
unsafe fn bytes<'a>(pointer: *const u8, length: usize) -> &'a [u8] {
    if pointer.is_null() || length == 0 {
        &[]
    } else {
        // SAFETY: as the caller promises.
        unsafe { std::slice::from_raw_parts(pointer, length) }
    }
}

/// `soundor_controller_call`: a synchronous method, its result (or its
/// failure's message) written to `out`.
///
/// # Safety
///
/// `handle` came from [`create`]; `args` is valid for `length` bytes.
pub unsafe fn call<C: NativeMethods>(
    handle: *mut ControllerHandle<C>,
    method: u32,
    args: *const u8,
    length: usize,
    out: SoundorWriter,
) -> i32 {
    // SAFETY: as the caller promises.
    let Some(handle) = (unsafe { handle.as_ref() }) else {
        return status::INVALID;
    };
    // SAFETY: as the caller promises.
    let args = unsafe { bytes(args, length) };
    match catch_unwind(AssertUnwindSafe(|| handle.instance.call(method, args))) {
        Ok(Ok(result)) => {
            out.send(&result);
            status::OK
        }
        Ok(Err(error)) => {
            out.send(error.message().as_bytes());
            code(&error)
        }
        Err(_) => status::PANICKED,
    }
}

/// `soundor_controller_start`: starts an async method as `operation`; its
/// completion comes back from `soundor_controller_run`. On a failure to
/// start, its message is written to `error`.
///
/// # Safety
///
/// As [`call`].
pub unsafe fn start<C: NativeMethods>(
    handle: *mut ControllerHandle<C>,
    method: u32,
    operation: u64,
    args: *const u8,
    length: usize,
    error: SoundorWriter,
) -> i32 {
    // SAFETY: as the caller promises.
    let Some(handle) = (unsafe { handle.as_ref() }) else {
        return status::INVALID;
    };
    // SAFETY: as the caller promises.
    let args = unsafe { bytes(args, length) };
    match catch_unwind(AssertUnwindSafe(|| {
        handle.instance.start(method, operation, args)
    })) {
        Ok(Ok(())) => status::OK,
        Ok(Err(failure)) => {
            error.send(failure.message().as_bytes());
            code(&failure)
        }
        Err(_) => status::PANICKED,
    }
}

/// `soundor_controller_cancel`: `operation`'s completion never comes back,
/// and its future is dropped.
///
/// # Safety
///
/// `handle` came from [`create`].
pub unsafe fn cancel<C: NativeMethods>(handle: *mut ControllerHandle<C>, operation: u64) {
    // SAFETY: as the caller promises.
    if let Some(handle) = unsafe { handle.as_ref() } {
        let _ = catch_unwind(AssertUnwindSafe(|| handle.instance.cancel(operation)));
    }
}

/// `soundor_controller_run`: runs the control queue's next item (see
/// [`ran`]). Call it again until it returns [`ran::NOTHING`], letting the
/// rest of the control thread's work run in between as it needs.
///
/// # Safety
///
/// `handle` came from [`create`]; `operation` is writable.
pub unsafe fn run<C: NativeMethods>(
    handle: *mut ControllerHandle<C>,
    operation: *mut u64,
    out: SoundorWriter,
) -> i32 {
    // SAFETY: as the caller promises.
    let (Some(handle), Some(operation)) =
        (unsafe { handle.as_ref() }, unsafe { operation.as_mut() })
    else {
        return ran::NOTHING;
    };
    match catch_unwind(AssertUnwindSafe(|| handle.instance.run())) {
        Ok(Ok(Ran::Nothing)) | Err(_) => ran::NOTHING,
        Ok(Ok(Ran::Task)) => ran::TASK,
        Ok(Ok(Ran::Completion {
            operation: id,
            result,
        })) => {
            *operation = id;
            match result {
                Ok(bytes) => {
                    out.send(&bytes);
                    ran::COMPLETED
                }
                Err(message) => {
                    out.send(message.as_bytes());
                    ran::FAILED
                }
            }
        }
        Ok(Err(_)) => ran::REENTRANT,
    }
}

/// The exported functions, for tests that call the very symbols a runtime
/// links (see [`crate::testing::NativeController`]).
#[derive(Clone, Copy)]
pub struct ControllerExports {
    pub info: unsafe extern "C" fn(*mut SoundorControllerInfo) -> i32,
    pub create: unsafe extern "C" fn(*const SoundorControllerHost, *mut c_void) -> *mut c_void,
    pub destroy: unsafe extern "C" fn(*mut c_void),
    pub call: unsafe extern "C" fn(*mut c_void, u32, *const u8, usize, SoundorWriter) -> i32,
    pub start: unsafe extern "C" fn(*mut c_void, u32, u64, *const u8, usize, SoundorWriter) -> i32,
    pub cancel: unsafe extern "C" fn(*mut c_void, u64),
    pub run: unsafe extern "C" fn(*mut c_void, *mut u64, SoundorWriter) -> i32,
}

/// Defines the controller's C functions for `export!`.
#[doc(hidden)]
#[macro_export]
macro_rules! __export_controller {
    (@symbols $present:expr, $create:expr, $destroy:expr, $call:expr, $start:expr, $cancel:expr, $run:expr) => {
        /// The controller's ABI, as `soundor::export!` defines it.
        #[doc(hidden)]
        #[cfg(not(target_family = "wasm"))]
        pub mod __soundor_controller_exports {
            use super::*;
            use ::std::ffi::c_void;
            use $crate::ffi::controller::{SoundorControllerHost, SoundorControllerInfo, SoundorWriter};

            /// Fills in what the controller was built from.
            ///
            /// # Safety
            /// `info` is null or writable.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_controller_info(info: *mut SoundorControllerInfo) -> i32 {
                // SAFETY: as the caller promises.
                match unsafe { info.as_mut() } {
                    Some(info) => {
                        *info = $crate::ffi::controller::info($present);
                        0
                    }
                    None => 1,
                }
            }

            /// # Safety
            /// See `soundor::ffi::controller::create`.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_controller_create(
                host: *const SoundorControllerHost,
                processor: *mut c_void,
            ) -> *mut c_void {
                // SAFETY: as the caller promises.
                unsafe { ($create)(host, processor) }
            }

            /// # Safety
            /// See `soundor::ffi::controller::destroy`.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_controller_destroy(handle: *mut c_void) {
                // SAFETY: as the caller promises.
                unsafe { ($destroy)(handle) }
            }

            /// # Safety
            /// See `soundor::ffi::controller::call`.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_controller_call(
                handle: *mut c_void,
                method: u32,
                args: *const u8,
                length: usize,
                out: SoundorWriter,
            ) -> i32 {
                // SAFETY: as the caller promises.
                unsafe { ($call)(handle, method, args, length, out) }
            }

            /// # Safety
            /// See `soundor::ffi::controller::start`.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_controller_start(
                handle: *mut c_void,
                method: u32,
                operation: u64,
                args: *const u8,
                length: usize,
                error: SoundorWriter,
            ) -> i32 {
                // SAFETY: as the caller promises.
                unsafe { ($start)(handle, method, operation, args, length, error) }
            }

            /// # Safety
            /// See `soundor::ffi::controller::cancel`.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_controller_cancel(handle: *mut c_void, operation: u64) {
                // SAFETY: as the caller promises.
                unsafe { ($cancel)(handle, operation) }
            }

            /// # Safety
            /// See `soundor::ffi::controller::run`.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_controller_run(
                handle: *mut c_void,
                operation: *mut u64,
                out: SoundorWriter,
            ) -> i32 {
                // SAFETY: as the caller promises.
                unsafe { ($run)(handle, operation, out) }
            }

            /// The functions above, for tests.
            pub fn exports() -> $crate::ffi::controller::ControllerExports {
                $crate::ffi::controller::ControllerExports {
                    info: soundor_controller_info,
                    create: soundor_controller_create,
                    destroy: soundor_controller_destroy,
                    call: soundor_controller_call,
                    start: soundor_controller_start,
                    cancel: soundor_controller_cancel,
                    run: soundor_controller_run,
                }
            }
        }
    };
    (none) => {
        $crate::__export_controller!(@symbols false,
            |_: *const SoundorControllerHost, _: *mut c_void| -> *mut c_void { ::std::ptr::null_mut() },
            |_: *mut c_void| {},
            |_: *mut c_void, _: u32, _: *const u8, _: usize, _: SoundorWriter| -> i32 {
                $crate::ffi::controller::status::INVALID
            },
            |_: *mut c_void, _: u32, _: u64, _: *const u8, _: usize, _: SoundorWriter| -> i32 {
                $crate::ffi::controller::status::INVALID
            },
            |_: *mut c_void, _: u64| {},
            |_: *mut c_void, _: *mut u64, _: SoundorWriter| -> i32 { $crate::ffi::controller::ran::NOTHING }
        );
    };
    ($processor:ty, $controller:ty) => {
        $crate::__export_controller!(@symbols true,
            |host: *const SoundorControllerHost, processor: *mut c_void| -> *mut c_void {
                // SAFETY: as the exported function's caller promises.
                unsafe { $crate::ffi::controller::create::<$processor, $controller>(host, processor) }.cast()
            },
            |handle: *mut c_void| {
                // SAFETY: as above.
                unsafe { $crate::ffi::controller::destroy::<$controller>(handle.cast()) }
            },
            |handle: *mut c_void, method: u32, args: *const u8, length: usize, out: SoundorWriter| -> i32 {
                // SAFETY: as above.
                unsafe { $crate::ffi::controller::call::<$controller>(handle.cast(), method, args, length, out) }
            },
            |handle: *mut c_void, method: u32, operation: u64, args: *const u8, length: usize, error: SoundorWriter| -> i32 {
                // SAFETY: as above.
                unsafe {
                    $crate::ffi::controller::start::<$controller>(handle.cast(), method, operation, args, length, error)
                }
            },
            |handle: *mut c_void, operation: u64| {
                // SAFETY: as above.
                unsafe { $crate::ffi::controller::cancel::<$controller>(handle.cast(), operation) }
            },
            |handle: *mut c_void, operation: *mut u64, out: SoundorWriter| -> i32 {
                // SAFETY: as above.
                unsafe { $crate::ffi::controller::run::<$controller>(handle.cast(), operation, out) }
            }
        );
    };
}
