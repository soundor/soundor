//! What polls a controller's async native methods. Browsers pump bounded
//! turns through a wake-driven event-loop adapter, retaining Send futures.
//! Natively, one worker thread per
//! plugin instance, started by its first async call, that polls each task
//! whenever it is woken. Futures are lazy, so something has to; this is
//! that, and no more: no timers, no I/O reactor. Blocking work belongs in
//! [`unblock`](crate::unblock), or in a runtime of the plugin's own.
//!
//! A task is cancelled by dropping its future on the worker, at its next
//! poll: never while it is being polled. At shutdown the worker drops every
//! task left, then ends, and shutdown waits for it.

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::pin::Pin;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::Condvar;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
#[cfg(not(target_arch = "wasm32"))]
use std::task::Poll;
use std::task::{Context, Wake, Waker};
#[cfg(not(target_arch = "wasm32"))]
use std::thread::JoinHandle;

/// A task's future, type-erased.
pub(crate) type TaskFuture = Pin<Box<dyn Future<Output = ()> + Send>>;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

pub(crate) struct Task {
    id: u64,
    future: Mutex<Option<TaskFuture>>,
    // Whether it is in the ready queue: a wake while it is adds nothing.
    queued: AtomicBool,
    cancelled: AtomicBool,
    executor: Weak<Shared>,
}

impl Task {
    fn schedule(self: &Arc<Self>) {
        if self.queued.swap(true, Ordering::AcqRel) {
            return;
        }
        let Some(executor) = self.executor.upgrade() else {
            return;
        };
        let mut state = lock(&executor.state);
        if state.shutdown {
            return;
        }
        state.ready.push_back(self.clone());
        drop(state);
        #[cfg(not(target_arch = "wasm32"))]
        executor.ready.notify_one();
        #[cfg(target_arch = "wasm32")]
        executor.wake.wake();
    }
}

impl Wake for Task {
    fn wake(self: Arc<Self>) {
        self.schedule();
    }

    fn wake_by_ref(self: &Arc<Self>) {
        self.schedule();
    }
}

#[derive(Default)]
struct State {
    ready: VecDeque<Arc<Task>>,
    // Every task not finished: shutdown drops their futures.
    live: HashMap<u64, Arc<Task>>,
    next: u64,
    shutdown: bool,
}

struct Shared {
    state: Mutex<State>,
    #[cfg(not(target_arch = "wasm32"))]
    ready: Condvar,
    #[cfg(target_arch = "wasm32")]
    wake: crate::host::Wake,
}

/// One plugin instance's worker.
pub(crate) struct Executor {
    shared: Arc<Shared>,
    #[cfg(not(target_arch = "wasm32"))]
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Executor {
    pub fn new(_wake: crate::host::Wake) -> Self {
        Self {
            shared: Arc::new(Shared {
                state: Mutex::default(),
                #[cfg(not(target_arch = "wasm32"))]
                ready: Condvar::new(),
                #[cfg(target_arch = "wasm32")]
                wake: _wake,
            }),
            #[cfg(not(target_arch = "wasm32"))]
            worker: Mutex::default(),
        }
    }

    /// One browser event-loop turn. Futures and control callbacks are
    /// pumped separately, so neither interrupts the other's call.
    #[cfg(target_arch = "wasm32")]
    pub fn poll_one(&self) -> bool {
        let Some(task) = lock(&self.shared.state).ready.pop_front() else {
            return false;
        };
        poll_task(&self.shared, task);
        true
    }

    /// Starts polling `future`; `None` once shut down.
    pub fn spawn(&self, future: TaskFuture) -> Option<Arc<Task>> {
        let task = {
            let mut state = lock(&self.shared.state);
            if state.shutdown {
                return None;
            }
            state.next += 1;
            let task = Arc::new(Task {
                id: state.next,
                future: Mutex::new(Some(future)),
                queued: AtomicBool::new(false),
                cancelled: AtomicBool::new(false),
                executor: Arc::downgrade(&self.shared),
            });
            state.live.insert(task.id, task.clone());
            task
        };
        #[cfg(not(target_arch = "wasm32"))]
        {
            let mut worker = lock(&self.worker);
            if worker.is_none() {
                let shared = self.shared.clone();
                let started = std::thread::Builder::new()
                    .name("soundor-controller".into())
                    .spawn(move || run(&shared));
                match started {
                    Ok(handle) => *worker = Some(handle),
                    Err(_) => {
                        lock(&self.shared.state).live.remove(&task.id);
                        return None;
                    }
                }
            }
        }
        task.schedule();
        Some(task)
    }

    /// Cancels `task`: its future is dropped on the worker, before its next
    /// poll, or after the poll running now.
    pub fn cancel(&self, task: &Arc<Task>) {
        task.cancelled.store(true, Ordering::Release);
        #[cfg(not(target_arch = "wasm32"))]
        task.schedule();
        #[cfg(target_arch = "wasm32")]
        {
            // Browser calls are serialized, so no poll is running. Drop
            // now to cancel a queued Schedule before its control turn.
            let future = lock(&task.future).take();
            drop(future);
            lock(&self.shared.state).live.remove(&task.id);
        }
    }

    /// Drops every task's future on the worker, and waits for it to end.
    /// Afterwards nothing is polled again, and spawning fails.
    pub fn shutdown(&self) {
        lock(&self.shared.state).shutdown = true;
        #[cfg(target_arch = "wasm32")]
        drop_all(&self.shared);
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.shared.ready.notify_all();
            let worker = lock(&self.worker).take();
            match worker {
                Some(worker) => {
                    if worker.thread().id() == std::thread::current().id() {
                        // Shut down from a task's own poll (a controller dropped
                        // by its last task): the worker finishes on its own.
                        return;
                    }
                    let _ = worker.join();
                }
                None => drop_all(&self.shared),
            }
        }
    }
}

fn drop_all(shared: &Shared) {
    let live: Vec<Arc<Task>> = {
        let mut state = lock(&shared.state);
        state.ready.clear();
        state.live.drain().map(|(_, task)| task).collect()
    };
    for task in live {
        let future = lock(&task.future).take();
        // A future's drop may run anything; it is contained.
        let _ = catch_unwind(AssertUnwindSafe(move || drop(future)));
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn run(shared: &Arc<Shared>) {
    loop {
        let task = {
            let mut state = lock(&shared.state);
            loop {
                if state.shutdown {
                    drop(state);
                    drop_all(shared);
                    return;
                }
                if let Some(task) = state.ready.pop_front() {
                    break task;
                }
                state = shared
                    .ready
                    .wait(state)
                    .unwrap_or_else(|poison| poison.into_inner());
            }
        };
        poll_task(shared, task);
    }
}

fn poll_task(shared: &Arc<Shared>, task: Arc<Task>) {
    task.queued.store(false, Ordering::Release);
    let mut slot = lock(&task.future);
    let finished = if task.cancelled.load(Ordering::Acquire) {
        true
    } else if let Some(future) = slot.as_mut() {
        let waker = Waker::from(task.clone());
        let mut context = Context::from_waker(&waker);
        // The futures the controller spawns catch their own panics; a
        // panic here is the executor's own, and ends the task.
        catch_unwind(AssertUnwindSafe(|| future.as_mut().poll(&mut context)))
            .map_or(true, |poll| poll.is_ready())
    } else {
        false
    };
    if finished {
        let future = slot.take();
        drop(slot);
        let _ = catch_unwind(AssertUnwindSafe(move || drop(future)));
        lock(&shared.state).live.remove(&task.id);
    }
}

/// Runs `work` on a thread of its own, and resolves to what it returns:
/// blocking work (a file read, a decoder) an async native method awaits
/// without blocking the other tasks of its plugin instance.
///
/// The thread runs `work` to its end even when the awaiting task is
/// cancelled; its result is then dropped. A panic in `work` resumes in the
/// awaiting task, which the controller reports as the method's failure.
///
/// ```no_run
/// # async fn example() -> std::io::Result<()> {
/// let text = soundor::unblock(|| std::fs::read_to_string("preset.json")).await?;
/// # Ok(()) }
/// ```
#[cfg(not(target_arch = "wasm32"))]
pub fn unblock<R, F>(work: F) -> Unblock<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    let slot = Arc::new(Mutex::new(UnblockState::Waiting(None)));
    let result = slot.clone();
    let spawned = std::thread::Builder::new()
        .name("soundor-unblock".into())
        .spawn(move || {
            let outcome = catch_unwind(AssertUnwindSafe(work));
            let waker = match std::mem::replace(&mut *lock(&result), UnblockState::Done(outcome)) {
                UnblockState::Waiting(waker) => waker,
                UnblockState::Done(_) | UnblockState::Taken => None,
            };
            if let Some(waker) = waker {
                waker.wake();
            }
        });
    if let Err(error) = spawned {
        *lock(&slot) =
            UnblockState::Done(Err(Box::new(format!("could not start a thread: {error}"))));
    }
    Unblock { slot }
}

#[cfg(not(target_arch = "wasm32"))]
type Outcome<R> = std::thread::Result<R>;

#[cfg(not(target_arch = "wasm32"))]
enum UnblockState<R> {
    Waiting(Option<Waker>),
    Done(Outcome<R>),
    Taken,
}

/// What [`unblock`] returns.
#[must_use = "futures do nothing unless awaited"]
#[cfg(not(target_arch = "wasm32"))]
pub struct Unblock<R> {
    slot: Arc<Mutex<UnblockState<R>>>,
}

#[cfg(not(target_arch = "wasm32"))]
impl<R> Future for Unblock<R> {
    type Output = R;

    fn poll(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<R> {
        let mut state = lock(&self.slot);
        match std::mem::replace(&mut *state, UnblockState::Taken) {
            UnblockState::Waiting(_) => {
                *state = UnblockState::Waiting(Some(context.waker().clone()));
                Poll::Pending
            }
            UnblockState::Done(Ok(value)) => Poll::Ready(value),
            UnblockState::Done(Err(panic)) => {
                drop(state);
                std::panic::resume_unwind(panic)
            }
            UnblockState::Taken => panic!("`unblock` polled after it completed"),
        }
    }
}
