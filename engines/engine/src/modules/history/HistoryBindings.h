#pragma once
#include "js/Bindings.h"

#include <soundor/history/StateHistory.h>
namespace soundor::inline SOUNDOR_ABI_NAMESPACE::history
{
    inline Options readOptions(js::bind::ContextState& ctx, const jsi::Value* args, std::size_t count, std::size_t at)
    {
        namespace bind = js::bind;
        if (count <= at || args[at].isUndefined())
            return {};
        if (! args[at].isObject())
            bind::throwTypeError(ctx, "expected History options");
        const auto object = args[at].getObject(ctx.rt);
        const auto names = object.getPropertyNames(ctx.rt);
        for (std::size_t i = 0; i < names.size(ctx.rt); ++i)
            if (names.getValueAtIndex(ctx.rt, i).getString(ctx.rt).utf8(ctx.rt) != "history")
                bind::throwTypeError(ctx, "unknown History option");
        const auto value = object.getProperty(ctx.rt, "history");
        if (value.isUndefined())
            return {};
        if (value.isBool())
            return Options(value.getBool());
        if (value.isObject())
        {
            const auto record = value.getObject(ctx.rt);
            const auto label = record.getProperty(ctx.rt, "label");
            if (record.getPropertyNames(ctx.rt).size(ctx.rt) == 1 && label.isString())
            {
                const auto text = label.getString(ctx.rt).utf8(ctx.rt);
                if (! text.empty())
                    return Options(text);
            }
        }
        bind::throwTypeError(ctx, "history must be boolean or { label: string }");
    }
    template <class Callback>
    jsi::Value invoke(js::bind::ContextState& ctx, StateHistory& manager, Callback&& callback)
    {
        try
        {
            return manager.guard(std::forward<Callback>(callback));
        }
        catch (const TransactionAbortedError& error)
        {
            auto value = js::bind::makeError(ctx, error.what());
            auto object = value.getObject(ctx.rt);
            object.setProperty(ctx.rt, "name", jsi::String::createFromAscii(ctx.rt, "TransactionAbortedError"));
            object.setProperty(ctx.rt, "code", jsi::String::createFromAscii(ctx.rt, "TRANSACTION_ABORTED"));
            object.setProperty(ctx.rt, "issues", jsi::Array(ctx.rt, 0));
            auto symbol = ctx.rt.global()
                              .getPropertyAsObject(ctx.rt, "Symbol")
                              .getPropertyAsFunction(ctx.rt, "for")
                              .call(ctx.rt, jsi::String::createFromAscii(ctx.rt, "soundor.error.v1"));
            object.setProperty(ctx.rt, jsi::PropNameID::forSymbol(ctx.rt, symbol.getSymbol(ctx.rt)), true);
            try
            {
                if (error.cause)
                    std::rethrow_exception(error.cause);
            }
            catch (const jsi::JSError& cause)
            {
                object.setProperty(ctx.rt, "cause", jsi::Value(ctx.rt, cause.value()));
            }
            catch (const std::exception& cause)
            {
                object.setProperty(ctx.rt, "cause", js::bind::makeError(ctx, cause.what()));
            }
            catch (...)
            {
                object.setProperty(ctx.rt, "cause", js::bind::makeError(ctx, "native transaction failure"));
            }
            throw jsi::JSError(ctx.rt, std::move(value));
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::history
