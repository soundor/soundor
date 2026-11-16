//! Browser controller adapter: scalar exports and owned byte buffers rather
//! than C ABI structures, function pointers or pointers to processor objects.
#![cfg(target_arch = "wasm32")]
use crate::controller::{Instance, Ran};
use crate::host::{CONTROLLER_ABI_VERSION, Host, SoundorControllerHost, SoundorWriter};
use crate::plugin::{DESCRIPTOR, NativeMethods, ResourceSlots, WEB_INSTANCE_DESCRIPTOR};
use std::ffi::c_void;
use std::sync::Arc;

#[link(wasm_import_module = "soundor_controller")]
unsafe extern "C" {
    fn wake();
    fn service(operation: u32, index: u32, data: *const u8, length: usize) -> f64;
    fn read_service_result(data: *mut u8);
}
unsafe extern "C" fn host_wake(_: *mut c_void) {
    unsafe { wake() };
}
unsafe extern "C" fn parameter_get(_: *mut c_void, index: u32) -> f64 {
    unsafe { service(0, index, std::ptr::null(), 0) }
}
unsafe extern "C" fn parameter_set(_: *mut c_void, index: u32, value: f64) -> i32 {
    unsafe { service(1, index, (&value as *const f64).cast(), 8) as i32 }
}
fn text_service(operation: u32, index: u32, bytes: &[u8], out: SoundorWriter) -> i32 {
    let result = unsafe { service(operation, index, bytes.as_ptr(), bytes.len()) };
    let mut bytes = vec![0; result.abs() as usize];
    unsafe { read_service_result(bytes.as_mut_ptr()) };
    out.send(&bytes);
    if result < 0.0 { 1 } else { 0 }
}
unsafe extern "C" fn state_get(_: *mut c_void, index: u32, out: SoundorWriter) -> i32 {
    text_service(2, index, &[], out)
}
unsafe extern "C" fn state_set(
    _: *mut c_void,
    index: u32,
    data: *const u8,
    len: usize,
    out: SoundorWriter,
) -> i32 {
    text_service(
        3,
        index,
        unsafe { std::slice::from_raw_parts(data, len) },
        out,
    )
}
unsafe extern "C" fn history(_: *mut c_void, action: u32) -> i32 {
    unsafe { service(4, action, std::ptr::null(), 0) as i32 }
}
unsafe extern "C" fn preset_load(
    _: *mut c_void,
    data: *const u8,
    len: usize,
    out: SoundorWriter,
) -> i32 {
    text_service(5, 0, unsafe { std::slice::from_raw_parts(data, len) }, out)
}
fn host() -> Host {
    Host::new(SoundorControllerHost {
        size: std::mem::size_of::<SoundorControllerHost>() as u32,
        abi_version: CONTROLLER_ABI_VERSION,
        user: std::ptr::null_mut(),
        wake: Some(host_wake),
        parameter_get: Some(parameter_get),
        parameter_set: Some(parameter_set),
        state_get: Some(state_get),
        state_set: Some(state_set),
        history: Some(history),
        preset_load: Some(preset_load),
    })
    .expect("browser host")
}

pub struct Handle<C: NativeMethods> {
    instance: Instance<C>,
    slots: Arc<ResourceSlots>,
    input: Vec<u8>,
    output: Vec<u8>,
    operation: u32,
}
impl<C: NativeMethods> Default for Handle<C> {
    fn default() -> Self {
        let host = host();
        let wake = host.waker();
        let slots = Arc::new(ResourceSlots::default());
        Self {
            instance: Instance::new(host, wake, slots.clone()),
            slots,
            input: Vec::new(),
            output: Vec::new(),
            operation: 0,
        }
    }
}
impl<C: NativeMethods> Handle<C> {
    pub fn input(&mut self, length: usize) -> *mut u8 {
        self.input.resize(length, 0);
        self.input.as_mut_ptr()
    }
    pub fn output(&self) -> *const u8 {
        self.output.as_ptr()
    }
    pub fn length(&self) -> usize {
        self.output.len()
    }
    pub fn operation(&self) -> u32 {
        self.operation
    }
    pub fn call(&mut self, method: u32, operation: u32) -> i32 {
        let result = if operation == 0 {
            self.instance.call(method, &self.input)
        } else {
            self.instance
                .start(method, u64::from(operation), &self.input)
                .map(|()| Vec::new())
        };
        match result {
            Ok(bytes) => {
                self.output = bytes;
                0
            }
            Err(error) => {
                self.output = error.message().as_bytes().to_vec();
                1
            }
        }
    }
    pub fn cancel(&self, operation: u32) {
        self.instance.cancel(u64::from(operation));
    }
    pub fn run(&mut self) -> i32 {
        match self.instance.run() {
            Ok(Ran::Nothing) => 0,
            Ok(Ran::Task) => 1,
            Ok(Ran::Completion { operation, result }) => {
                self.operation = operation as u32;
                match result {
                    Ok(bytes) => {
                        self.output = bytes;
                        2
                    }
                    Err(message) => {
                        self.output = message.into_bytes();
                        3
                    }
                }
            }
            Err(error) => {
                self.output = error.message().as_bytes().to_vec();
                4
            }
        }
    }
    pub fn resources(&mut self) {
        self.output = self.slots.take_publications();
    }
}

pub fn instance_descriptor() -> &'static [u8] {
    WEB_INSTANCE_DESCRIPTOR
}

pub fn descriptor() -> &'static [u8] {
    DESCRIPTOR
}
