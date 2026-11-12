#pragma once
#include <soundor/history/StateHistory.h>
#include <soundor/js/Context.h>
namespace soundor::inline SOUNDOR_ABI_NAMESPACE::history
{
    void install(js::Context&, StateHistory&);
    void dispatch(js::Context&);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::history
