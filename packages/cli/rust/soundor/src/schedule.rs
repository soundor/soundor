//! The control thread's queue, and [`AsyncTaskContext::schedule`]'s future.
//!
//! A scheduled callback goes through one race-safe state machine, under its
//! slot's lock:
//!
//! ```text
//!   (future created)  nothing queued: futures are lazy
//!          | first poll
//!          v
//!       Queued ----- future dropped ------> Cancelled   (never runs)
//!          |  \----- plugin shut down ----> Failed(ShutDown)
//!          | the control thread takes it
//!          v
//!       Running  --- future dropped: runs to its end, result dropped
//!          |
//!          v
//!     Done(result) / Failed(Panicked) --- polled ---> Taken
//! ```
//!
//! Taking a queued callback to run it and cancelling it both hold the lock,
//! so exactly one wins. A running callback is never interrupted:
//! cancellation stops what has not started, and undoes nothing.
//!
//! [`AsyncTaskContext::schedule`]: crate::AsyncTaskContext::schedule

use std::collections::VecDeque;
use std::future::Future;
use std::marker::PhantomData;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::{Context, Poll, Waker};

use crate::controller::{Controller, Core, TaskContext};
use crate::error::panic_message;
use crate::host::Wake;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

/// Why a scheduled callback did not return a value.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum ScheduleError {
    /// The plugin instance shut down before the callback ran: it never will.
    ShutDown,
    /// The callback panicked; its message.
    Panicked(String),
}

impl std::fmt::Display for ScheduleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ShutDown => f.write_str("the plugin instance shut down before the task ran"),
            Self::Panicked(message) => write!(f, "the scheduled task panicked: {message}"),
        }
    }
}

impl std::error::Error for ScheduleError {}

/// A scheduled callback the control thread runs, or discards at shutdown.
pub(crate) trait Scheduled<C: Controller>: Send {
    /// Whether it is still to run (not cancelled meanwhile).
    fn pending(&self) -> bool;
    fn run(self: Box<Self>, ctx: &mut TaskContext<'_, C>);
    fn shut_down(self: Box<Self>);
}

pub(crate) enum ControlItem<C: Controller> {
    Task(Box<dyn Scheduled<C>>),
    /// An async method finished: its operation and its encoded result.
    Completion {
        operation: u64,
        result: Result<Vec<u8>, String>,
    },
}

struct QueueState<C: Controller> {
    items: VecDeque<ControlItem<C>>,
    closed: bool,
}

/// What the control thread runs, in order, one at a time.
pub(crate) struct ControlQueue<C: Controller> {
    state: Mutex<QueueState<C>>,
    wake: Wake,
}

impl<C: Controller> ControlQueue<C> {
    pub fn new(wake: Wake) -> Self {
        Self {
            state: Mutex::new(QueueState {
                items: VecDeque::new(),
                closed: false,
            }),
            wake,
        }
    }

    /// Queues `item` and wakes the control thread; gives it back once
    /// closed.
    pub fn push(&self, item: ControlItem<C>) -> Result<(), ControlItem<C>> {
        {
            let mut state = lock(&self.state);
            if state.closed {
                return Err(item);
            }
            state.items.push_back(item);
        }
        self.wake.wake();
        Ok(())
    }

    pub fn pop(&self) -> Option<ControlItem<C>> {
        lock(&self.state).items.pop_front()
    }

    /// Refuses every later item, disconnects the wake, and returns what was
    /// queued.
    pub fn close(&self) -> Vec<ControlItem<C>> {
        let items = {
            let mut state = lock(&self.state);
            state.closed = true;
            state.items.drain(..).collect()
        };
        self.wake.disconnect();
        items
    }
}

enum Phase<F, R> {
    Queued(F),
    Running,
    Done(R),
    Failed(ScheduleError),
    Cancelled,
    Taken,
}

struct SlotState<F, R> {
    phase: Phase<F, R>,
    waker: Option<Waker>,
    // Whether its future still waits for it.
    awaited: bool,
}

struct Slot<C, F, R> {
    state: Mutex<SlotState<F, R>>,
    _controller: PhantomData<fn() -> C>,
}

struct Entry<C, F, R>(Arc<Slot<C, F, R>>);

impl<C, F, R> Scheduled<C> for Entry<C, F, R>
where
    C: Controller,
    F: FnOnce(&mut TaskContext<'_, C>) -> R + Send + 'static,
    R: Send + 'static,
{
    fn pending(&self) -> bool {
        matches!(lock(&self.0.state).phase, Phase::Queued(_))
    }

    fn run(self: Box<Self>, ctx: &mut TaskContext<'_, C>) {
        let callback = {
            let mut state = lock(&self.0.state);
            match std::mem::replace(&mut state.phase, Phase::Running) {
                Phase::Queued(callback) => callback,
                other => {
                    // Cancelled: it never runs.
                    state.phase = other;
                    return;
                }
            }
        };
        let outcome = catch_unwind(AssertUnwindSafe(|| callback(ctx)));
        let (waker, discarded) = {
            let mut state = lock(&self.0.state);
            if state.awaited {
                state.phase = match outcome {
                    Ok(value) => Phase::Done(value),
                    Err(panic) => Phase::Failed(ScheduleError::Panicked(panic_message(&*panic))),
                };
                (state.waker.take(), None)
            } else {
                state.phase = Phase::Taken;
                (None, Some(outcome))
            }
        };
        // Its future is gone: the result is dropped here, on the control
        // thread, outside the lock.
        drop(discarded);
        if let Some(waker) = waker {
            waker.wake();
        }
    }

    fn shut_down(self: Box<Self>) {
        let (callback, waker) = {
            let mut state = lock(&self.0.state);
            match std::mem::replace(&mut state.phase, Phase::Failed(ScheduleError::ShutDown)) {
                Phase::Queued(callback) => (Some(callback), state.waker.take()),
                other => {
                    state.phase = other;
                    (None, None)
                }
            }
        };
        drop(callback);
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}

/// What [`AsyncTaskContext::schedule`](crate::AsyncTaskContext::schedule)
/// returns: lazy, like every Rust future. Its first poll queues the
/// callback; dropping it before the callback starts cancels it.
#[must_use = "futures do nothing unless awaited: the callback is queued at the first poll"]
pub struct Schedule<C: Controller, F, R> {
    core: Arc<Core<C>>,
    callback: Option<F>,
    slot: Option<Arc<Slot<C, F, R>>>,
}

// The callback and the result are only ever moved, never pinned.
impl<C: Controller, F, R> Unpin for Schedule<C, F, R> {}

impl<C, F, R> Schedule<C, F, R>
where
    C: Controller,
    F: FnOnce(&mut TaskContext<'_, C>) -> R + Send + 'static,
    R: Send + 'static,
{
    pub(crate) fn new(core: Arc<Core<C>>, callback: F) -> Self {
        Self {
            core,
            callback: Some(callback),
            slot: None,
        }
    }
}

impl<C, F, R> Future for Schedule<C, F, R>
where
    C: Controller,
    F: FnOnce(&mut TaskContext<'_, C>) -> R + Send + 'static,
    R: Send + 'static,
{
    type Output = Result<R, ScheduleError>;

    fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
        let this = &mut *self;
        let Some(slot) = &this.slot else {
            let callback = this
                .callback
                .take()
                .expect("`schedule` polled after it completed");
            let slot = Arc::new(Slot {
                state: Mutex::new(SlotState {
                    phase: Phase::Queued(callback),
                    waker: Some(context.waker().clone()),
                    awaited: true,
                }),
                _controller: PhantomData,
            });
            let entry: Box<dyn Scheduled<C>> = Box::new(Entry(slot.clone()));
            if this.core.control.push(ControlItem::Task(entry)).is_err() {
                // Shut down: the callback goes with the slot, never run.
                lock(&slot.state).phase = Phase::Cancelled;
                return Poll::Ready(Err(ScheduleError::ShutDown));
            }
            this.slot = Some(slot);
            return Poll::Pending;
        };
        let mut state = lock(&slot.state);
        match std::mem::replace(&mut state.phase, Phase::Taken) {
            Phase::Done(value) => Poll::Ready(Ok(value)),
            Phase::Failed(error) => Poll::Ready(Err(error)),
            Phase::Taken => panic!("`schedule` polled after it completed"),
            waiting => {
                state.phase = waiting;
                state.waker = Some(context.waker().clone());
                Poll::Pending
            }
        }
    }
}

impl<C: Controller, F, R> Drop for Schedule<C, F, R> {
    fn drop(&mut self) {
        let Some(slot) = self.slot.take() else {
            // Never polled: nothing was queued.
            return;
        };
        let dropped = {
            let mut state = lock(&slot.state);
            state.awaited = false;
            state.waker = None;
            match std::mem::replace(&mut state.phase, Phase::Taken) {
                // Cancellation wins: the control thread will find it so.
                Phase::Queued(callback) => {
                    state.phase = Phase::Cancelled;
                    (Some(callback), None)
                }
                Phase::Running => {
                    state.phase = Phase::Running;
                    (None, None)
                }
                Phase::Done(value) => (None, Some(value)),
                other => {
                    state.phase = other;
                    (None, None)
                }
            }
        };
        drop(dropped);
    }
}
