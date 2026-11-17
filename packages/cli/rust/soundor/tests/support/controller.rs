//! A real controller of the SDK fixture contract, shared by ABI tests.
use soundor::prelude::*;
use soundor::types::{Analysis, Curve};

#[derive(Default)]
pub struct LocalStore {
    pub counter: i32,
    pub midi: Vec<MidiEvent>,
    pub midi_resets: usize,
    pub midi_thread: Option<std::thread::ThreadId>,
}
pub struct PluginController;
impl Controller for PluginController {
    const MIDI_INPUT: bool = true;
    fn midi(ctx: &mut TaskContext<Self>, batch: soundor::midi::MidiBatch) {
        ctx.store.local.midi_thread = Some(std::thread::current().id());
        if batch.reset {
            ctx.store.local.midi.clear();
            ctx.store.local.midi_resets += 1;
        }
        ctx.store.local.midi.extend(batch.events);
    }
    type Local = LocalStore;
    type Shared = std::sync::atomic::AtomicU32;
}
impl NativeMethods for PluginController {
    fn analyze(_: &mut TaskContext<Self>, samples: Vec<f32>) -> Analysis {
        Analysis {
            peak: samples.iter().fold(0.0f32, |a, b| a.max(b.abs())),
            points: Vec::new(),
            label: None,
        }
    }
    fn describe(ctx: &mut TaskContext<Self>, gain: f32, id: u64, tags: Vec<String>) -> String {
        ctx.params.gain.set(gain);
        ctx.state.tags.set(tags.clone());
        format!("{id}: {} [{}]", ctx.params.gain.get(), tags.join(","))
    }
    async fn fail(_: AsyncTaskContext<Self>, message: String) -> Result<(), Error> {
        Err(Error::new(message))
    }
    fn increment(ctx: &mut TaskContext<Self>) -> i32 {
        ctx.store.local.counter += 1;
        ctx.store.local.counter
    }
    async fn increment_later(ctx: AsyncTaskContext<Self>) -> Result<i32, Error> {
        ctx.store
            .shared
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(ctx.schedule(Self::increment).await?)
    }
    async fn load_table(ctx: AsyncTaskContext<Self>, length: u32) -> Result<Vec<f32>, Error> {
        if length == u32::MAX {
            std::future::pending::<()>().await;
        }
        let values: Vec<_> = (0..length).map(|i| i as f32).collect();
        ctx.processor.resources().wavetable.publish(values.clone());
        ctx.schedule(move |ctx| {
            ctx.state
                .selected_preset
                .set(Some(format!("table {length}")))
        })
        .await?;
        Ok(values)
    }
    fn pick(_: &mut TaskContext<Self>, curve: Option<Curve>) -> Curve {
        curve.unwrap_or(Curve::EaseIn)
    }
    fn reset(ctx: &mut TaskContext<Self>) {
        if ctx.history.can_undo() {
            assert!(ctx.history.undo());
            assert!(ctx.history.can_redo());
            assert!(ctx.history.redo());
        }
        assert_eq!(ctx.presets.ids(), &["warm"]);
        ctx.presets.load("warm").unwrap();
        ctx.store.local.counter = 0;
        ctx.params.gain.set(0.5);
        ctx.state.selected_preset.set(Some("Default".into()));
    }
}
