//! A controller implementing the SDK fixture's native methods, run as a
//! runtime runs it: synchronous and async methods, the stores, the
//! services, `schedule()`, and cancellation.

use std::future::Future;
use std::pin::pin;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Barrier, Mutex};
use std::task::{Context, Poll, Waker};

use soundor::prelude::*;
use soundor::testing::{HistoryAction, TestController, TestProcessor};
use soundor::types::{Analysis, Curve, Point};
use soundor::wire::{Reader, Wire, to_bytes};

/// Counts its live values.
struct Tracked(Arc<AtomicUsize>);

impl Tracked {
    fn new(live: &Arc<AtomicUsize>) -> Self {
        live.fetch_add(1, Ordering::SeqCst);
        Self(live.clone())
    }
}

impl Drop for Tracked {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Default)]
struct LocalStore {
    counter: i32,
    // Not Send: the local store need not be.
    last: std::rc::Rc<std::cell::Cell<i32>>,
}

#[derive(Default)]
struct SharedStore {
    requests: AtomicU64,
    // Set by a task that waits forever, dropped when it is cancelled.
    waiting: Mutex<Option<Arc<AtomicUsize>>>,
}

struct PluginController;

impl Controller for PluginController {
    type Local = LocalStore;
    type Shared = SharedStore;
}

impl NativeMethods for PluginController {
    fn analyze(_ctx: &mut TaskContext<Self>, samples: Vec<f32>) -> Analysis {
        Analysis {
            peak: samples
                .iter()
                .fold(0.0f32, |peak, sample| peak.max(sample.abs())),
            points: samples
                .iter()
                .enumerate()
                .map(|(index, sample)| Point {
                    x: index as f64,
                    y: f64::from(*sample),
                })
                .collect(),
            label: samples.is_empty().then(|| "silence".to_owned()),
        }
    }

    fn describe(ctx: &mut TaskContext<Self>, gain: f32, id: u64, tags: Vec<String>) -> String {
        ctx.params.gain.set(gain);
        ctx.state.tags.set(tags.clone());
        format!("{id}: {} [{}]", ctx.params.gain.get(), tags.join(","))
    }

    async fn fail(_ctx: AsyncTaskContext<Self>, message: String) -> Result<(), Error> {
        Err(Error::new(message))
    }

    fn increment(ctx: &mut TaskContext<Self>) -> i32 {
        ctx.store.local.counter += 1;
        ctx.store.local.last.set(ctx.store.local.counter);
        ctx.store.local.counter
    }

    async fn increment_later(ctx: AsyncTaskContext<Self>) -> Result<i32, Error> {
        ctx.store.shared.requests.fetch_add(1, Ordering::Relaxed);
        Ok(ctx
            .schedule(|ctx| {
                ctx.store.local.counter += 1;
                ctx.store.local.counter
            })
            .await?)
    }

    async fn load_table(ctx: AsyncTaskContext<Self>, length: u32) -> Result<Vec<f32>, Error> {
        if length == u32::MAX {
            // Waits forever, until its task is cancelled.
            let live = ctx.store.shared.waiting.lock().unwrap().clone().unwrap();
            let _tracked = Tracked::new(&live);
            std::future::pending::<()>().await;
        }
        // Genuinely asynchronous: computed on a thread of its own.
        let table = soundor::unblock(move || {
            (0..length)
                .map(|index| index as f32 / length.max(1) as f32)
                .collect::<Vec<f32>>()
        })
        .await;
        ctx.processor.resources().wavetable.publish(table.clone());
        let published = table.len();
        let recorded = ctx
            .schedule(move |ctx| {
                ctx.state
                    .selected_preset
                    .set(Some(format!("table {published}")));
                ctx.state.selected_preset.get()
            })
            .await?;
        assert_eq!(
            recorded.as_deref(),
            Some(format!("table {published}").as_str())
        );
        Ok(table)
    }

    fn pick(_ctx: &mut TaskContext<Self>, curve: Option<Curve>) -> Curve {
        match curve {
            None => Curve::EaseIn,
            Some(curve) => curve,
        }
    }

    fn reset(ctx: &mut TaskContext<Self>) {
        ctx.store.local.counter = 0;
        ctx.params.gain.set(0.5);
        ctx.state.selected_preset.set(Some("Default".to_owned()));
    }
}

/// Reads the wavetable each block.
#[derive(Default)]
struct PluginProcessor {
    table: usize,
}

impl Processor for PluginProcessor {
    fn prepare(&mut self, _: &PrepareContext) {}

    fn process(&mut self, ctx: &mut ProcessContext) {
        self.table = ctx.resources.wavetable.get().map_or(0, <[f32]>::len);
    }
}

soundor::export!(PluginProcessor, PluginController);

fn decode<T: Wire>(bytes: Vec<u8>) -> T {
    let mut reader = Reader::new(&bytes);
    let value = T::decode(&mut reader).unwrap();
    reader.finish().unwrap();
    value
}

fn noop_waker() -> Waker {
    Waker::noop().clone()
}

fn poll_once<F: Future + Unpin>(future: &mut F) -> Poll<F::Output> {
    let waker = noop_waker();
    std::pin::Pin::new(future).poll(&mut Context::from_waker(&waker))
}

#[test]
fn synchronous_methods_keep_their_local_store_between_calls() {
    let controller = TestController::<PluginController>::new();
    assert_eq!(controller.task(PluginController::increment), 1);
    assert_eq!(controller.task(PluginController::increment), 2);
    // The way a runtime calls it: by name, arguments and result encoded.
    assert_eq!(decode::<i32>(controller.call("increment", &[]).unwrap()), 3);
    assert_eq!(controller.task(|ctx| ctx.store.local.last.get()), 3);
}

#[test]
fn arguments_and_results_of_every_kind_convert() {
    let controller = TestController::<PluginController>::new();
    let mut args = Vec::new();
    1.5f32.encode(&mut args);
    u64::MAX.encode(&mut args);
    vec!["a".to_owned(), "b".to_owned()].encode(&mut args);
    let text: String = decode(controller.call("describe", &args).unwrap());
    assert_eq!(text, "18446744073709551615: 1.5 [a,b]");
    assert_eq!(controller.host().state_json("tags"), r#"["a","b"]"#);

    let analysis: Analysis = decode(
        controller
            .call("analyze", &to_bytes(&vec![0.5f32, -1.0]))
            .unwrap(),
    );
    assert_eq!(analysis.peak, 1.0);
    assert_eq!(analysis.points[1], Point { x: 1.0, y: -1.0 });
    assert_eq!(analysis.label, None);

    assert_eq!(
        decode::<Curve>(controller.call("pick", &to_bytes(&None::<Curve>)).unwrap()),
        Curve::EaseIn
    );
    assert_eq!(
        decode::<Curve>(
            controller
                .call("pick", &to_bytes(&Some(Curve::Linear)))
                .unwrap()
        ),
        Curve::Linear
    );
    // Malformed arguments are refused before the method runs.
    assert!(controller.call("pick", &[7]).is_err());
    assert!(controller.call("pick", &[1, 9, 0, 0, 0]).is_err());
    assert!(controller.call("increment", &[0]).is_err());
}

#[test]
fn the_services_are_the_runtimes() {
    let controller = TestController::<PluginController>::new();
    controller.task(PluginController::reset);
    assert_eq!(controller.host().parameter("gain"), 0.5);
    assert_eq!(
        controller.host().state_json("selectedPreset"),
        r#""Default""#
    );
    controller.task(|ctx| {
        // Clamped to its range, as the UI's edits are.
        ctx.params.gain.set(9.0);
        assert_eq!(ctx.params.gain.get(), 2.0);
        ctx.params.mode.set(soundor::choices::Mode::HardClip);
        assert_eq!(ctx.params.peak.get(), -96.0);
        assert_eq!(ctx.state.seed.get(), 7);
        assert_eq!(ctx.state.pattern.get(), [60, 64, 67]);
        assert_eq!(ctx.state.curve.get(), Curve::Linear);
        ctx.state.curve.set(Curve::EaseIn);
        // Checked against its maxLength.
        let error = ctx.state.tags.try_set(vec![String::new(); 5]).unwrap_err();
        assert!(error.message().contains("at most 4"), "{error}");
        assert!(ctx.history.can_undo());
        assert!(ctx.history.undo());
        assert_eq!(ctx.state.curve.get(), Curve::Linear);
        assert!(ctx.history.redo());
        assert_eq!(ctx.presets.ids(), ["warm"]);
        ctx.presets.load("warm").unwrap();
        assert!(ctx.presets.load("cold").is_err());
        assert_eq!(ctx.plugin.id, "dev.soundor.sdk-fixture");
    });
    assert_eq!(controller.host().parameter("mode"), 2.0);
    assert_eq!(controller.host().state_json("curve"), r#""ease-in""#);
    assert_eq!(
        controller.host().history_actions(),
        [HistoryAction::Undo, HistoryAction::Redo]
    );
    assert_eq!(controller.host().loaded_presets(), ["warm"]);
}

#[test]
fn plugin_instances_have_stores_of_their_own() {
    let first = TestController::<PluginController>::new();
    let second = TestController::<PluginController>::new();
    first.task(PluginController::increment);
    first.task(PluginController::increment);
    assert_eq!(second.task(PluginController::increment), 1);
    first
        .block_on(PluginController::increment_later(first.async_context()))
        .unwrap();
    assert_eq!(
        first
            .async_context()
            .store
            .shared
            .requests
            .load(Ordering::Relaxed),
        1
    );
    assert_eq!(
        second
            .async_context()
            .store
            .shared
            .requests
            .load(Ordering::Relaxed),
        0
    );
}

#[test]
fn async_methods_run_on_the_worker_and_schedule_onto_the_control_thread() {
    let controller = TestController::<PluginController>::new();
    controller.task(PluginController::increment);
    let result = controller.call_async("incrementLater", &[]).unwrap();
    assert_eq!(decode::<i32>(result), 2);
    assert!(controller.host().wakes() > 0);
    let error = controller
        .call_async("fail", &to_bytes(&"no table".to_owned()))
        .unwrap_err();
    assert_eq!(error, "no table");
    // The other kind of call is refused.
    assert!(controller.call("incrementLater", &[]).is_err());
    assert!(controller.start("increment", &[], 99).is_err());
}

#[test]
fn an_async_method_publishes_a_resource_the_processor_reads() {
    let mut processor = TestProcessor::<PluginProcessor>::new().build();
    let controller = TestController::<PluginController>::for_processor(&processor);
    let table: Vec<f32> = decode(
        controller
            .call_async("loadTable", &to_bytes(&64u32))
            .unwrap(),
    );
    assert_eq!(table.len(), 64);
    assert_eq!(
        controller.host().state_json("selectedPreset"),
        r#""table 64""#
    );
    processor.process(&[vec![0.0; 16], vec![0.0; 16]]);
    assert_eq!(processor.processor().table, 64);
}

#[test]
fn schedule_returns_what_its_callback_returns() {
    let controller = TestController::<PluginController>::new();
    let ctx = controller.async_context();
    let values = controller.block_on(async move {
        let number = ctx.schedule(|ctx| ctx.store.local.counter + 41).await?;
        let text = ctx.schedule(|ctx| ctx.plugin.name.to_owned()).await?;
        let nothing: () = ctx.schedule(|ctx| ctx.params.gain.set(0.25)).await?;
        let preset = ctx.schedule(|ctx| ctx.presets.load("nope")).await?;
        Ok::<_, ScheduleError>((number, text, nothing, preset.is_err()))
    });
    assert_eq!(values.unwrap(), (41, "SDK Fixture".to_owned(), (), true));
    assert_eq!(controller.host().parameter("gain"), 0.25);
}

#[test]
fn a_panicking_callback_fails_its_future_and_the_controller_goes_on() {
    let controller = TestController::<PluginController>::new();
    let ctx = controller.async_context();
    let result = controller.block_on(ctx.schedule(|_| -> i32 { panic!("boom") }));
    assert_eq!(result, Err(ScheduleError::Panicked("boom".into())));
    assert_eq!(controller.task(PluginController::increment), 1);
}

#[test]
fn an_unpolled_schedule_queues_nothing() {
    let controller = TestController::<PluginController>::new();
    let ran = Arc::new(AtomicBool::new(false));
    let flag = ran.clone();
    let future = controller
        .async_context()
        .schedule(move |_| flag.store(true, Ordering::SeqCst));
    assert_eq!(controller.run_until_idle(), 0);
    drop(future);
    assert_eq!(controller.run_until_idle(), 0);
    assert!(!ran.load(Ordering::SeqCst));
}

#[test]
fn a_queued_callback_whose_future_is_dropped_never_runs() {
    let controller = TestController::<PluginController>::new();
    let live = Arc::new(AtomicUsize::new(0));
    let captured = Tracked::new(&live);
    let mut future = controller.async_context().schedule(move |ctx| {
        let _keep = &captured;
        ctx.store.local.counter = 100;
    });
    assert!(poll_once(&mut future).is_pending());
    drop(future);
    // The callback, and what it captured, went with its future.
    assert_eq!(live.load(Ordering::SeqCst), 0);
    controller.run_until_idle();
    assert_eq!(controller.task(|ctx| ctx.store.local.counter), 0);
}

#[test]
fn a_running_callback_finishes_after_its_future_is_dropped_and_its_result_is_dropped() {
    let controller = TestController::<PluginController>::new();
    let live = Arc::new(AtomicUsize::new(0));
    let ctx = controller.async_context();
    let (polled, dropped) = (Arc::new(Barrier::new(2)), Arc::new(Barrier::new(2)));
    let result_live = live.clone();
    let callback_dropped = dropped.clone();
    let future = ctx.schedule(move |ctx| {
        // Its future is dropped on the other thread while it runs.
        callback_dropped.wait();
        ctx.store.local.counter = 7;
        Tracked::new(&result_live)
    });
    let poller = {
        let polled = polled.clone();
        std::thread::spawn(move || {
            let mut future = future;
            assert!(poll_once(&mut future).is_pending());
            polled.wait();
            // Wait until the callback runs, then drop the future meanwhile.
            std::thread::sleep(std::time::Duration::from_millis(20));
            drop(future);
            dropped.wait();
        })
    };
    polled.wait();
    assert_eq!(controller.run_until_idle(), 1);
    poller.join().unwrap();
    assert_eq!(controller.task(|ctx| ctx.store.local.counter), 7);
    // Its result had no one to go to: dropped.
    assert_eq!(live.load(Ordering::SeqCst), 0);
}

#[test]
fn cancellation_racing_execution_runs_each_callback_at_most_once_and_leaks_nothing() {
    let controller = TestController::<PluginController>::new();
    let live = Arc::new(AtomicUsize::new(0));
    let ran = Arc::new(AtomicUsize::new(0));
    let resolved = Arc::new(AtomicUsize::new(0));
    const ROUNDS: usize = 400;
    let threads: Vec<_> = (0..4)
        .map(|thread| {
            let ctx = controller.async_context();
            let (live, ran, resolved) = (live.clone(), ran.clone(), resolved.clone());
            std::thread::spawn(move || {
                for round in 0..ROUNDS {
                    let captured = Tracked::new(&live);
                    let ran = ran.clone();
                    let result_live = live.clone();
                    let mut future = ctx.schedule(move |_| {
                        let _keep = &captured;
                        ran.fetch_add(1, Ordering::SeqCst);
                        Tracked::new(&result_live)
                    });
                    if poll_once(&mut future).is_ready() {
                        panic!("ready at its first poll");
                    }
                    // Some are dropped at once, others after a while.
                    if (round + thread) % 3 != 0 {
                        std::thread::yield_now();
                    }
                    if let Poll::Ready(result) = poll_once(&mut future) {
                        drop(result.unwrap());
                        resolved.fetch_add(1, Ordering::SeqCst);
                    }
                    drop(future);
                }
            })
        })
        .collect();
    while threads.iter().any(|thread| !thread.is_finished()) {
        controller.run_until_idle();
    }
    for thread in threads {
        thread.join().unwrap();
    }
    controller.run_until_idle();
    let ran = ran.load(Ordering::SeqCst);
    assert!(ran <= 4 * ROUNDS);
    assert!(resolved.load(Ordering::SeqCst) <= ran);
    // Every callback, capture and result is gone, run or not.
    assert_eq!(live.load(Ordering::SeqCst), 0);
}

#[test]
fn shutting_down_cancels_queued_callbacks_and_drops_tasks() {
    let controller = TestController::<PluginController>::new();
    let live = Arc::new(AtomicUsize::new(0));
    *controller
        .async_context()
        .store
        .shared
        .waiting
        .lock()
        .unwrap() = Some(live.clone());
    controller
        .start("loadTable", &to_bytes(&u32::MAX), 1)
        .unwrap();
    let captured = Tracked::new(&live);
    let mut queued = controller.async_context().schedule(move |ctx| {
        let _keep = &captured;
        ctx.store.local.counter = 1;
    });
    assert!(poll_once(&mut queued).is_pending());
    while live.load(Ordering::SeqCst) < 2 {
        std::thread::yield_now();
    }
    controller.shutdown();
    assert_eq!(
        poll_once(&mut queued),
        Poll::Ready(Err(ScheduleError::ShutDown))
    );
    // The waiting task's future, and the callback's capture, were dropped.
    assert_eq!(live.load(Ordering::SeqCst), 0);
    let late = controller.async_context();
    let mut after = pin!(late.schedule(|_| ()));
    let waker = noop_waker();
    assert_eq!(
        after.as_mut().poll(&mut Context::from_waker(&waker)),
        Poll::Ready(Err(ScheduleError::ShutDown))
    );
    assert!(controller.call("increment", &[]).is_err());
}

#[test]
fn a_cancelled_operation_never_completes() {
    let controller = TestController::<PluginController>::new();
    let live = Arc::new(AtomicUsize::new(0));
    *controller
        .async_context()
        .store
        .shared
        .waiting
        .lock()
        .unwrap() = Some(live.clone());
    controller
        .start("loadTable", &to_bytes(&u32::MAX), 5)
        .unwrap();
    while live.load(Ordering::SeqCst) == 0 {
        std::thread::yield_now();
    }
    controller.cancel(5);
    while live.load(Ordering::SeqCst) != 0 {
        std::thread::yield_now();
    }
    // A finished one cancelled before its completion was taken: dropped too.
    controller.start("incrementLater", &[], 6).unwrap();
    controller.block_on(async {
        // Let it finish on the worker.
        soundor::unblock(|| std::thread::sleep(std::time::Duration::from_millis(30))).await
    });
    controller.cancel(6);
    controller.run_until_idle();
    controller.start("incrementLater", &[], 7).unwrap();
    assert!(controller.wait(7).is_ok());
}

#[test]
fn a_reentrant_call_is_refused() {
    let controller = TestController::<PluginController>::new();
    let nested = controller.task(|_| controller.call("increment", &[]));
    assert!(
        nested.unwrap_err().contains("again"),
        "reentrancy must be refused"
    );
}

#[test]
fn the_control_queue_runs_one_callback_at_a_time_in_order() {
    let controller = TestController::<PluginController>::new();
    let ctx = controller.async_context();
    let order = Arc::new(Mutex::new(Vec::new()));
    let mut futures: Vec<_> = (0..3)
        .map(|index| {
            let order = order.clone();
            ctx.schedule(move |_| order.lock().unwrap().push(index))
        })
        .collect();
    for future in &mut futures {
        assert!(poll_once(future).is_pending());
    }
    assert_eq!(controller.run_until_idle(), 3);
    assert_eq!(*order.lock().unwrap(), [0, 1, 2]);
}

#[test]
fn the_exported_abi_describes_the_controller() {
    let exports = __soundor_controller_exports::exports();
    let mut info = soundor::ffi::controller::SoundorControllerInfo::default();
    // SAFETY: a valid structure.
    assert_eq!(unsafe { (exports.info)(&mut info) }, 0);
    assert_eq!(info.present, 1);
    assert_eq!(info.abi_version, soundor::CONTROLLER_ABI_VERSION);
    assert_eq!(info.method_count, 8);
    // SAFETY: the descriptor is static.
    let descriptor = unsafe { std::slice::from_raw_parts(info.descriptor, info.descriptor_size) };
    assert_eq!(&descriptor[..4], b"SNDC");
}
