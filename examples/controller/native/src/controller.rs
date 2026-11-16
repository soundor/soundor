//! The plugin's controller: the Rust behind `soundor:native`'s methods, on
//! the control thread beside the UI. Each method soundor.config declares is
//! one here, typed as declared; the compiler checks every one of them
//! against the generated `NativeMethods`.

use std::future::{Future, poll_fn};
use std::pin::pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::task::Poll;
use std::time::Duration;

use soundor::prelude::*;
use soundor::types::{Shape, Stats};

/// What the controller keeps on the control thread, between calls: one per
/// plugin instance, for as long as it lives, editor open or not. Not saved
/// with the plugin: the shape the processor plays is `state.shape`.
#[derive(Default)]
pub struct LocalStore {
    clicks: i32,
    last_shape: Option<Shape>,
}

/// What async tasks share with the control thread, from any thread.
#[derive(Default)]
pub struct SharedStore {
    loads: AtomicU64,
}

/// The plugin's controller. Soundor never constructs it: its methods take
/// their context, and keep what lasts in the stores.
pub struct PluginController;

impl Controller for PluginController {
    type Local = LocalStore;
    type Shared = SharedStore;
}

/// `future`'s output, unless `timeout` passes first: then `future` is
/// dropped, cancelling what it was waiting for.
pub async fn within<F: Future>(timeout: Duration, future: F) -> Option<F::Output> {
    let mut future = pin!(future);
    let mut timer = pin!(soundor::unblock(move || std::thread::sleep(timeout)));
    poll_fn(|cx| {
        if let Poll::Ready(value) = future.as_mut().poll(cx) {
            return Poll::Ready(Some(value));
        }
        if timer.as_mut().poll(cx).is_ready() {
            return Poll::Ready(None);
        }
        Poll::Pending
    })
    .await
}

impl NativeMethods for PluginController {
    /// Counts in the local store, synchronously.
    fn click(ctx: &mut TaskContext<Self>) -> i32 {
        ctx.store.local.clicks += 1;
        ctx.store.local.clicks
    }

    /// The same, from an async task: the local store is the control thread's,
    /// so the task schedules the change there, and awaits what it returns.
    async fn click_later(ctx: AsyncTaskContext<Self>) -> Result<i32, Error> {
        let clicks = ctx
            .schedule(|ctx| {
                ctx.store.local.clicks += 1;
                ctx.store.local.clicks
            })
            .await?;
        Ok(clicks)
    }

    /// Both stores: the clicks of the local one, the loads of the shared one.
    fn stats(ctx: &mut TaskContext<Self>) -> Stats {
        Stats {
            clicks: ctx.store.local.clicks,
            loads: ctx.store.shared.loads.load(Ordering::Relaxed),
            last_shape: ctx.store.local.last_shape,
        }
    }

    /// Computes a wavetable off the control thread, publishes it to the
    /// processor (which plays it from its next block), then records its
    /// shape on the control thread: in the persistent state, where the UI,
    /// History and the saved session see it.
    async fn load_table(
        ctx: AsyncTaskContext<Self>,
        shape: Shape,
        size: u32,
    ) -> Result<u32, Error> {
        let size = size.clamp(16, 1 << 16);
        ctx.store.shared.loads.fetch_add(1, Ordering::Relaxed);
        // Genuinely asynchronous: on a thread of its own, while the control
        // thread goes on running the UI.
        let table = soundor::unblock(move || crate::render(shape, size as usize)).await;
        // Real-time safe: the audio thread takes it at its next block, and
        // the table it replaces is freed off the audio thread.
        ctx.processor.resources().wavetable.publish(table);
        // The control thread runs the update at its next opportunity. Should
        // it not within a second, the update is dropped while queued: it is
        // cancelled, and never runs.
        let recorded = within(
            Duration::from_secs(1),
            ctx.schedule(move |ctx| {
                ctx.state.shape.set(shape);
                ctx.store.local.last_shape = Some(shape);
            }),
        )
        .await;
        match recorded {
            Some(result) => result?,
            None => {
                return Err(Error::new(
                    "the control thread did not record the table in time",
                ));
            }
        }
        Ok(size)
    }
}
