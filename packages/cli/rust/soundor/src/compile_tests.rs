//! What the compiler refuses, against the SDK fixture's native methods:
//! each `compile_fail` example differs from the one that compiles by the
//! one mistake it names.
//!
//! The contract, complete:
//!
//! ```no_run
//! use soundor::prelude::*;
//! use soundor::types::{Analysis, Curve};
//!
//! struct PluginController;
//! impl Controller for PluginController {
//!     // A local store need not be thread-safe.
//!     type Local = std::rc::Rc<()>;
//!     type Shared = std::sync::atomic::AtomicU64;
//! }
//! impl NativeMethods for PluginController {
//!     fn analyze(_: &mut TaskContext<Self>, _: Vec<f32>) -> Analysis { todo!() }
//!     fn describe(_: &mut TaskContext<Self>, _: f32, _: u64, _: Vec<String>) -> String { todo!() }
//!     async fn fail(_: AsyncTaskContext<Self>, _: String) -> Result<(), Error> { todo!() }
//!     fn increment(_: &mut TaskContext<Self>) -> i32 { todo!() }
//!     async fn increment_later(_: AsyncTaskContext<Self>) -> Result<i32, Error> { todo!() }
//!     async fn load_table(_: AsyncTaskContext<Self>, _: u32) -> Result<Vec<f32>, Error> { todo!() }
//!     fn pick(_: &mut TaskContext<Self>, _: Option<Curve>) -> Curve { todo!() }
//!     fn reset(_: &mut TaskContext<Self>) {}
//! }
//! ```
//!
//! A method the config declares, missing:
//!
//! ```compile_fail
//! use soundor::prelude::*;
//! use soundor::types::{Analysis, Curve};
//!
//! struct PluginController;
//! impl Controller for PluginController {
//!     type Local = ();
//!     type Shared = ();
//! }
//! impl NativeMethods for PluginController {
//!     fn analyze(_: &mut TaskContext<Self>, _: Vec<f32>) -> Analysis { todo!() }
//!     fn describe(_: &mut TaskContext<Self>, _: f32, _: u64, _: Vec<String>) -> String { todo!() }
//!     async fn fail(_: AsyncTaskContext<Self>, _: String) -> Result<(), Error> { todo!() }
//!     async fn increment_later(_: AsyncTaskContext<Self>) -> Result<i32, Error> { todo!() }
//!     async fn load_table(_: AsyncTaskContext<Self>, _: u32) -> Result<Vec<f32>, Error> { todo!() }
//!     fn pick(_: &mut TaskContext<Self>, _: Option<Curve>) -> Curve { todo!() }
//!     fn reset(_: &mut TaskContext<Self>) {}
//! }
//! ```
//!
//! An argument of another type (`samples` is a `buffer<float32>`):
//!
//! ```compile_fail
//! use soundor::prelude::*;
//! use soundor::types::{Analysis, Curve};
//!
//! struct PluginController;
//! impl Controller for PluginController {
//!     type Local = ();
//!     type Shared = ();
//! }
//! impl NativeMethods for PluginController {
//!     fn analyze(_: &mut TaskContext<Self>, _: Vec<f64>) -> Analysis { todo!() }
//!     fn describe(_: &mut TaskContext<Self>, _: f32, _: u64, _: Vec<String>) -> String { todo!() }
//!     async fn fail(_: AsyncTaskContext<Self>, _: String) -> Result<(), Error> { todo!() }
//!     fn increment(_: &mut TaskContext<Self>) -> i32 { todo!() }
//!     async fn increment_later(_: AsyncTaskContext<Self>) -> Result<i32, Error> { todo!() }
//!     async fn load_table(_: AsyncTaskContext<Self>, _: u32) -> Result<Vec<f32>, Error> { todo!() }
//!     fn pick(_: &mut TaskContext<Self>, _: Option<Curve>) -> Curve { todo!() }
//!     fn reset(_: &mut TaskContext<Self>) {}
//! }
//! ```
//!
//! A result of another type (`increment` returns an `int32`):
//!
//! ```compile_fail
//! use soundor::prelude::*;
//! use soundor::types::{Analysis, Curve};
//!
//! struct PluginController;
//! impl Controller for PluginController {
//!     type Local = ();
//!     type Shared = ();
//! }
//! impl NativeMethods for PluginController {
//!     fn analyze(_: &mut TaskContext<Self>, _: Vec<f32>) -> Analysis { todo!() }
//!     fn describe(_: &mut TaskContext<Self>, _: f32, _: u64, _: Vec<String>) -> String { todo!() }
//!     async fn fail(_: AsyncTaskContext<Self>, _: String) -> Result<(), Error> { todo!() }
//!     fn increment(_: &mut TaskContext<Self>) -> i64 { todo!() }
//!     async fn increment_later(_: AsyncTaskContext<Self>) -> Result<i32, Error> { todo!() }
//!     async fn load_table(_: AsyncTaskContext<Self>, _: u32) -> Result<Vec<f32>, Error> { todo!() }
//!     fn pick(_: &mut TaskContext<Self>, _: Option<Curve>) -> Curve { todo!() }
//!     fn reset(_: &mut TaskContext<Self>) {}
//! }
//! ```
//!
//! A synchronous method written as an async one (`increment` is not
//! `async: true`):
//!
//! ```compile_fail
//! use soundor::prelude::*;
//! use soundor::types::{Analysis, Curve};
//!
//! struct PluginController;
//! impl Controller for PluginController {
//!     type Local = ();
//!     type Shared = ();
//! }
//! impl NativeMethods for PluginController {
//!     fn analyze(_: &mut TaskContext<Self>, _: Vec<f32>) -> Analysis { todo!() }
//!     fn describe(_: &mut TaskContext<Self>, _: f32, _: u64, _: Vec<String>) -> String { todo!() }
//!     async fn fail(_: AsyncTaskContext<Self>, _: String) -> Result<(), Error> { todo!() }
//!     async fn increment(_: AsyncTaskContext<Self>) -> Result<i32, Error> { todo!() }
//!     async fn increment_later(_: AsyncTaskContext<Self>) -> Result<i32, Error> { todo!() }
//!     async fn load_table(_: AsyncTaskContext<Self>, _: u32) -> Result<Vec<f32>, Error> { todo!() }
//!     fn pick(_: &mut TaskContext<Self>, _: Option<Curve>) -> Curve { todo!() }
//!     fn reset(_: &mut TaskContext<Self>) {}
//! }
//! ```
//!
//! An async method written as a synchronous one (`incrementLater` is
//! `async: true`):
//!
//! ```compile_fail
//! use soundor::prelude::*;
//! use soundor::types::{Analysis, Curve};
//!
//! struct PluginController;
//! impl Controller for PluginController {
//!     type Local = ();
//!     type Shared = ();
//! }
//! impl NativeMethods for PluginController {
//!     fn analyze(_: &mut TaskContext<Self>, _: Vec<f32>) -> Analysis { todo!() }
//!     fn describe(_: &mut TaskContext<Self>, _: f32, _: u64, _: Vec<String>) -> String { todo!() }
//!     async fn fail(_: AsyncTaskContext<Self>, _: String) -> Result<(), Error> { todo!() }
//!     fn increment(_: &mut TaskContext<Self>) -> i32 { todo!() }
//!     fn increment_later(_: &mut TaskContext<Self>) -> i32 { todo!() }
//!     async fn load_table(_: AsyncTaskContext<Self>, _: u32) -> Result<Vec<f32>, Error> { todo!() }
//!     fn pick(_: &mut TaskContext<Self>, _: Option<Curve>) -> Curve { todo!() }
//!     fn reset(_: &mut TaskContext<Self>) {}
//! }
//! ```
//!
//! An async method whose future is not `Send` (it holds an `Rc` across an
//! `.await`), which the worker could not poll:
//!
//! ```compile_fail
//! use soundor::prelude::*;
//! use soundor::types::{Analysis, Curve};
//!
//! struct PluginController;
//! impl Controller for PluginController {
//!     type Local = ();
//!     type Shared = ();
//! }
//! impl NativeMethods for PluginController {
//!     fn analyze(_: &mut TaskContext<Self>, _: Vec<f32>) -> Analysis { todo!() }
//!     fn describe(_: &mut TaskContext<Self>, _: f32, _: u64, _: Vec<String>) -> String { todo!() }
//!     async fn fail(_: AsyncTaskContext<Self>, _: String) -> Result<(), Error> { todo!() }
//!     fn increment(_: &mut TaskContext<Self>) -> i32 { todo!() }
//!     async fn increment_later(ctx: AsyncTaskContext<Self>) -> Result<i32, Error> {
//!         let held = std::rc::Rc::new(1);
//!         ctx.schedule(|_| ()).await?;
//!         Ok(*held)
//!     }
//!     async fn load_table(_: AsyncTaskContext<Self>, _: u32) -> Result<Vec<f32>, Error> { todo!() }
//!     fn pick(_: &mut TaskContext<Self>, _: Option<Curve>) -> Curve { todo!() }
//!     fn reset(_: &mut TaskContext<Self>) {}
//! }
//! ```
//!
//! A shared store that is not `Sync`:
//!
//! ```compile_fail
//! use soundor::prelude::*;
//!
//! struct PluginController;
//! impl Controller for PluginController {
//!     type Local = ();
//!     type Shared = std::cell::Cell<u32>;
//! }
//! ```
//!
//! A `TaskContext` returned out of its scheduled callback, to keep across an
//! `.await` or on the worker:
//!
//! ```compile_fail
//! use soundor::prelude::*;
//!
//! async fn keep<C: Controller>(ctx: AsyncTaskContext<C>) {
//!     let escaped = ctx.schedule(|task| task).await;
//! }
//! ```
//!
//! The local store taken out of its callback:
//!
//! ```compile_fail
//! use soundor::prelude::*;
//!
//! async fn keep<C: Controller>(ctx: AsyncTaskContext<C>) {
//!     let local = ctx.schedule(|task| task.store.local).await;
//! }
//! ```
//!
//! The local store, from an async task, is not there:
//!
//! ```compile_fail
//! use soundor::prelude::*;
//!
//! fn reach<C: Controller>(ctx: AsyncTaskContext<C>) {
//!     let _ = &ctx.store.local;
//! }
//! ```
//!
//! A processor-only plugin (`soundor::export!(PluginProcessor)`) needs no
//! controller, and a controller of a config without native methods no
//! `impl NativeMethods`: the generated trait then has a blanket
//! implementation (`soundor.config`-specific; see the CLI's codegen tests).
