#pragma once

#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>

#include <chrono>
#include <functional>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace soundor::test
{
    // A RuntimeHost with the Web platform installed and its log captured.
    struct WebFixture
    {
        explicit WebFixture(RuntimeHost::Options options = {}) : host(withLog(std::move(options))) {}

        // Evaluates `body` as a module and returns globalThis.result.
        js::Value run(const std::string& body)
        {
            auto evaluated = host.context().evaluateModule(body, "/t" + std::to_string(++counter) + ".js");
            REQUIRE_MESSAGE(evaluated.ok(), (evaluated.ok() ? "" : evaluated.error().toString()));
            return eval("globalThis.result");
        }

        std::string error(const std::string& body)
        {
            auto evaluated = host.context().evaluateModule(body, "/t" + std::to_string(++counter) + ".js");
            REQUIRE_FALSE(evaluated.ok());
            return evaluated.error().toString();
        }

        js::Value eval(const std::string& expression)
        {
            auto value = host.context().evaluateScript(expression);
            REQUIRE_MESSAGE(value.ok(), (value.ok() ? "" : value.error().toString()));
            return value.value();
        }

        // Ticks (like a plugin view's frame timer) until `expression` is true.
        bool tickUntil(const std::string& expression, std::chrono::milliseconds timeout = std::chrono::seconds(5))
        {
            const auto deadline = std::chrono::steady_clock::now() + timeout;
            while (std::chrono::steady_clock::now() < deadline)
            {
                host.tick();
                if (eval(expression).asBoolean())
                    return true;
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
            return false;
        }

        void tickFor(std::chrono::milliseconds duration)
        {
            const auto end = std::chrono::steady_clock::now() + duration;
            while (std::chrono::steady_clock::now() < end)
            {
                host.tick();
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
        }

        std::vector<std::pair<js::LogLevel, std::string>> logs;
        RuntimeHost host;
        int counter = 0;

    private:
        RuntimeHost::Options withLog(RuntimeHost::Options options)
        {
            options.runtime.log = [this](js::LogLevel level, std::string_view message)
            { logs.emplace_back(level, std::string(message)); };
            return options;
        }
    };
} // namespace soundor::test
