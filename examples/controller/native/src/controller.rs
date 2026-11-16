//! The plugin's controller: the Rust behind `soundor:native`'s methods, on
//! the control thread beside the UI. Each method soundor.config declares is
//! one here, typed as declared; the compiler checks every one of them
//! against the generated `NativeMethods`.

#[cfg(not(target_arch = "wasm32"))]
use std::future::{Future, poll_fn};
#[cfg(not(target_arch = "wasm32"))]
use std::pin::pin;
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(not(target_arch = "wasm32"))]
use std::task::Poll;
#[cfg(not(target_arch = "wasm32"))]
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
#[cfg(not(target_arch = "wasm32"))]
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

    /// Computes a bounded wavetable, publishes it to the
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
        // Native polls this future on its worker; the browser polls it on
        // the main thread. Keep CPU work bounded: browsers execute cooperatively.
        let table = crate::render(shape, size as usize);
        ctx.processor.resources().wavetable.publish(table);
        ctx.schedule(move |ctx| {
            ctx.state.shape.set(shape);
            ctx.store.local.last_shape = Some(shape);
        })
        .await?;
        Ok(size)
    }
}
