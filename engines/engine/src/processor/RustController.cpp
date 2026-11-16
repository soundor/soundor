#include <soundor/processor/RustController.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <exception>
#include <limits>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::processor
{
    namespace
    {
        constexpr std::uint32_t descriptorVersion = 1;

        // Reads a descriptor; any malformation fails the whole parse.
        class DescriptorReader
        {
        public:
            explicit DescriptorReader(std::span<const std::uint8_t> input) : bytes(input) {}

            bool u8(std::uint8_t& out)
            {
                if (at >= bytes.size())
                    return false;
                out = bytes[at++];
                return true;
            }

            bool u32(std::uint32_t& out)
            {
                if (bytes.size() - at < 4)
                    return false;
                out = 0;
                for (int shift = 0; shift < 32; shift += 8)
                    out |= static_cast<std::uint32_t>(bytes[at++]) << shift;
                return true;
            }

            bool string(std::string& out)
            {
                std::uint32_t length = 0;
                if (! u32(length) || bytes.size() - at < length)
                    return false;
                out.assign(reinterpret_cast<const char*>(bytes.data() + at), length);
                at += length;
                return true;
            }

            // A count of things each at least `size` bytes long.
            bool count(std::uint32_t& out, std::size_t size = 1)
            {
                return u32(out) && static_cast<std::size_t>(out) * size <= bytes.size() - at;
            }

            [[nodiscard]] bool done() const noexcept { return at == bytes.size(); }

        private:
            std::span<const std::uint8_t> bytes;
            std::size_t at = 0;
        };

        using Tag = ControllerContract::Tag;

        bool numeric(Tag tag) noexcept
        {
            return tag >= Tag::Int8 && tag <= Tag::Float64;
        }

        bool readType(DescriptorReader& reader, ControllerContract& contract, std::uint32_t& node, int depth)
        {
            std::uint8_t tag = 0;
            if (depth > 32 || ! reader.u8(tag) || tag > static_cast<std::uint8_t>(Tag::Nullable))
                return false;
            ControllerContract::Type type;
            type.tag = static_cast<Tag>(tag);
            switch (type.tag)
            {
                case Tag::Declared:
                    if (! reader.u32(type.index))
                        return false;
                    break;
                case Tag::Array:
                case Tag::Nullable:
                    if (! readType(reader, contract, type.index, depth + 1))
                        return false;
                    break;
                case Tag::Buffer:
                {
                    std::uint8_t element = 0;
                    if (! reader.u8(element) || ! numeric(static_cast<Tag>(element)))
                        return false;
                    type.element = static_cast<Tag>(element);
                    break;
                }
                default:
                    break;
            }
            node = static_cast<std::uint32_t>(contract.nodes.size());
            contract.nodes.push_back(type);
            return true;
        }

        bool readFields(DescriptorReader& reader, ControllerContract& contract,
                        std::vector<ControllerContract::Field>& fields)
        {
            std::uint32_t count = 0;
            if (! reader.count(count, 5))
                return false;
            fields.resize(count);
            for (auto& field : fields)
                if (! reader.string(field.name) || ! readType(reader, contract, field.type, 0))
                    return false;
            return true;
        }

        // A declared node refers to a type there is.
        bool resolved(const ControllerContract& contract)
        {
            return std::ranges::all_of(contract.nodes, [&](const ControllerContract::Type& type)
                                       { return type.tag != Tag::Declared || type.index < contract.types.size(); });
        }

        // ── Host callbacks: the services, behind the C ABI ─────────────────────

        ControllerServices& servicesOf(void* user) noexcept
        {
            return *static_cast<ControllerServices*>(user);
        }

        void send(SoundorWriter writer, std::string_view text) noexcept
        {
            if (writer.write != nullptr)
                writer.write(writer.user, reinterpret_cast<const std::uint8_t*>(text.data()), text.size());
        }

        void failure(SoundorWriter writer) noexcept
        {
            try
            {
                throw;
            }
            catch (const std::exception& error)
            {
                send(writer, error.what());
            }
            catch (...)
            {
                send(writer, "unknown native exception");
            }
        }

        void hostWake(void* user)
        {
            servicesOf(user).wake();
        }

        double hostParameterGet(void* user, std::uint32_t index)
        {
            try
            {
                return servicesOf(user).parameter(index);
            }
            catch (...)
            {
                return std::numeric_limits<double>::quiet_NaN();
            }
        }

        std::int32_t hostParameterSet(void* user, std::uint32_t index, double plain)
        {
            try
            {
                servicesOf(user).setParameter(index, plain);
                return 0;
            }
            catch (...)
            {
                return 1;
            }
        }

        std::int32_t hostStateGet(void* user, std::uint32_t index, SoundorWriter out)
        {
            try
            {
                const std::string json = servicesOf(user).state(index);
                send(out, json);
                return 0;
            }
            catch (...)
            {
                failure(out);
                return 1;
            }
        }

        std::int32_t hostStateSet(void* user, std::uint32_t index, const std::uint8_t* json, std::size_t length,
                                  SoundorWriter error)
        {
            try
            {
                servicesOf(user).setState(index, std::string_view(reinterpret_cast<const char*>(json), length));
                return 0;
            }
            catch (...)
            {
                failure(error);
                return 1;
            }
        }

        std::int32_t hostHistory(void* user, std::uint32_t action)
        {
            using Action = ControllerServices::HistoryAction;
            if (action > SOUNDOR_HISTORY_CAN_REDO)
                return -1;
            const auto which = static_cast<Action>(action);
            try
            {
                const bool answer = servicesOf(user).history(which);
                if (which == Action::CanUndo || which == Action::CanRedo)
                    return answer ? 1 : 0;
                return answer ? 0 : 1;
            }
            catch (...)
            {
                return which == Action::CanUndo || which == Action::CanRedo ? 0 : 1;
            }
        }

        std::int32_t hostPresetLoad(void* user, const std::uint8_t* id, std::size_t length, SoundorWriter error)
        {
            try
            {
                servicesOf(user).loadPreset(std::string_view(reinterpret_cast<const char*>(id), length));
                return 0;
            }
            catch (...)
            {
                failure(error);
                return 1;
            }
        }

        void collect(void* user, const std::uint8_t* data, std::size_t length)
        {
            auto& out = *static_cast<std::vector<std::uint8_t>*>(user);
            if (length > 0)
                out.insert(out.end(), data, data + length);
        }

        SoundorWriter writerInto(std::vector<std::uint8_t>& out) noexcept
        {
            return { &out, &collect };
        }

        std::string text(const std::vector<std::uint8_t>& bytes)
        {
            return { reinterpret_cast<const char*>(bytes.data()), bytes.size() };
        }

        RustController::Outcome outcomeOf(std::int32_t status, std::vector<std::uint8_t>&& bytes)
        {
            RustController::Outcome outcome;
            if (status == SOUNDOR_CONTROLLER_OK)
            {
                outcome.ok = true;
                outcome.bytes = std::move(bytes);
                return outcome;
            }
            outcome.message = text(bytes);
            if (outcome.message.empty())
                outcome.message = status == SOUNDOR_CONTROLLER_PANICKED ? "the controller panicked"
                                                                        : "the controller refused the call";
            return outcome;
        }

        RustController::Outcome failed(std::string message)
        {
            RustController::Outcome outcome;
            outcome.message = std::move(message);
            return outcome;
        }
    } // namespace

    std::optional<ControllerContract> ControllerContract::parse(std::span<const std::uint8_t> descriptor)
    {
        DescriptorReader reader(descriptor);
        ControllerContract contract;
        std::uint8_t magic[4] {};
        for (auto& byte : magic)
            if (! reader.u8(byte))
                return std::nullopt;
        std::uint32_t version = 0;
        if (std::memcmp(magic, "SNDC", 4) != 0 || ! reader.u32(version) || version != descriptorVersion
            || ! reader.u32(contract.parameterCount))
            return std::nullopt;
        std::uint32_t typeCount = 0;
        if (! reader.count(typeCount, 9))
            return std::nullopt;
        contract.types.resize(typeCount);
        for (auto& type : contract.types)
        {
            std::uint8_t kind = 0;
            if (! reader.u8(kind) || kind > 1 || ! reader.string(type.name))
                return std::nullopt;
            type.isEnum = kind == 1;
            if (type.isEnum)
            {
                std::uint32_t count = 0;
                if (! reader.count(count, 4))
                    return std::nullopt;
                type.values.resize(count);
                for (auto& value : type.values)
                    if (! reader.string(value))
                        return std::nullopt;
            }
            else if (! readFields(reader, contract, type.fields))
                return std::nullopt;
        }
        if (! readFields(reader, contract, contract.state))
            return std::nullopt;
        std::uint32_t methodCount = 0;
        if (! reader.count(methodCount, 10))
            return std::nullopt;
        contract.methods.resize(methodCount);
        for (auto& method : contract.methods)
        {
            std::uint8_t async = 0;
            if (! reader.string(method.name) || ! reader.u8(async) || async > 1
                || ! readFields(reader, contract, method.args) || ! readType(reader, contract, method.returns, 0))
                return std::nullopt;
            method.async = async == 1;
        }
        if (! reader.done() || ! resolved(contract))
            return std::nullopt;
        // Every vector is final: views of its strings stay valid.
        for (auto& type : contract.types)
            type.valueViews.assign(type.values.begin(), type.values.end());
        return contract;
    }

    RustController::RustController(std::span<const std::uint8_t> descriptor, const RustControllerFunctions& functions,
                                   ControllerServices& owner, void* processor)
        : abi(functions), services(owner)
    {
        if (auto parsed = ControllerContract::parse(descriptor))
            described = std::move(*parsed);
        else
        {
            problem = "The runtime's controller descriptor is malformed: regenerate it with soundor gen.";
            return;
        }
        if (abi.info == nullptr || abi.create == nullptr || abi.destroy == nullptr || abi.call == nullptr
            || abi.start == nullptr || abi.cancel == nullptr || abi.run == nullptr)
        {
            problem = "The plugin's Rust crate is missing a function of the Soundor controller ABI.";
            return;
        }
        SoundorControllerInfo info {};
        if (abi.info(&info) != 0 || info.abiVersion != SOUNDOR_CONTROLLER_ABI_VERSION)
        {
            problem = "The plugin's Rust controller was built for another Soundor ABI: rebuild it with soundor build.";
            return;
        }
        exported = info.present == 1;
        if (! exported)
        {
            problem = "The plugin's Rust crate exports no controller: export one with "
                      "soundor::export!(PluginProcessor, PluginController).";
            return;
        }
        if (info.descriptor == nullptr
            || ! std::ranges::equal(std::span(info.descriptor, info.descriptorSize), descriptor))
        {
            problem = "The plugin's Rust controller was built from another soundor.config (its native methods, "
                      "types, parameters or state differ): rebuild it with soundor build.";
            return;
        }
        host = SoundorControllerHost {
            static_cast<std::uint32_t>(sizeof(SoundorControllerHost)),
            SOUNDOR_CONTROLLER_ABI_VERSION,
            &services,
            &hostWake,
            &hostParameterGet,
            &hostParameterSet,
            &hostStateGet,
            &hostStateSet,
            &hostHistory,
            &hostPresetLoad,
        };
        handle = abi.create(&host, processor);
        if (handle == nullptr)
            problem = "The plugin's Rust controller panicked while its stores were constructed.";
    }

    RustController::~RustController()
    {
        shutdown();
    }

    void RustController::shutdown() noexcept
    {
        if (handle == nullptr)
            return;
        void* owned = std::exchange(handle, nullptr);
        abi.destroy(owned);
        problem = "The plugin instance has shut down.";
        // Their promises are rejected as their last copies go.
        completions.clear();
    }

    RustController::Outcome RustController::call(std::uint32_t method, std::span<const std::uint8_t> args)
    {
        if (handle == nullptr)
            return failed(problem);
        std::vector<std::uint8_t> out;
        const std::int32_t status = abi.call(handle, method, args.data(), args.size(), writerInto(out));
        return outcomeOf(status, std::move(out));
    }

    RustController::Outcome RustController::start(std::uint32_t method, std::span<const std::uint8_t> args,
                                                  Completion completion, std::uint64_t& operation)
    {
        if (handle == nullptr)
            return failed(problem);
        operation = ++nextOperation;
        std::vector<std::uint8_t> error;
        const std::int32_t status = abi.start(handle, method, operation, args.data(), args.size(), writerInto(error));
        if (status != SOUNDOR_CONTROLLER_OK)
            return outcomeOf(status, std::move(error));
        completions.emplace(operation, std::move(completion));
        Outcome started;
        started.ok = true;
        return started;
    }

    void RustController::cancel(std::uint64_t operation)
    {
        if (completions.erase(operation) > 0 && handle != nullptr)
            abi.cancel(handle, operation);
    }

    bool RustController::pump(std::chrono::nanoseconds budget)
    {
        if (handle == nullptr || pumping)
            return false;
        pumping = true;
        struct Reset
        {
            bool& flag;
            ~Reset() { flag = false; }
        } reset { pumping };
        const auto deadline = std::chrono::steady_clock::now() + budget;
        for (;;)
        {
            if (handle == nullptr)
                return false;
            std::uint64_t operation = 0;
            std::vector<std::uint8_t> out;
            const std::int32_t ran = abi.run(handle, &operation, writerInto(out));
            if (ran == SOUNDOR_CONTROLLER_RAN_NOTHING || ran == SOUNDOR_CONTROLLER_RAN_REENTRANT)
                return false;
            if (ran == SOUNDOR_CONTROLLER_RAN_COMPLETED || ran == SOUNDOR_CONTROLLER_RAN_FAILED)
            {
                const auto found = completions.find(operation);
                if (found != completions.end())
                {
                    Completion completion = std::move(found->second);
                    completions.erase(found);
                    Outcome outcome;
                    outcome.ok = ran == SOUNDOR_CONTROLLER_RAN_COMPLETED;
                    if (outcome.ok)
                        outcome.bytes = std::move(out);
                    else
                        outcome.message = text(out);
                    completion(std::move(outcome));
                }
            }
            if (std::chrono::steady_clock::now() >= deadline)
                return true;
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::processor
