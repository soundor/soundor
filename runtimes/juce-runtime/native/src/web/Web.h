#pragma once

// Private to soundor_runtime: the Web platform layer (Web-compatible globals)
// and the soundor:host/storage/fs modules. RuntimeHost installs and ticks it.

#include "web/WebState.h"

#include <soundor/js/Context.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    // Installs the globals and modules into a fresh `context`.
    void install(js::Context& context, Services services);

    // On the UI thread, every frame: settles finished asynchronous operations,
    // runs due timers, and delivers host changes. Does not run promise jobs.
    void tick(js::Context& context);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
