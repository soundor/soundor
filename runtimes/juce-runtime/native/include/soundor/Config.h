#pragma once

// Every Soundor-native C++ symbol lives in `soundor::SOUNDOR_ABI_NAMESPACE`, an
// inline namespace: source code writes `soundor::js::Context`, but the mangled
// name carries the ABI namespace. A plugin build derives it from the plugin's
// stable identifier, so independently built Soundor plugins loaded into one host
// process never share a C++ symbol. The build system defines it for every
// consumer of soundor::runtime; the fallback only serves tooling that parses a
// header in isolation.
#ifndef SOUNDOR_ABI_NAMESPACE
    #define SOUNDOR_ABI_NAMESPACE v0
#endif
