//! What a runtime lends a controller: its Soundor services (parameters,
//! persistent state, History, presets) and a way to be woken, as a table of
//! C callbacks (`SoundorControllerHost`, mirrored by the engine's
//! `RustControllerAbi.h`). Every callback but `wake` runs on the control
//! thread only; `wake` may run on any thread.

use std::ffi::c_void;
use std::sync::{Arc, Mutex};

use crate::error::Error;

/// The version of the controller's ABI, which every structure carries.
pub const CONTROLLER_ABI_VERSION: u32 = 2;

/// Receives bytes one side writes for the other: the reader copies them
/// before the call returns, so neither side frees the other's memory.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SoundorWriter {
    pub user: *mut c_void,
    pub write: Option<unsafe extern "C" fn(user: *mut c_void, data: *const u8, length: usize)>,
}

/// The runtime's services, as callbacks on `user`.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SoundorControllerHost {
    pub size: u32,
    pub abi_version: u32,
    pub user: *mut c_void,
    /// Asks the runtime to call `soundor_controller_run` soon, on the
    /// control thread. Any thread; never blocks.
    pub wake: Option<unsafe extern "C" fn(user: *mut c_void)>,
    /// Parameter `index`'s plain value, in the config's order.
    pub parameter_get: Option<unsafe extern "C" fn(user: *mut c_void, index: u32) -> f64>,
    /// Edits parameter `index` as the UI does (constrained, recorded in
    /// History, told to the host): 0, or nonzero when it refused.
    pub parameter_set:
        Option<unsafe extern "C" fn(user: *mut c_void, index: u32, plain: f64) -> i32>,
    /// Writes state field `index`'s value, as Soundor's state JSON: 0.
    pub state_get:
        Option<unsafe extern "C" fn(user: *mut c_void, index: u32, out: SoundorWriter) -> i32>,
    /// Sets state field `index` from its JSON, as the UI does: 0, or
    /// nonzero with the reason written to `error`.
    pub state_set: Option<
        unsafe extern "C" fn(
            user: *mut c_void,
            index: u32,
            json: *const u8,
            length: usize,
            error: SoundorWriter,
        ) -> i32,
    >,
    /// A History action ([`HistoryAction`]): for undo and redo 0, or nonzero
    /// when it failed; for the queries 1 or 0.
    pub history: Option<unsafe extern "C" fn(user: *mut c_void, action: u32) -> i32>,
    /// Loads the factory preset `id` (UTF-8): 0, or nonzero with the reason
    /// written to `error`.
    pub preset_load: Option<
        unsafe extern "C" fn(
            user: *mut c_void,
            id: *const u8,
            length: usize,
            error: SoundorWriter,
        ) -> i32,
    >,
    /// Queues the event's wire-encoded fields. Nonzero if an editor took it.
    pub publish_event: Option<
        unsafe extern "C" fn(user: *mut c_void, index: u32, data: *const u8, length: usize) -> i32,
    >,
}

/// What `history` is asked.
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HistoryAction {
    Undo = 0,
    Redo = 1,
    CanUndo = 2,
    CanRedo = 3,
}

unsafe extern "C" fn collect(user: *mut c_void, data: *const u8, length: usize) {
    if user.is_null() || (data.is_null() && length > 0) {
        return;
    }
    // SAFETY: `user` is the Vec a `Collector` lent for this call; `data` is
    // valid for `length` bytes, as the writer's caller promises.
    let out = unsafe { &mut *user.cast::<Vec<u8>>() };
    if length > 0 {
        out.extend_from_slice(unsafe { std::slice::from_raw_parts(data, length) });
    }
}

/// A writer into `out`, for one call.
pub fn writer_into(out: &mut Vec<u8>) -> SoundorWriter {
    SoundorWriter {
        user: (out as *mut Vec<u8>).cast(),
        write: Some(collect),
    }
}

impl SoundorWriter {
    /// Hands `bytes` to the reader.
    pub fn send(&self, bytes: &[u8]) {
        if let Some(write) = self.write {
            // SAFETY: the reader passed this callback for this call, and
            // `bytes` is valid for its length.
            unsafe { write(self.user, bytes.as_ptr(), bytes.len()) };
        }
    }
}

/// The host's services, on the control thread. Not `Send`: it holds the
/// runtime's pointer.
pub(crate) struct Host {
    table: SoundorControllerHost,
}

fn text(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).into_owned()
}

impl Host {
    /// Whether `table` is one this SDK can use.
    pub fn new(table: SoundorControllerHost) -> Option<Self> {
        (table.abi_version == CONTROLLER_ABI_VERSION
            && table.size as usize >= std::mem::size_of::<SoundorControllerHost>())
        .then_some(Self { table })
    }

    // A plugin with no events generates no calls to this method.
    #[allow(dead_code)]
    pub fn publish_event(&self, index: u32, bytes: &[u8]) -> bool {
        self.table.publish_event.is_some_and(|publish| {
            // SAFETY: the runtime's callback on the control thread; bytes live through the call.
            unsafe { publish(self.table.user, index, bytes.as_ptr(), bytes.len()) != 0 }
        })
    }

    pub fn parameter(&self, index: u32) -> f64 {
        match self.table.parameter_get {
            // SAFETY: the runtime's callback, on its control thread.
            Some(get) => unsafe { get(self.table.user, index) },
            None => f64::NAN,
        }
    }

    pub fn set_parameter(&self, index: u32, plain: f64) -> bool {
        match self.table.parameter_set {
            // SAFETY: as `parameter`.
            Some(set) => unsafe { set(self.table.user, index, plain) == 0 },
            None => false,
        }
    }

    pub fn state(&self, index: u32) -> Result<String, Error> {
        let Some(get) = self.table.state_get else {
            return Err(Error::new("this runtime has no persistent state"));
        };
        let mut out = Vec::new();
        // SAFETY: as `parameter`; the writer is valid for the call.
        let status = unsafe { get(self.table.user, index, writer_into(&mut out)) };
        if status == 0 {
            Ok(text(out))
        } else {
            Err(Error::new(text(out)))
        }
    }

    pub fn set_state(&self, index: u32, json: &str) -> Result<(), Error> {
        let Some(set) = self.table.state_set else {
            return Err(Error::new("this runtime has no persistent state"));
        };
        let mut error = Vec::new();
        // SAFETY: as `state`.
        let status = unsafe {
            set(
                self.table.user,
                index,
                json.as_ptr(),
                json.len(),
                writer_into(&mut error),
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(Error::new(text(error)))
        }
    }

    pub fn history(&self, action: HistoryAction) -> i32 {
        match self.table.history {
            // SAFETY: as `parameter`.
            Some(history) => unsafe { history(self.table.user, action as u32) },
            None => -1,
        }
    }

    pub fn load_preset(&self, id: &str) -> Result<(), Error> {
        let Some(load) = self.table.preset_load else {
            return Err(Error::new("this runtime has no presets"));
        };
        let mut error = Vec::new();
        // SAFETY: as `state`.
        let status = unsafe {
            load(
                self.table.user,
                id.as_ptr(),
                id.len(),
                writer_into(&mut error),
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(Error::new(text(error)))
        }
    }

    pub fn waker(&self) -> Wake {
        Wake {
            target: Arc::new(Mutex::new(self.table.wake.map(|wake| WakeTarget {
                wake,
                user: self.table.user,
            }))),
        }
    }
}

struct WakeTarget {
    wake: unsafe extern "C" fn(*mut c_void),
    user: *mut c_void,
}

// SAFETY: the runtime promises `wake` may be called on any thread with this
// `user`, until the controller is destroyed, which disconnects it first.
unsafe impl Send for WakeTarget {}

/// Wakes the control thread, from any thread, until disconnected: the
/// runtime's `wake` is never called once [`Wake::disconnect`] returned.
#[derive(Clone)]
pub(crate) struct Wake {
    target: Arc<Mutex<Option<WakeTarget>>>,
}

impl Wake {
    pub fn wake(&self) {
        let target = self
            .target
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if let Some(target) = target.as_ref() {
            // SAFETY: connected, so the runtime is alive (see WakeTarget);
            // the lock keeps `disconnect` from returning meanwhile.
            unsafe { (target.wake)(target.user) };
        }
    }

    pub fn disconnect(&self) {
        *self
            .target
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = None;
    }
}
