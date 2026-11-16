//! A plugin's controller: the Rust behind its `soundor:native` methods, on
//! the control thread beside the UI, as the processor is the Rust on the
//! audio thread.
//!
//! [`Controller`] names a plugin instance's two stores: [`Controller::Local`],
//! the control thread's own, and [`Controller::Shared`], which async tasks
//! share. soundor.config's `native.methods` are generated as the
//! [`NativeMethods`](crate::NativeMethods) trait, which the controller type
//! implements, each method an associated function taking its context:
//!
//! - a synchronous method gets a [`TaskContext`], scoped to the call: the
//!   stores, parameters, persistent state, History, presets and the
//!   processor's resources;
//! - an `async: true` one gets an [`AsyncTaskContext`], owned and `Send`:
//!   the shared store, the processor's resources, and
//!   [`schedule`](AsyncTaskContext::schedule), which runs a callback with a
//!   fresh `TaskContext` on the control thread and returns what it returns.
//!
//! The runtime owns the stores, one of each per plugin instance, from its
//! creation to its destruction, whether or not an editor is open.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::future::Future;
use std::marker::PhantomData;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use crate::error::{Error, panic_message};
use crate::executor::{Executor, Task, TaskFuture};
use crate::host::{HistoryAction, Host, Wake};
use crate::json::StateValue;
use crate::plugin::{
    self, NativeMethods, ParameterAccess, ResourcePublishers, ResourceSlots, StateAccess,
};
use crate::schedule::{ControlItem, ControlQueue, Schedule, ScheduleError};

/// A plugin's controller: the type that implements its generated
/// [`NativeMethods`](crate::NativeMethods). It is never constructed: its
/// methods take no `self`, and what it keeps between calls lives in its two
/// stores, which Soundor creates (with [`Default`]) once per plugin instance.
///
/// ```
/// use soundor::prelude::*;
/// use std::sync::atomic::AtomicU64;
///
/// #[derive(Default)]
/// pub struct LocalStore {
///     selected: Option<String>,
/// }
///
/// #[derive(Default)]
/// pub struct SharedStore {
///     requests: AtomicU64,
/// }
///
/// pub struct PluginController;
///
/// impl Controller for PluginController {
///     type Local = LocalStore;
///     type Shared = SharedStore;
/// }
/// ```
///
/// Neither store is persistent: nothing in them is saved with the plugin,
/// recorded in History or seen by the processor. Persistent data belongs in
/// soundor.config's `state`, which [`TaskContext::state`] reads and writes.
pub trait Controller: 'static {
    /// The control thread's store: only synchronous methods and scheduled
    /// callbacks reach it, one at a time, so it needs no locks and need not
    /// be `Send`.
    type Local: Default + 'static;
    /// The store async tasks share with the control thread, from any
    /// thread: atomics, locks, channels.
    type Shared: Default + Send + Sync + 'static;
}

/// The plugin's identity, from soundor.config.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PluginInfo {
    /// `plugin.id`.
    pub id: &'static str,
    /// `plugin.name`.
    pub name: &'static str,
}

impl PluginInfo {
    pub(crate) const CURRENT: Self = Self {
        id: plugin::PLUGIN_ID,
        name: plugin::PLUGIN_NAME,
    };
}

/// The processor's side a controller reaches: its audio resources, through
/// the same real-time-safe publication `prepare` uses. Never the processor
/// itself.
#[derive(Clone)]
pub struct ProcessorHandle {
    slots: Arc<ResourceSlots>,
}

impl ProcessorHandle {
    pub(crate) fn new(slots: Arc<ResourceSlots>) -> Self {
        Self { slots }
    }

    /// The config's audio resources, to publish: the processing reads a
    /// publication from its next block, and the one it replaces is freed
    /// off the audio thread (`ctx.processor.resources().wavetable.publish(table)`).
    pub fn resources(&self) -> ResourcePublishers<'_> {
        ResourcePublishers::new(&self.slots)
    }
}

/// A controller's stores, as a synchronous task reaches them.
pub struct TaskStore<'a, C: Controller> {
    /// The control thread's store.
    pub local: &'a mut C::Local,
    /// The store async tasks share.
    pub shared: &'a C::Shared,
}

/// What a synchronous native method, or a callback
/// [`schedule`](AsyncTaskContext::schedule)d onto the control thread, is
/// given: borrowed for that one call, on the control thread.
///
/// It is neither `Send` nor `Sync`, and its lifetime ends with the call: it
/// cannot be kept, moved to another thread, or held across an `.await`. A
/// synchronous method that needs to wait starts nothing; it is an
/// `async: true` method instead.
///
/// ```compile_fail
/// # use soundor::prelude::*;
/// fn keep<C: Controller>(ctx: &mut TaskContext<'_, C>) -> std::thread::JoinHandle<()> {
///     std::thread::spawn(move || drop(ctx)) // `TaskContext` is not `Send`
/// }
/// ```
///
/// ```compile_fail
/// # use soundor::prelude::*;
/// fn escape<'a, C: Controller>(ctx: &mut TaskContext<'a, C>) -> &'static C::Local {
///     ctx.store.local // borrowed for the call only
/// }
/// ```
pub struct TaskContext<'a, C: Controller> {
    /// The controller's stores.
    pub store: TaskStore<'a, C>,
    /// The parameters, typed as soundor.config declares them: `get()` and
    /// `set()`, which edits one as the UI does (constrained, recorded in
    /// History, told to the host).
    pub params: ParameterAccess<'a>,
    /// The persistent state, typed as declared, through the state store the
    /// UI uses: a change reaches the UI, History and the processor's
    /// snapshot as the UI's own do.
    pub state: StateAccess<'a>,
    /// The plugin's History: undo and redo.
    pub history: HistoryAccess<'a>,
    /// The config's factory presets.
    pub presets: PresetsAccess<'a>,
    /// The processor's audio resources.
    pub processor: &'a ProcessorHandle,
    /// The plugin's identity.
    pub plugin: PluginInfo,
    _control_thread: PhantomData<*const ()>,
}

/// The plugin's History, from the control thread.
pub struct HistoryAccess<'a> {
    host: &'a Host,
}

impl HistoryAccess<'_> {
    /// Undoes the last entry; false when there was none or it failed.
    pub fn undo(&self) -> bool {
        self.host.history(HistoryAction::Undo) == 0
    }

    /// Redoes the last undone entry; false when there was none or it failed.
    pub fn redo(&self) -> bool {
        self.host.history(HistoryAction::Redo) == 0
    }

    /// Whether there is an entry to undo.
    pub fn can_undo(&self) -> bool {
        self.host.history(HistoryAction::CanUndo) == 1
    }

    /// Whether there is an entry to redo.
    pub fn can_redo(&self) -> bool {
        self.host.history(HistoryAction::CanRedo) == 1
    }
}

/// The config's factory presets, from the control thread.
pub struct PresetsAccess<'a> {
    host: &'a Host,
}

impl PresetsAccess<'_> {
    /// The ids of the config's factory presets, in its order.
    pub fn ids(&self) -> &'static [&'static str] {
        plugin::PRESET_IDS
    }

    /// Loads the factory preset `id`, as `soundor:presets` does: its
    /// parameters and state, as one History entry.
    pub fn load(&self, id: &str) -> Result<(), Error> {
        self.host.load_preset(id)
    }
}

/// How a parameter's plain value reads as its Rust type.
#[doc(hidden)]
pub trait ParameterValue: Copy {
    fn from_plain(plain: f64) -> Self;
    fn to_plain(self) -> f64;
}

impl ParameterValue for f32 {
    fn from_plain(plain: f64) -> Self {
        plain as f32
    }
    fn to_plain(self) -> f64 {
        f64::from(self)
    }
}

impl ParameterValue for i32 {
    fn from_plain(plain: f64) -> Self {
        plain.round() as i32
    }
    fn to_plain(self) -> f64 {
        f64::from(self)
    }
}

impl ParameterValue for bool {
    fn from_plain(plain: f64) -> Self {
        plain >= 0.5
    }
    fn to_plain(self) -> f64 {
        if self { 1.0 } else { 0.0 }
    }
}

/// A parameter the controller edits.
pub struct Parameter<'a, T> {
    host: &'a Host,
    index: u32,
    _type: PhantomData<T>,
}

impl<'a, T: ParameterValue> Parameter<'a, T> {
    // Unused by a plugin without parameters of its kind.
    #[allow(dead_code)]
    pub(crate) fn new(host: &'a Host, index: u32) -> Self {
        Self {
            host,
            index,
            _type: PhantomData,
        }
    }

    /// Its current value.
    pub fn get(&self) -> T {
        T::from_plain(self.host.parameter(self.index))
    }

    /// Sets it as the UI does: constrained to its range and steps, recorded
    /// in History, and told to the host and to every editor.
    pub fn set(&self, value: T) {
        self.host.set_parameter(self.index, value.to_plain());
    }
}

/// A read-only parameter (a meter the processing publishes).
pub struct ReadOnlyParameter<'a, T> {
    host: &'a Host,
    index: u32,
    _type: PhantomData<T>,
}

impl<'a, T: ParameterValue> ReadOnlyParameter<'a, T> {
    // Unused by a plugin without parameters of its kind.
    #[allow(dead_code)]
    pub(crate) fn new(host: &'a Host, index: u32) -> Self {
        Self {
            host,
            index,
            _type: PhantomData,
        }
    }

    /// Its current value.
    pub fn get(&self) -> T {
        T::from_plain(self.host.parameter(self.index))
    }
}

/// A persistent state field, through the runtime's state store.
pub struct StateField<'a, T> {
    host: &'a Host,
    index: u32,
    name: &'static str,
    _type: PhantomData<T>,
}

impl<'a, T: StateValue> StateField<'a, T> {
    // Unused by a plugin without persistent state.
    #[allow(dead_code)]
    pub(crate) fn new(host: &'a Host, index: u32, name: &'static str) -> Self {
        Self {
            host,
            index,
            name,
            _type: PhantomData,
        }
    }

    /// Its current value, an open History gesture's included.
    pub fn get(&self) -> T {
        self.try_get()
            .unwrap_or_else(|error| panic!("state.{}: {error}", self.name))
    }

    /// Its current value, or why the runtime could not give it.
    pub fn try_get(&self) -> Result<T, Error> {
        let json = self.host.state(self.index)?;
        crate::json::from_json(&json).map_err(Error::from)
    }

    /// Sets it as the UI does: checked against its declaration (an array's
    /// `maxLength`), recorded in History, and published to the UI and, for
    /// an `audio: true` field, to the processing. Panics with the reason
    /// when the value is refused; [`try_set`](Self::try_set) returns it.
    pub fn set(&self, value: impl Into<T>) {
        if let Err(error) = self.try_set(value) {
            panic!("state.{}: {error}", self.name);
        }
    }

    /// As [`set`](Self::set), returning why a value was refused.
    pub fn try_set(&self, value: impl Into<T>) -> Result<(), Error> {
        let json = crate::json::to_json(&value.into())?;
        self.host.set_state(self.index, &json)
    }
}

/// A controller's shared store, owned: what an async task keeps across its
/// `.await`s. Dereferences to [`Controller::Shared`].
pub struct SharedStore<C: Controller> {
    core: Arc<Core<C>>,
}

impl<C: Controller> Clone for SharedStore<C> {
    fn clone(&self) -> Self {
        Self {
            core: self.core.clone(),
        }
    }
}

impl<C: Controller> std::ops::Deref for SharedStore<C> {
    type Target = C::Shared;

    fn deref(&self) -> &C::Shared {
        &self.core.shared
    }
}

/// A controller's stores, as an async task reaches them: the shared one
/// only. The local store is the control thread's; reach it with
/// [`AsyncTaskContext::schedule`].
pub struct AsyncStore<C: Controller> {
    /// The store async tasks share.
    pub shared: SharedStore<C>,
}

impl<C: Controller> Clone for AsyncStore<C> {
    fn clone(&self) -> Self {
        Self {
            shared: self.shared.clone(),
        }
    }
}

/// What an `async: true` native method is given: owned, `Send` and `Sync`,
/// to keep across `.await`s and on any thread. It reaches what is safe off
/// the control thread (the shared store, the processor's resources), and
/// [`schedule`](Self::schedule)s the rest onto it.
///
/// It refers to nothing an editor owns: it stays valid after the editor
/// that called the method closed, and after the plugin instance is
/// destroyed, when `schedule` fails with [`ScheduleError::ShutDown`].
pub struct AsyncTaskContext<C: Controller> {
    /// The controller's shared store.
    pub store: AsyncStore<C>,
    /// The processor's audio resources.
    pub processor: ProcessorHandle,
    /// The plugin's identity.
    pub plugin: PluginInfo,
    core: Arc<Core<C>>,
}

impl<C: Controller> Clone for AsyncTaskContext<C> {
    fn clone(&self) -> Self {
        Self {
            store: self.store.clone(),
            processor: self.processor.clone(),
            plugin: self.plugin,
            core: self.core.clone(),
        }
    }
}

impl<C: Controller> AsyncTaskContext<C> {
    pub(crate) fn new(core: &Arc<Core<C>>) -> Self {
        Self {
            store: AsyncStore {
                shared: SharedStore { core: core.clone() },
            },
            processor: core.processor.clone(),
            plugin: PluginInfo::CURRENT,
            core: core.clone(),
        }
    }

    /// Runs `callback` on the control thread, with a [`TaskContext`] of its
    /// own, and resolves to what it returns.
    ///
    /// Lazy, as Rust futures are: nothing is queued until the returned
    /// future is first polled (awaited). The callback then runs at the
    /// control thread's next opportunity, never inside another call, and
    /// alone: no JavaScript or other callback runs meanwhile.
    ///
    /// Dropping the future before the callback started cancels it: it never
    /// runs. Once it started it runs to its end, and what it returns is
    /// dropped. Cancellation undoes nothing a callback did.
    ///
    /// Fails with [`ScheduleError::ShutDown`] when the plugin instance shut
    /// down before the callback ran, and [`ScheduleError::Panicked`] when it
    /// panicked. A callback's own errors are its return value:
    /// `ctx.schedule(|ctx| ctx.presets.load("warm")).await??`.
    pub fn schedule<R, F>(&self, callback: F) -> Schedule<C, F, R>
    where
        F: FnOnce(&mut TaskContext<'_, C>) -> R + Send + 'static,
        R: Send + 'static,
    {
        Schedule::new(self.core.clone(), callback)
    }
}

/// What a plugin instance's controller shares with its tasks.
pub(crate) struct Core<C: Controller> {
    pub shared: C::Shared,
    pub control: ControlQueue<C>,
    pub executor: Executor,
    pub processor: ProcessorHandle,
}

/// Why a native call did not run.
#[derive(Debug)]
pub(crate) enum CallError {
    NoSuchMethod,
    /// A synchronous call of an async method, or the other way around.
    // Never made by a config whose methods are all of one kind.
    #[allow(dead_code)]
    WrongKind,
    Malformed(crate::wire::WireError),
    /// A call while another holds the local store (a service calling back
    /// into the controller).
    Reentrant,
    ShutDown,
    Panicked(String),
    Failed(String),
}

impl CallError {
    pub fn message(&self) -> String {
        match self {
            Self::NoSuchMethod => "the controller has no such method".into(),
            Self::WrongKind => "called as the other kind of method (sync or async)".into(),
            Self::Malformed(error) => error.to_string(),
            Self::Reentrant => "the controller was called again during one of its own calls".into(),
            Self::ShutDown => "the plugin instance has shut down".into(),
            Self::Panicked(message) => format!("the controller panicked: {message}"),
            Self::Failed(message) => message.clone(),
        }
    }
}

impl From<crate::wire::WireError> for CallError {
    fn from(error: crate::wire::WireError) -> Self {
        Self::Malformed(error)
    }
}

/// A method's future, its result encoded.
pub(crate) type NativeFuture = Pin<Box<dyn Future<Output = Result<Vec<u8>, Error>> + Send>>;

/// What [`Instance::run`] did.
pub(crate) enum Ran {
    Nothing,
    Task,
    Completion {
        operation: u64,
        result: Result<Vec<u8>, String>,
    },
}

/// One plugin instance's controller: its stores, its control queue and its
/// executor. Owned by the runtime, on the control thread.
pub(crate) struct Instance<C: NativeMethods> {
    core: Arc<Core<C>>,
    local: RefCell<C::Local>,
    host: Host,
    operations: RefCell<HashMap<u64, Arc<Task>>>,
    shut_down: Cell<bool>,
}

/// Polls a method's future, turning a panic into its failure.
struct Guarded(NativeFuture);

impl Future for Guarded {
    type Output = Result<Vec<u8>, String>;

    fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
        match catch_unwind(AssertUnwindSafe(|| self.0.as_mut().poll(context))) {
            Ok(Poll::Pending) => Poll::Pending,
            Ok(Poll::Ready(result)) => {
                Poll::Ready(result.map_err(|error| error.message().to_owned()))
            }
            Err(panic) => Poll::Ready(Err(format!("panicked: {}", panic_message(&*panic)))),
        }
    }
}

impl<C: NativeMethods> Instance<C> {
    pub fn new(host: Host, wake: Wake, slots: Arc<ResourceSlots>) -> Self {
        Self {
            core: Arc::new(Core {
                shared: C::Shared::default(),
                control: ControlQueue::new(wake.clone()),
                executor: Executor::new(wake),
                processor: ProcessorHandle::new(slots),
            }),
            local: RefCell::new(C::Local::default()),
            host,
            operations: RefCell::new(HashMap::new()),
            shut_down: Cell::new(false),
        }
    }

    pub fn async_context(&self) -> AsyncTaskContext<C> {
        AsyncTaskContext::new(&self.core)
    }

    /// Runs `body` with a fresh [`TaskContext`].
    pub fn with_context<R>(
        &self,
        body: impl FnOnce(&mut TaskContext<'_, C>) -> R,
    ) -> Result<R, CallError> {
        if self.shut_down.get() {
            return Err(CallError::ShutDown);
        }
        let mut local = self
            .local
            .try_borrow_mut()
            .map_err(|_| CallError::Reentrant)?;
        let mut ctx = TaskContext {
            store: TaskStore {
                local: &mut *local,
                shared: &self.core.shared,
            },
            params: ParameterAccess::new(&self.host),
            state: StateAccess::new(&self.host),
            history: HistoryAccess { host: &self.host },
            presets: PresetsAccess { host: &self.host },
            processor: &self.core.processor,
            plugin: PluginInfo::CURRENT,
            _control_thread: PhantomData,
        };
        catch_unwind(AssertUnwindSafe(|| body(&mut ctx)))
            .map_err(|panic| CallError::Panicked(panic_message(&*panic)))
    }

    /// A synchronous method: its encoded result.
    pub fn call(&self, method: u32, args: &[u8]) -> Result<Vec<u8>, CallError> {
        self.with_context(|ctx| plugin::call::<C>(method, ctx, args))?
    }

    /// Starts an async method as `operation`, whose completion
    /// [`run`](Self::run) hands back.
    pub fn start(&self, method: u32, operation: u64, args: &[u8]) -> Result<(), CallError> {
        if self.shut_down.get() {
            return Err(CallError::ShutDown);
        }
        let context = self.async_context();
        let future = catch_unwind(AssertUnwindSafe(|| {
            plugin::start::<C>(method, context, args)
        }))
        .map_err(|panic| CallError::Panicked(panic_message(&*panic)))??;
        let core = self.core.clone();
        let task: TaskFuture = Box::pin(async move {
            let result = Guarded(future).await;
            // Dropped when the instance has shut down meanwhile.
            let _ = core
                .control
                .push(ControlItem::Completion { operation, result });
        });
        let task = self.core.executor.spawn(task).ok_or(CallError::ShutDown)?;
        self.operations.borrow_mut().insert(operation, task);
        Ok(())
    }

    /// Cancels `operation`: its completion is never handed back, and its
    /// future is dropped at its next suspension point.
    pub fn cancel(&self, operation: u64) {
        let task = self.operations.borrow_mut().remove(&operation);
        if let Some(task) = task {
            self.core.executor.cancel(&task);
        }
    }

    /// Runs the next item of the control queue: a scheduled callback, or an
    /// async method's completion, which the runtime then delivers.
    pub fn run(&self) -> Result<Ran, CallError> {
        if self.shut_down.get() {
            return Ok(Ran::Nothing);
        }
        if self.local.try_borrow_mut().is_err() {
            return Err(CallError::Reentrant);
        }
        loop {
            match self.core.control.pop() {
                None => {
                    // Browser futures and scheduled control callbacks get
                    // separate turns; neither executes inside the other.
                    #[cfg(target_arch = "wasm32")]
                    if self.core.executor.poll_one() {
                        return Ok(Ran::Task);
                    }
                    return Ok(Ran::Nothing);
                }
                // A cancelled callback is dropped: it never runs, and is no
                // task of the control thread's.
                Some(ControlItem::Task(task)) if !task.pending() => {}
                Some(ControlItem::Task(task)) => {
                    // A callback's panic is its future's error, not ours. Its
                    // future may cancel it between `pending` and here: `run`
                    // decides under the slot's lock.
                    self.with_context(|ctx| task.run(ctx))?;
                    return Ok(Ran::Task);
                }
                Some(ControlItem::Completion { operation, result }) => {
                    // A cancelled operation's completion is dropped.
                    if self.operations.borrow_mut().remove(&operation).is_some() {
                        return Ok(Ran::Completion { operation, result });
                    }
                }
            }
        }
    }

    /// Invalidates every queued callback (their futures fail with
    /// [`ScheduleError::ShutDown`]), drops every task on the worker, and
    /// waits for it. Afterwards nothing of the controller runs again.
    pub fn shutdown(&self) {
        if self.shut_down.replace(true) {
            return;
        }
        for item in self.core.control.close() {
            match item {
                ControlItem::Task(task) => task.shut_down(),
                ControlItem::Completion { .. } => {}
            }
        }
        self.core.executor.shutdown();
        self.operations.borrow_mut().clear();
        // What tasks dropped meanwhile queued, discarded.
        for item in self.core.control.close() {
            if let ControlItem::Task(task) = item {
                task.shut_down();
            }
        }
    }
}

impl<C: NativeMethods> Drop for Instance<C> {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// Unused while a crate's controller methods use none of them.
#[allow(dead_code)]
fn _assert_contexts() {
    fn send_sync<T: Send + Sync>() {}
    fn contexts<C: Controller>() {
        send_sync::<AsyncTaskContext<C>>();
    }
}

/// Converts a `ScheduleError` into the [`Error`] a method fails with.
impl From<ScheduleError> for CallError {
    fn from(error: ScheduleError) -> Self {
        Self::Failed(error.to_string())
    }
}
