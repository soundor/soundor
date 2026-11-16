//! The error a controller's native method fails with.

use std::fmt;

/// Why a native method failed: its message reaches JavaScript, as the
/// `Error` an async method's promise rejects with (`loadPreset(): <message>`).
///
/// Any [`std::error::Error`] converts into one, so `?` works on I/O, parsing
/// and [`ScheduleError`](crate::ScheduleError) alike; [`Error::new`] makes one
/// from a message. Like `anyhow::Error`, it does not implement
/// `std::error::Error` itself: that is what lets every error convert into it.
pub struct Error {
    message: String,
}

impl Error {
    /// An error with `message`.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    /// The message JavaScript receives.
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl<E: std::error::Error + Send + Sync + 'static> From<E> for Error {
    fn from(error: E) -> Self {
        Self::new(error.to_string())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl fmt::Debug for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Error").field(&self.message).finish()
    }
}

/// The message of a caught panic.
pub(crate) fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_owned()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "panicked".to_owned()
    }
}
