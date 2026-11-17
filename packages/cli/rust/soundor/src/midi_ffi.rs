//! Fixed MIDI records shared by native adapters and WASM memory.
use crate::Processor;
use crate::ffi::Handle;
use crate::midi::{
    MIDI_CAPACITY, MidiBatch, MidiError, MidiEvent, MidiInbox, MidiMessage, MidiReceiver,
    MidiSender, MidiSource,
};
use std::ffi::c_void;
use std::sync::Arc;

/// Eight bytes, with no Rust enum discriminant in the wire representation.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct WireMidiEvent {
    /// Samples from the start of the current block.
    pub sample_offset: u32,
    /// Original MIDI status and data bytes; unused third byte is zero.
    pub bytes: [u8; 3],
    /// 0 unknown, 1 host, 2 UI, 3 controller.
    pub source: u8,
}
impl WireMidiEvent {
    /// Validates and decodes one fixed record.
    pub fn decode(self) -> Result<MidiEvent, MidiError> {
        let kind = self.bytes[0] >> 4;
        if self.source > 3 {
            return Err(MidiError::Invalid);
        }
        let length = if kind == 12 || kind == 13 { 2 } else { 3 };
        if length == 2 && self.bytes[2] != 0 {
            return Err(MidiError::Invalid);
        }
        Ok(MidiEvent {
            message: MidiMessage::decode(&self.bytes[..length]).map_err(|_| MidiError::Invalid)?,
            sample_offset: self.sample_offset,
            source: match self.source {
                1 => Some(MidiSource::Host),
                2 => Some(MidiSource::Ui),
                3 => Some(MidiSource::Controller),
                _ => None,
            },
        })
    }
    /// Encodes a validated processor event. Never allocates.
    pub fn encode(event: MidiEvent) -> Self {
        Self {
            sample_offset: event.sample_offset,
            bytes: event.message.encode().expect("validated MIDI").0,
            source: match event.source {
                None => 0,
                Some(MidiSource::Host) => 1,
                Some(MidiSource::Ui) => 2,
                Some(MidiSource::Controller) => 3,
            },
        }
    }
}

/// Status of a control-thread observation batch.
#[repr(C)]
#[derive(Default)]
pub struct MidiStatus {
    /// Cumulative dropped observations.
    pub dropped: u64,
    /// Discontinuity; clear active-note display state.
    pub reset: u32,
    /// Reserved, zero.
    pub reserved: u32,
}

/// Independent control-thread endpoint. Construct before audio starts;
/// afterwards its Arc refers to shared mailboxes, never mutable processor state.
pub struct MidiPort {
    inbox: Arc<MidiInbox>,
    sender: MidiSender,
    // Only control-thread observation locks this mutex. Audio lifecycle
    // calls touch the inbox atomics through shared references, never a lock.
    receiver: std::sync::Mutex<Option<MidiReceiver>>,
}
impl MidiPort {
    pub(crate) fn new(inbox: Arc<MidiInbox>) -> Self {
        Self {
            sender: MidiSender {
                inbox: inbox.clone(),
                source: MidiSource::Ui,
                lifetime: None,
            },
            inbox,
            receiver: std::sync::Mutex::new(None),
        }
    }
    /// Next-block send: 0 accepted, 1 full, 2 inactive, 3 invalid.
    pub fn send(&self, event: WireMidiEvent) -> i32 {
        let Ok(event) = event.decode() else {
            return 3;
        };
        match self.sender.send(event.message) {
            Ok(()) => 0,
            Err(MidiError::Full) => 1,
            Err(MidiError::Inactive) => 2,
            Err(_) => 3,
        }
    }
    /// Opt in/out of UI publications. There is one receiver per plugin;
    /// runtime UI subscribers share it through the existing event hub.
    pub fn observe(&self, enabled: bool) -> bool {
        let mut receiver = self
            .receiver
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if !enabled {
            *receiver = None;
            return true;
        }
        if receiver.is_none() {
            let Ok(subscription) = self.inbox.subscribe(false) else {
                return false;
            };
            *receiver = Some(subscription);
        }
        true
    }

    /// Requests release/reset at the next audio block without calling audio code.
    pub fn recover(&self) {
        self.inbox
            .recover
            .store(true, std::sync::atomic::Ordering::Release);
    }
    /// Runtime activation; deactivation refuses new sends and requests recovery.
    pub fn active(&self, active: bool) {
        self.inbox
            .active
            .store(active, std::sync::atomic::Ordering::Release);
        if !active {
            self.recover();
        }
    }
    /// Reads on the control thread only.
    pub fn receive(&self) -> MidiBatch {
        self.receiver
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_mut()
            .map_or(
                MidiBatch {
                    events: Vec::new(),
                    dropped: 0,
                    reset: false,
                },
                MidiReceiver::receive,
            )
    }
}

/// # Safety
/// `processor` is a live processor handle, exclusively borrowed outside processing.
pub unsafe fn port<P: Processor>(processor: *mut c_void) -> *mut MidiPort {
    let Some(handle) = (unsafe { processor.cast::<Handle<P>>().as_ref() }) else {
        return std::ptr::null_mut();
    };
    Box::into_raw(Box::new(MidiPort::new(handle.midi())))
}

#[doc(hidden)]
#[macro_export]
macro_rules! __export_midi {
    ($processor:ty) => {
        #[doc(hidden)]
        pub mod __soundor_midi {
            use super::*;
            use std::ffi::c_void;
            use $crate::midi_ffi::{MidiPort, MidiStatus, WireMidiEvent};
            /// # Safety
            /// Called outside processing with the live processor handle.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_midi_create(processor: *mut c_void) -> *mut MidiPort {
                unsafe { $crate::midi_ffi::port::<$processor>(processor) }
            }
            /// # Safety
            /// Live, exclusively owned endpoint; never used afterwards.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_midi_destroy(port: *mut MidiPort) {
                if !port.is_null() {
                    drop(unsafe { Box::from_raw(port) });
                }
            }
            /// # Safety
            /// Live endpoint, serialized control-thread call.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_midi_recover(port: *mut MidiPort) {
                if let Some(port) = unsafe { port.as_ref() } {
                    port.recover();
                }
            }
            /// # Safety
            /// Live endpoint, serialized control-thread call.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_midi_active(port: *mut MidiPort, active: bool) {
                if let Some(port) = unsafe { port.as_ref() } {
                    port.active(active);
                }
            }
            /// # Safety
            /// Live endpoint on its control thread; event is a fixed value.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_midi_send(
                port: *mut MidiPort,
                event: WireMidiEvent,
            ) -> i32 {
                unsafe { port.as_ref() }.map_or(2, |port| port.send(event))
            }
            /// # Safety
            /// Live endpoint, serialized control-thread call.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_midi_observe(
                port: *mut MidiPort,
                enabled: bool,
            ) -> bool {
                unsafe { port.as_ref() }.is_some_and(|port| port.observe(enabled))
            }
            /// # Safety
            /// Live endpoint; out holds capacity writable records, status is writable.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_midi_read(
                port: *mut MidiPort,
                out: *mut WireMidiEvent,
                capacity: u32,
                status: *mut MidiStatus,
            ) -> u32 {
                if out.is_null()
                    || status.is_null()
                    || capacity < $crate::midi::MIDI_CAPACITY as u32
                {
                    return 0;
                }
                let Some(port) = (unsafe { port.as_ref() }) else {
                    return 0;
                };
                let batch = port.receive();
                unsafe {
                    *status = MidiStatus {
                        dropped: batch.dropped,
                        reset: u32::from(batch.reset),
                        reserved: 0,
                    };
                }
                for (i, event) in batch.events.iter().enumerate() {
                    unsafe {
                        out.add(i).write(WireMidiEvent::encode(*event));
                    }
                }
                batch.events.len() as u32
            }
            /// # Safety
            /// Processor exclusively borrowed on audio thread between blocks; records valid for count reads.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_midi_input(
                processor: *mut c_void,
                events: *const WireMidiEvent,
                count: u32,
            ) -> i32 {
                unsafe { $crate::ffi::midi_input::<$processor>(processor, events, count) }
            }
            /// # Safety
            /// Processor exclusively borrowed after processing; out holds capacity writable records.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_midi_output(
                processor: *mut c_void,
                out: *mut WireMidiEvent,
                capacity: u32,
            ) -> u32 {
                unsafe { $crate::ffi::midi_output::<$processor>(processor, out, capacity) }
            }
            /// # Safety
            /// Processor exclusively borrowed between processing calls.
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn soundor_midi_generation(processor: *mut c_void) -> u64 {
                unsafe { $crate::ffi::midi_generation::<$processor>(processor) }
            }
        }
    };
}

// Used by adapters to bound every external batch.
const _: () = assert!(MIDI_CAPACITY == 1024 && std::mem::size_of::<WireMidiEvent>() == 8);
