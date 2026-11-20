//! The Soundor VST3 runtime's Rust side: what makes the generic, prebuilt
//! VST3 adapter (`libsoundor_vst3.a`) the project's plugin.
//!
//! The adapter is the same for every plugin; at run time it asks the
//! plugin's binary for the plugin it is through one C function,
//! `soundor_vst3_plugin`, which [`plugin!`] defines in the crate `soundor build
//! vst3` generates for the project:
//!
//! - the plugin's descriptor (JSON: identity, VST3 class ids, audio layouts,
//!   MIDI, editor, parameters and their behaviour, state, presets, streams);
//! - the controller descriptor the engine checks the plugin's controller
//!   against;
//! - the UI's files, embedded, or a development build's UI directory and log.
//!
//! The processor, the controller and MIDI are not here: they are the
//! project's own crate, through `soundor::export!`'s ABI, which the adapter
//! calls through the engine. Plugin authors never
//! use this crate: it is the runtime's.
//!
//! Its ABI's rules (native/include/soundor/vst3/PluginAbi.h has the C side):
//! every structure starts with its size and [`ABI_VERSION`]; everything
//! returned is static, owned here, valid while the module is loaded; nothing
//! can panic, so nothing unwinds into C++.

#![no_std]
#![warn(missing_docs)]
#![deny(unsafe_op_in_unsafe_fn)]

/// The version of the ABI, which the adapter checks.
pub const ABI_VERSION: u32 = 1;

/// A file of the UI, as the adapter reads it (`SoundorVst3File`).
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct File {
    path: *const u8,
    path_length: usize,
    data: *const u8,
    size: usize,
}

// SAFETY: a File only points at static data, never written.
unsafe impl Sync for File {}

impl File {
    /// A file of the UI: `path` relative to its root, and its bytes.
    pub const fn new(path: &'static str, data: &'static [u8]) -> Self {
        Self {
            path: path.as_ptr(),
            path_length: path.len(),
            data: data.as_ptr(),
            size: data.len(),
        }
    }
}

/// Bytes aligned for Hermes, which reads embedded bytecode in place:
/// `static B: &Aligned<[u8]> = &Aligned(*include_bytes!("bundle.js.hbc"));`.
#[repr(C, align(16))]
pub struct Aligned<Bytes: ?Sized>(pub Bytes);

/// What a plugin is, for the adapter.
#[derive(Clone, Copy, Debug)]
pub struct Plugin {
    /// The descriptor (UTF-8 JSON).
    pub descriptor: &'static [u8],
    /// The controller descriptor (`describeController()`'s bytes).
    pub controller_descriptor: &'static [u8],
    /// The UI's files, embedded.
    pub files: &'static [File],
    /// A development build's UI directory, read at every editor opening;
    /// empty for an embedded UI.
    pub ui_directory: &'static str,
    /// A development build's log file; empty for none.
    pub log_file: &'static str,
}

/// `SoundorVst3Plugin`, field for field.
#[repr(C)]
#[derive(Debug)]
pub struct SoundorVst3Plugin {
    /// Set by the caller: the size of its structure.
    pub size: u32,
    /// Set by [`fill`]: [`ABI_VERSION`].
    pub abi_version: u32,
    #[allow(missing_docs)]
    pub descriptor: *const u8,
    #[allow(missing_docs)]
    pub descriptor_size: usize,
    #[allow(missing_docs)]
    pub controller_descriptor: *const u8,
    #[allow(missing_docs)]
    pub controller_descriptor_size: usize,
    #[allow(missing_docs)]
    pub files: *const File,
    #[allow(missing_docs)]
    pub file_count: usize,
    #[allow(missing_docs)]
    pub ui_directory: *const u8,
    #[allow(missing_docs)]
    pub ui_directory_length: usize,
    #[allow(missing_docs)]
    pub log_file: *const u8,
    #[allow(missing_docs)]
    pub log_file_length: usize,
}

/// Fills the adapter's structure: 0, or 1 when `out` is null or smaller
/// than this ABI's.
///
/// # Safety
/// `out` is null or points at a writable `SoundorVst3Plugin` whose `size`
/// the caller set to its size.
pub unsafe fn fill(plugin: &Plugin, out: *mut SoundorVst3Plugin) -> i32 {
    if out.is_null() {
        return 1;
    }
    // SAFETY: the caller's structure starts with its size, which is read
    // before anything else of it is touched.
    let size = unsafe { core::ptr::addr_of!((*out).size).read() } as usize;
    if size < core::mem::size_of::<SoundorVst3Plugin>() {
        return 1;
    }
    let filled = SoundorVst3Plugin {
        size: core::mem::size_of::<SoundorVst3Plugin>() as u32,
        abi_version: ABI_VERSION,
        descriptor: plugin.descriptor.as_ptr(),
        descriptor_size: plugin.descriptor.len(),
        controller_descriptor: plugin.controller_descriptor.as_ptr(),
        controller_descriptor_size: plugin.controller_descriptor.len(),
        files: plugin.files.as_ptr(),
        file_count: plugin.files.len(),
        ui_directory: plugin.ui_directory.as_ptr(),
        ui_directory_length: plugin.ui_directory.len(),
        log_file: plugin.log_file.as_ptr(),
        log_file_length: plugin.log_file.len(),
    };
    // SAFETY: as the caller promises, and it is large enough.
    unsafe { out.write(filled) };
    0
}

/// Defines `soundor_vst3_plugin` for `$plugin` (a [`Plugin`] constant): the
/// generated crate's one line.
#[macro_export]
macro_rules! plugin {
    ($plugin:expr) => {
        /// The plugin, for the VST3 adapter.
        ///
        /// # Safety
        /// See `soundor_vst3::fill`.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn soundor_vst3_plugin(out: *mut $crate::SoundorVst3Plugin) -> i32 {
            const PLUGIN: $crate::Plugin = $plugin;
            // SAFETY: as the caller promises.
            unsafe { $crate::fill(&PLUGIN, out) }
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    static FILES: [File; 1] = [File::new("bundle.js", b"export {};")];
    const PLUGIN: Plugin = Plugin {
        descriptor: b"{}",
        controller_descriptor: &[1, 2, 3],
        files: &FILES,
        ui_directory: "",
        log_file: "/tmp/log",
    };

    fn empty(size: u32) -> SoundorVst3Plugin {
        SoundorVst3Plugin {
            size,
            abi_version: 0,
            descriptor: core::ptr::null(),
            descriptor_size: 0,
            controller_descriptor: core::ptr::null(),
            controller_descriptor_size: 0,
            files: core::ptr::null(),
            file_count: 0,
            ui_directory: core::ptr::null(),
            ui_directory_length: 0,
            log_file: core::ptr::null(),
            log_file_length: 0,
        }
    }

    #[test]
    fn fills_the_structure() {
        let mut out = empty(core::mem::size_of::<SoundorVst3Plugin>() as u32);
        assert_eq!(unsafe { fill(&PLUGIN, &mut out) }, 0);
        assert_eq!(out.abi_version, ABI_VERSION);
        assert_eq!(out.descriptor_size, 2);
        assert_eq!(out.controller_descriptor_size, 3);
        assert_eq!(out.file_count, 1);
        assert_eq!(out.log_file_length, 8);
        let file = unsafe { &*out.files };
        assert_eq!(file.path_length, 9);
        assert_eq!(file.size, 10);
    }

    #[test]
    fn refuses_a_smaller_structure_and_null() {
        let mut out = empty(8);
        assert_eq!(unsafe { fill(&PLUGIN, &mut out) }, 1);
        assert_eq!(out.abi_version, 0);
        assert_eq!(unsafe { fill(&PLUGIN, core::ptr::null_mut()) }, 1);
    }
}
