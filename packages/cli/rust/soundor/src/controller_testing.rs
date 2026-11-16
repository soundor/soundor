//! Tests of a controller in plain Rust: [`TestController`] runs the very
//! controller a runtime runs (its stores, control queue, worker and
//! dispatch), with a [`TestHost`] standing in for the runtime's services.

use std::ffi::c_void;
use std::future::Future;
use std::pin::pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};
use std::thread::Thread;
use std::time::{Duration, Instant};

use crate::controller::{AsyncTaskContext, Instance, Ran, TaskContext};
use crate::host::{
    CONTROLLER_ABI_VERSION, HistoryAction, Host, SoundorControllerHost, SoundorWriter,
};
use crate::plugin::{
    METHODS, NativeMethods, PARAMETER_IDS, PRESET_IDS, Parameters, ResourceSlots, STATE_DEFAULTS,
    STATE_FIELDS, STATE_MAX_LENGTHS,
};
use crate::processor::Processor;
use crate::testing::TestProcessor;

/// What the controller changed, as [`TestHost`] records it for undo.
#[derive(Clone, Debug, PartialEq)]
enum Change {
    Parameter {
        index: usize,
        before: f64,
        after: f64,
    },
    State {
        index: usize,
        before: String,
        after: String,
    },
}

#[derive(Default)]
struct Services {
    parameters: Vec<f64>,
    state: Vec<String>,
    undo: Vec<Change>,
    redo: Vec<Change>,
    history: Vec<HistoryAction>,
    presets: Vec<String>,
}

/// A runtime's services for a controller under test: the parameters (at
/// their config defaults, constrained to their ranges), the persistent
/// state (as state JSON, checked against each field's `maxLength`), a
/// History of their edits, and the factory presets (whose loads it
/// records, without applying them). Its C table is what a native runtime
/// passes, so the controller reaches it as it reaches a runtime's.
pub struct TestHost {
    services: Mutex<Services>,
    wakes: AtomicUsize,
    waiter: Mutex<Option<Thread>>,
}

impl Default for TestHost {
    fn default() -> Self {
        let mut parameters = vec![0.0; PARAMETER_IDS.len()];
        Parameters::default().write(&mut parameters);
        Self {
            services: Mutex::new(Services {
                parameters,
                state: STATE_DEFAULTS
                    .iter()
                    .map(|json| (*json).to_owned())
                    .collect(),
                ..Services::default()
            }),
            wakes: AtomicUsize::new(0),
            waiter: Mutex::new(None),
        }
    }
}

fn index_of(names: &[&str], name: &str, what: &str) -> usize {
    names
        .iter()
        .position(|candidate| *candidate == name)
        .unwrap_or_else(|| panic!("soundor.config declares no {what} {name:?}"))
}

impl TestHost {
    fn services(&self) -> std::sync::MutexGuard<'_, Services> {
        self.services
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    /// Parameter `id`'s plain value.
    pub fn parameter(&self, id: &str) -> f64 {
        self.services().parameters[index_of(PARAMETER_IDS, id, "parameter")]
    }

    /// Sets parameter `id`, as the host (automation) would: not in History.
    pub fn set_parameter(&self, id: &str, plain: f64) {
        self.services().parameters[index_of(PARAMETER_IDS, id, "parameter")] = plain;
    }

    /// State field `name`'s value, as state JSON.
    pub fn state_json(&self, name: &str) -> String {
        self.services().state[index_of(&STATE_FIELDS, name, "state field")].clone()
    }

    /// Sets state field `name` from its JSON, as a restored session would.
    pub fn set_state_json(&self, name: &str, json: &str) {
        self.services().state[index_of(&STATE_FIELDS, name, "state field")] = json.to_owned();
    }

    /// The History actions the controller took, in order.
    pub fn history_actions(&self) -> Vec<HistoryAction> {
        self.services().history.clone()
    }

    /// The factory presets the controller loaded, in order.
    pub fn loaded_presets(&self) -> Vec<String> {
        self.services().presets.clone()
    }

    /// How many times the controller asked to be run.
    pub fn wakes(&self) -> usize {
        self.wakes.load(Ordering::SeqCst)
    }

    /// The C table a native runtime would pass, on `self`.
    pub fn table(&self) -> SoundorControllerHost {
        SoundorControllerHost {
            size: std::mem::size_of::<SoundorControllerHost>() as u32,
            abi_version: CONTROLLER_ABI_VERSION,
            user: (self as *const Self).cast_mut().cast(),
            wake: Some(wake),
            parameter_get: Some(parameter_get),
            parameter_set: Some(parameter_set),
            state_get: Some(state_get),
            state_set: Some(state_set),
            history: Some(history),
            preset_load: Some(preset_load),
        }
    }

    fn apply(&self, change: &Change, forward: bool) {
        let mut services = self.services();
        match change {
            Change::Parameter {
                index,
                before,
                after,
            } => {
                services.parameters[*index] = if forward { *after } else { *before };
            }
            Change::State {
                index,
                before,
                after,
            } => {
                services.state[*index] = if forward { after } else { before }.clone();
            }
        }
    }
}

/// # Safety
///
/// `user` is the `TestHost` whose `table()` the runtime passes.
unsafe fn host<'a>(user: *mut c_void) -> &'a TestHost {
    // SAFETY: as the caller promises.
    unsafe { &*user.cast::<TestHost>() }
}

unsafe extern "C" fn wake(user: *mut c_void) {
    // SAFETY: the table's own `user`.
    let host = unsafe { host(user) };
    host.wakes.fetch_add(1, Ordering::SeqCst);
    if let Some(thread) = host
        .waiter
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .as_ref()
    {
        thread.unpark();
    }
}

unsafe extern "C" fn parameter_get(user: *mut c_void, index: u32) -> f64 {
    // SAFETY: as `wake`.
    let host = unsafe { host(user) };
    host.services()
        .parameters
        .get(index as usize)
        .copied()
        .unwrap_or(f64::NAN)
}

unsafe extern "C" fn parameter_set(user: *mut c_void, index: u32, plain: f64) -> i32 {
    // SAFETY: as `wake`.
    let host = unsafe { host(user) };
    let index = index as usize;
    let Some(&(min, max, integer)) = Parameters::RANGES.get(index) else {
        return 1;
    };
    if !plain.is_finite() {
        return 1;
    }
    let mut value = plain.clamp(min, max);
    if integer {
        value = value.round();
    }
    let mut services = host.services();
    let before = services.parameters[index];
    services.parameters[index] = value;
    services.undo.push(Change::Parameter {
        index,
        before,
        after: value,
    });
    services.redo.clear();
    0
}

unsafe extern "C" fn state_get(user: *mut c_void, index: u32, out: SoundorWriter) -> i32 {
    // SAFETY: as `wake`.
    let host = unsafe { host(user) };
    match host.services().state.get(index as usize) {
        Some(json) => {
            out.send(json.as_bytes());
            0
        }
        None => {
            out.send(b"no such state field");
            1
        }
    }
}

unsafe extern "C" fn state_set(
    user: *mut c_void,
    index: u32,
    json: *const u8,
    length: usize,
    error: SoundorWriter,
) -> i32 {
    // SAFETY: as `wake`; `json` is valid for `length` bytes.
    let (host, json) = unsafe { (host(user), std::slice::from_raw_parts(json, length)) };
    let index = index as usize;
    let Ok(json) = std::str::from_utf8(json) else {
        error.send(b"invalid UTF-8");
        return 1;
    };
    if index >= STATE_FIELDS.len() {
        error.send(b"no such state field");
        return 1;
    }
    if let Some(max) = STATE_MAX_LENGTHS[index] {
        if let Ok(crate::json::Json::Array(values)) = crate::json::parse(json) {
            if values.len() > max {
                error.send(
                    format!("state.{}: at most {max} elements", STATE_FIELDS[index]).as_bytes(),
                );
                return 1;
            }
        }
    }
    let mut services = host.services();
    let before = std::mem::replace(&mut services.state[index], json.to_owned());
    services.undo.push(Change::State {
        index,
        before,
        after: json.to_owned(),
    });
    services.redo.clear();
    0
}

unsafe extern "C" fn history(user: *mut c_void, action: u32) -> i32 {
    // SAFETY: as `wake`.
    let host = unsafe { host(user) };
    let action = match action {
        0 => HistoryAction::Undo,
        1 => HistoryAction::Redo,
        2 => HistoryAction::CanUndo,
        3 => HistoryAction::CanRedo,
        _ => return -1,
    };
    let mut services = host.services();
    match action {
        HistoryAction::CanUndo => i32::from(!services.undo.is_empty()),
        HistoryAction::CanRedo => i32::from(!services.redo.is_empty()),
        HistoryAction::Undo | HistoryAction::Redo => {
            services.history.push(action);
            let undo = action == HistoryAction::Undo;
            let change = if undo {
                services.undo.pop()
            } else {
                services.redo.pop()
            };
            let Some(change) = change else {
                return 1;
            };
            if undo {
                services.redo.push(change.clone());
            } else {
                services.undo.push(change.clone());
            }
            drop(services);
            host.apply(&change, !undo);
            0
        }
    }
}

unsafe extern "C" fn preset_load(
    user: *mut c_void,
    id: *const u8,
    length: usize,
    error: SoundorWriter,
) -> i32 {
    // SAFETY: as `state_set`.
    let (host, id) = unsafe { (host(user), std::slice::from_raw_parts(id, length)) };
    let id = String::from_utf8_lossy(id).into_owned();
    if !PRESET_IDS.contains(&id.as_str()) {
        error.send(format!("Unknown factory preset '{id}'").as_bytes());
        return 1;
    }
    host.services().presets.push(id);
    0
}

/// A plugin instance's controller, run as a runtime runs it, with a
/// [`TestHost`]'s services.
///
/// ```ignore
/// use soundor::testing::TestController;
///
/// #[test]
/// fn counts() {
///     let controller = TestController::<PluginController>::new();
///     assert_eq!(controller.task(|ctx| PluginController::increment(ctx)), 1);
///     let later = PluginController::increment_later(controller.async_context());
///     assert_eq!(controller.block_on(later).unwrap(), 2);
/// }
/// ```
pub struct TestController<C: NativeMethods> {
    // Dropped first: it calls into `host` until it is shut down.
    instance: Instance<C>,
    host: Box<TestHost>,
}

impl<C: NativeMethods> Default for TestController<C> {
    fn default() -> Self {
        Self::new()
    }
}

struct Unpark(Thread);

impl Wake for Unpark {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }

    fn wake_by_ref(self: &Arc<Self>) {
        self.0.unpark();
    }
}

impl<C: NativeMethods> TestController<C> {
    /// A controller, with stores of their [`Default`], whose resources no
    /// processor reads.
    pub fn new() -> Self {
        Self::with_resources(Arc::new(ResourceSlots::default()))
    }

    /// A controller of the same plugin instance as `processor`: what it
    /// publishes, `processor` reads from its next block.
    pub fn for_processor<P: Processor>(processor: &TestProcessor<P>) -> Self {
        Self::with_resources(processor.resource_slots())
    }

    fn with_resources(slots: Arc<ResourceSlots>) -> Self {
        let host = Box::new(TestHost::default());
        let services = Host::new(host.table()).expect("the test host's table");
        let wake = services.waker();
        Self {
            instance: Instance::new(services, wake, slots),
            host,
        }
    }

    /// The runtime's services.
    pub fn host(&self) -> &TestHost {
        &self.host
    }

    /// Runs `body` as a synchronous native method runs, with a fresh
    /// [`TaskContext`]: `controller.task(|ctx| PluginController::reset(ctx))`.
    pub fn task<R>(&self, body: impl FnOnce(&mut TaskContext<'_, C>) -> R) -> R {
        match self.instance.with_context(body) {
            Ok(value) => value,
            Err(error) => panic!("{}", error.message()),
        }
    }

    /// An async method's context, as the runtime makes one for each call.
    pub fn async_context(&self) -> AsyncTaskContext<C> {
        self.instance.async_context()
    }

    /// Runs what the control queue holds, one item at a time, until it is
    /// empty: scheduled callbacks run, and async methods' completions are
    /// discarded (see [`call_async`](Self::call_async)). Returns how many
    /// callbacks ran.
    pub fn run_until_idle(&self) -> usize {
        let mut ran = 0;
        while let Ok(item) = self.instance.run() {
            match item {
                Ran::Nothing => break,
                Ran::Task => ran += 1,
                Ran::Completion { .. } => {}
            }
        }
        ran
    }

    /// Polls `future` on this thread until it completes, running the
    /// control queue in between, as the control thread would: a future that
    /// awaits [`schedule`](AsyncTaskContext::schedule) completes. Panics
    /// after ten seconds.
    pub fn block_on<F: Future>(&self, future: F) -> F::Output {
        let mut future = pin!(future);
        let current = std::thread::current();
        *self
            .host
            .waiter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(current.clone());
        let waker = Waker::from(Arc::new(Unpark(current)));
        let mut context = Context::from_waker(&waker);
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
                return value;
            }
            if self.run_until_idle() == 0 {
                assert!(
                    Instant::now() < deadline,
                    "block_on: the future never completed"
                );
                std::thread::park_timeout(Duration::from_millis(10));
            }
        }
    }

    /// Calls the native method `name` as the runtime does, with its
    /// arguments encoded (`soundor::wire`): a synchronous method's encoded
    /// result, or its failure's message.
    pub fn call(&self, name: &str, args: &[u8]) -> Result<Vec<u8>, String> {
        self.instance
            .call(method(name), args)
            .map_err(|error| error.message())
    }

    /// Starts the async native method `name` as the runtime does, on the
    /// controller's worker: its operation, for [`wait`](Self::wait) or
    /// [`cancel`](Self::cancel).
    pub fn start(&self, name: &str, args: &[u8], operation: u64) -> Result<(), String> {
        self.instance
            .start(method(name), operation, args)
            .map_err(|error| error.message())
    }

    /// Runs the control queue until `operation` completes, and returns its
    /// encoded result or its failure's message, as the runtime would hand
    /// them to JavaScript. Panics after ten seconds.
    pub fn wait(&self, operation: u64) -> Result<Vec<u8>, String> {
        *self
            .host
            .waiter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(std::thread::current());
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match self.instance.run() {
                Ok(Ran::Completion {
                    operation: done,
                    result,
                }) if done == operation => return result,
                Ok(Ran::Nothing) => {
                    assert!(
                        Instant::now() < deadline,
                        "operation {operation} never completed"
                    );
                    std::thread::park_timeout(Duration::from_millis(10));
                }
                Ok(_) => {}
                Err(error) => panic!("{}", error.message()),
            }
        }
    }

    /// Calls and awaits the async native method `name`.
    pub fn call_async(&self, name: &str, args: &[u8]) -> Result<Vec<u8>, String> {
        static NEXT: AtomicUsize = AtomicUsize::new(1);
        let operation = NEXT.fetch_add(1, Ordering::Relaxed) as u64;
        self.start(name, args, operation)?;
        self.wait(operation)
    }

    /// Cancels `operation`, as the runtime does when its editor closes.
    pub fn cancel(&self, operation: u64) {
        self.instance.cancel(operation);
    }

    /// Shuts the controller down, as the runtime does when the plugin
    /// instance is destroyed: queued callbacks never run, and tasks are
    /// dropped.
    pub fn shutdown(&self) {
        self.instance.shutdown();
    }
}

fn method(name: &str) -> u32 {
    METHODS
        .iter()
        .position(|(candidate, _)| *candidate == name)
        .unwrap_or_else(|| panic!("soundor.config declares no native method {name:?}")) as u32
}
