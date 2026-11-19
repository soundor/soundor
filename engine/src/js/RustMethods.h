#pragma once

#include <soundor/Abi.h>

// Private to Soundor: `soundor:native`'s methods backed by a plugin's Rust
// controller (processor::RustController), for the generated
// installController(). One generic binding per method the controller's
// contract describes: JavaScript values are checked and converted as the
// generated C++ bindings convert them (same rules, same error messages),
// into the controller's value encoding and back.
//
// - A synchronous method runs inside the JavaScript call.
// - An async one returns a promise; the controller's worker runs it, and its
//   completion settles the promise from RustController::pump(), followed by
//   a microtask checkpoint of the context.
// - A context's operations are cancelled when it goes (an editor closed or
//   reloaded): their completions never reach it.

#include "Internal.h"

#include <soundor/processor/RustController.h>

#include <memory>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
{
    // Connects `context` to `controller`, under `key`. Call before the module's
    // initializer runs (in install()).
    void setRustController(Context& context, const void* key, std::shared_ptr<processor::RustController> controller);

    // Connects the controller's event source before evaluating the UI bundle.
    void connectRustEvents(Context& context, std::shared_ptr<processor::RustController> controller);

    // In the module's initializer: the event subscriptions for that source.
    void installRustEvents(detail::ContextState& context, jsi::Object& exports);

    // In the module's initializer: one function per method of the
    // controller's contract on `exports`.
    void installRustMethods(detail::ContextState& context, jsi::Object& exports, const void* key);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
