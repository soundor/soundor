//! The controller, tested in plain Rust, as the runtime runs it:
//! `cargo test --manifest-path native/Cargo.toml`.

use soundor::prelude::*;
use soundor::testing::{TestController, TestProcessor};
use soundor::types::Shape;
use soundor::wire::{Reader, Wire};
use soundor_controller::{PluginController, PluginProcessor, within};
use std::time::Duration;

fn decode<T: Wire>(bytes: Vec<u8>) -> T {
    let mut reader = Reader::new(&bytes);
    T::decode(&mut reader).unwrap()
}

#[test]
fn clicks_are_kept_between_calls_and_counted_later_too() {
    let controller = TestController::<PluginController>::new();
    assert_eq!(controller.task(PluginController::click), 1);
    assert_eq!(controller.task(PluginController::click), 2);
    let later = PluginController::click_later(controller.async_context());
    assert_eq!(controller.block_on(later).unwrap(), 3);
    assert_eq!(controller.task(PluginController::stats).clicks, 3);
    // Another plugin instance has stores of its own.
    let other = TestController::<PluginController>::new();
    assert_eq!(other.task(PluginController::click), 1);
}

#[test]
fn a_loaded_table_reaches_the_processor_and_the_state() {
    let mut processor = TestProcessor::<PluginProcessor>::new()
        .sample_rate(48_000.0)
        .parameter("rate", 1_000.0)
        .build();
    let controller = TestController::<PluginController>::for_processor(&processor);
    let mut args = Vec::new();
    Shape::Square.encode(&mut args);
    4096u32.encode(&mut args);
    // As the runtime calls it: started on the worker, completed on the
    // control thread.
    let size: u32 = decode(controller.call_async("loadTable", &args).unwrap());
    assert_eq!(size, 4096);
    assert_eq!(controller.host().state_json("shape"), r#""square""#);
    let stats = controller.task(PluginController::stats);
    assert_eq!((stats.loads, stats.last_shape), (1, Some(Shape::Square)));
    // The square from the next block: full scale, then its opposite.
    let output = processor.process(&[vec![1.0; 48], vec![1.0; 48]]);
    assert_eq!(output[0][0], 1.0);
    assert_eq!(output[0][30], -1.0);
    // Clamped to what a wavetable may hold.
    let mut args = Vec::new();
    Shape::Saw.encode(&mut args);
    1u32.encode(&mut args);
    assert_eq!(
        decode::<u32>(controller.call_async("loadTable", &args).unwrap()),
        16
    );
}

#[test]
fn an_update_that_waits_too_long_is_cancelled_and_never_runs() {
    let controller = TestController::<PluginController>::new();
    let ctx = controller.async_context();
    // Nobody runs the control queue here: the deadline passes first, and the
    // queued update is dropped.
    let update = within(
        Duration::from_millis(20),
        ctx.schedule(|ctx| ctx.state.shape.set(Shape::Saw)),
    );
    let finished = futures_lite_block_on(update);
    assert!(finished.is_none());
    assert_eq!(controller.run_until_idle(), 0);
    assert_eq!(controller.host().state_json("shape"), r#""sine""#);
    // Run in time, it is.
    assert_eq!(controller.task(PluginController::click), 1);
    let ran = controller.block_on(within(
        Duration::from_secs(5),
        ctx.schedule(|ctx| ctx.state.shape.set(Shape::Saw)),
    ));
    assert!(ran.is_some());
    assert_eq!(controller.host().state_json("shape"), r#""saw""#);
}

/// Polls `future` on this thread, without running the control queue.
fn futures_lite_block_on<F: std::future::Future>(future: F) -> F::Output {
    use std::task::{Context, Poll, Wake, Waker};
    struct Unpark(std::thread::Thread);
    impl Wake for Unpark {
        fn wake(self: std::sync::Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = Waker::from(std::sync::Arc::new(Unpark(std::thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
        std::thread::park_timeout(Duration::from_millis(5));
    }
}
