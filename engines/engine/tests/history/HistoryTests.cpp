#include <soundor/history/StateHistory.h>

#include <doctest/doctest.h>

namespace
{
    using namespace soundor::history;
    struct Number final : Field
    {
        double value = 0;
        bool fail = false;
        int installed = 0;
        int notified = 0;
        explicit Number(std::string name)
        {
            id = std::move(name);
            label = id;
        }
        [[nodiscard]] Value read() const override { return value; }
        std::unique_ptr<Prepared> prepare(const Value& input) override
        {
            if (fail)
                throw std::runtime_error("prepare failed");
            struct Write final : Prepared
            {
                Number& field;
                double next;
                Write(Number& target, double value) : field(target), next(value) {}
                void install() noexcept override
                {
                    field.value = next;
                    ++field.installed;
                }
                void notify() noexcept override { ++field.notified; }
            };
            return std::make_unique<Write>(*this, std::get<double>(input));
        }
    };
} // namespace
TEST_CASE("History prepares every write before installing and preserves stacks after failed replay")
{
    StateHistory history;
    Number a("a"), b("b");
    history.registerField(a);
    history.registerField(b);
    b.fail = true;
    CHECK_THROWS(history.transaction("Fail",
                                     [&]
                                     {
                                         history.edit(a.id, []() -> Value { return 1.0; });
                                         history.edit(b.id, []() -> Value { return 2.0; });
                                         CHECK(std::get<double>(history.read(a.id)) == 1);
                                         CHECK(a.value == 0);
                                         CHECK(a.notified == 0);
                                     }));
    CHECK(a.installed == 0);
    CHECK(! history.canUndo());
    b.fail = false;
    history.transaction("Commit",
                        [&]
                        {
                            history.edit(a.id, []() -> Value { return 1.0; });
                            history.edit(b.id, []() -> Value { return 2.0; });
                        });
    CHECK(a.value == 1);
    CHECK(b.value == 2);
    b.fail = true;
    CHECK_THROWS(history.undo());
    CHECK(a.value == 1);
    CHECK(b.value == 2);
    CHECK(history.canUndo());
    CHECK(! history.canRedo());
    b.fail = false;
    history.undo();
    CHECK(a.value == 0);
    CHECK(b.value == 0);
    history.redo();
    CHECK(a.value == 1);
    CHECK(b.value == 2);
}
TEST_CASE("History retains first poisoned failure and ignores handled application errors")
{
    StateHistory history;
    Number a("a");
    history.registerField(a);
    CHECK_THROWS_AS(history.transaction("Outer",
                                        [&]
                                        {
                                            try
                                            {
                                                history.transaction("Inner", [] { throw std::runtime_error("first"); });
                                            }
                                            catch (const std::runtime_error& error)
                                            {
                                                CHECK(std::string(error.what()) == "first");
                                            }
                                            history.edit(a.id, []() -> Value { return 4.0; });
                                        }),
                    TransactionAbortedError);
    CHECK(a.value == 0);
    CHECK(! history.canUndo());
    history.transaction("Handled",
                        [&]
                        {
                            try
                            {
                                throw std::runtime_error("application");
                            }
                            catch (const std::runtime_error& error)
                            {
                                CHECK(std::string(error.what()) == "application");
                            }
                            history.edit(a.id, []() -> Value { return 2.0; });
                        });
    CHECK(a.value == 2);
    CHECK(history.canUndo());
}
TEST_CASE("History eviction and subscriptions distinguish entries from no-ops")
{
    StateHistory history(2);
    Number a("a");
    history.registerField(a);
    int events = 0;
    auto off = history.subscribe([&](const Status&) { ++events; });
    for (int n = 1; n <= 3; ++n)
        history.edit(a.id, [n]() -> Value { return static_cast<double>(n); }, Options(true));
    CHECK(events == 3);
    history.edit(a.id, []() -> Value { return 3.0; }, Options(true));
    CHECK(events == 3);
    history.undo();
    history.undo();
    CHECK(a.value == 1);
    CHECK(! history.canUndo());
    off();
    history.clear();
    CHECK(events == 5);
    StateHistory small(100, 1);
    Number b("b");
    small.registerField(b);
    small.edit(b.id, []() -> Value { return 1.0; }, Options(true));
    CHECK(! small.canUndo());
}
