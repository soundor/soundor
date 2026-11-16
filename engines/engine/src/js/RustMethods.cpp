#include "RustMethods.h"

#include "Bindings.h"

#include <bit>
#include <cstring>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
{
    namespace
    {
        // The value encoding is little-endian, as every platform Soundor
        // supports is: numbers are copied as they are.
        static_assert(std::endian::native == std::endian::little);

        using processor::ControllerContract;
        using processor::RustController;
        using Tag = ControllerContract::Tag;

        // What a context holds of its controller.
        struct RustBinding
        {
            std::shared_ptr<RustController> controller;
            ContextState* context = nullptr;
            std::weak_ptr<RustBinding> self;
            // Its async calls not yet completed.
            std::set<std::uint64_t> operations;

            RustBinding() = default;
            RustBinding(const RustBinding&) = delete;
            RustBinding& operator=(const RustBinding&) = delete;
            RustBinding(RustBinding&&) = delete;
            RustBinding& operator=(RustBinding&&) = delete;

            // The context is going (its editor closed, or reloaded): what it
            // started is cancelled, and never completes into it.
            ~RustBinding()
            {
                for (const std::uint64_t operation : operations)
                    controller->cancel(operation);
            }
        };

        // ── JavaScript → the controller's value encoding ─────────────────────

        class Encoder
        {
        public:
            explicit Encoder(std::vector<std::uint8_t>& bytes) : out(bytes) {}

            void u8(std::uint8_t value) { out.push_back(value); }

            void count(std::size_t value)
            {
                if (value > UINT32_MAX)
                    throw std::length_error("a native value holds at most 4 GiB");
                number(static_cast<std::uint32_t>(value));
            }

            template <typename T>
            void number(T value)
            {
                raw(&value, sizeof value);
            }

            void raw(const void* data, std::size_t size)
            {
                const auto* bytes = static_cast<const std::uint8_t*>(data);
                out.insert(out.end(), bytes, bytes + size);
            }

        private:
            std::vector<std::uint8_t>& out;
        };

        template <typename T>
        void encodeNumber(ContextState& ctx, const jsi::Value& value, const Path& path, Encoder& out)
        {
            T number {};
            if constexpr (std::is_same_v<T, double>)
                readFloat64(ctx, value, path, number);
            else
                read(ctx, value, path, number);
            out.number(number);
        }

        template <typename T>
        void encodeBuffer(ContextState& ctx, const jsi::Value& value, const Path& path, Encoder& out)
        {
            std::span<const T> view;
            read(ctx, value, path, view);
            out.count(view.size());
            out.raw(view.data(), view.size_bytes());
        }

        void encodeBufferOf(Tag element, ContextState& ctx, const jsi::Value& value, const Path& path, Encoder& out)
        {
            switch (element)
            {
                case Tag::Int8:
                    return encodeBuffer<std::int8_t>(ctx, value, path, out);
                case Tag::Uint8:
                    return encodeBuffer<std::uint8_t>(ctx, value, path, out);
                case Tag::Int16:
                    return encodeBuffer<std::int16_t>(ctx, value, path, out);
                case Tag::Uint16:
                    return encodeBuffer<std::uint16_t>(ctx, value, path, out);
                case Tag::Int32:
                    return encodeBuffer<std::int32_t>(ctx, value, path, out);
                case Tag::Uint32:
                    return encodeBuffer<std::uint32_t>(ctx, value, path, out);
                case Tag::Int64:
                    return encodeBuffer<std::int64_t>(ctx, value, path, out);
                case Tag::Uint64:
                    return encodeBuffer<std::uint64_t>(ctx, value, path, out);
                case Tag::Float32:
                    return encodeBuffer<float>(ctx, value, path, out);
                case Tag::Float64:
                    return encodeBuffer<double>(ctx, value, path, out);
                default:
                    throw std::logic_error("a buffer of a type that is not a number");
            }
        }

        void encode(ContextState& ctx, const jsi::Value& value, const Path& path, const ControllerContract& contract,
                    std::uint32_t node, Encoder& out)
        {
            const ControllerContract::Type& type = contract.nodes.at(node);
            switch (type.tag)
            {
                case Tag::Void:
                    return;
                case Tag::Boolean:
                {
                    bool flag = false;
                    read(ctx, value, path, flag);
                    return out.u8(flag ? 1 : 0);
                }
                case Tag::String:
                {
                    std::string text;
                    read(ctx, value, path, text);
                    out.count(text.size());
                    return out.raw(text.data(), text.size());
                }
                case Tag::Int8:
                    return encodeNumber<std::int8_t>(ctx, value, path, out);
                case Tag::Uint8:
                    return encodeNumber<std::uint8_t>(ctx, value, path, out);
                case Tag::Int16:
                    return encodeNumber<std::int16_t>(ctx, value, path, out);
                case Tag::Uint16:
                    return encodeNumber<std::uint16_t>(ctx, value, path, out);
                case Tag::Int32:
                    return encodeNumber<std::int32_t>(ctx, value, path, out);
                case Tag::Uint32:
                    return encodeNumber<std::uint32_t>(ctx, value, path, out);
                case Tag::Int64:
                    return encodeNumber<std::int64_t>(ctx, value, path, out);
                case Tag::Uint64:
                    return encodeNumber<std::uint64_t>(ctx, value, path, out);
                case Tag::Float32:
                    return encodeNumber<float>(ctx, value, path, out);
                case Tag::Float64:
                    return encodeNumber<double>(ctx, value, path, out);
                case Tag::Declared:
                {
                    const auto& declared = contract.types.at(type.index);
                    if (declared.isEnum)
                    {
                        std::size_t index = 0;
                        readEnum(ctx, value, path, declared.valueViews, index);
                        return out.number(static_cast<std::uint32_t>(index));
                    }
                    const jsi::Object object = expectObject(ctx, value, path);
                    for (const auto& field : declared.fields)
                        encode(ctx, property(ctx, object, field.name.c_str()), path.field(field.name.c_str()), contract,
                               field.type, out);
                    return;
                }
                case Tag::Array:
                {
                    const jsi::Array array = expectArray(ctx, value, path);
                    const std::size_t length = array.size(ctx.rt);
                    out.count(length);
                    for (std::size_t i = 0; i < length; ++i)
                        encode(ctx, array.getValueAtIndex(ctx.rt, i), path.element(i), contract, type.index, out);
                    return;
                }
                case Tag::Buffer:
                    return encodeBufferOf(type.element, ctx, value, path, out);
                case Tag::Nullable:
                    if (value.isNull())
                        return out.u8(0);
                    out.u8(1);
                    return encode(ctx, value, path, contract, type.index, out);
            }
        }

        // ── The controller's value encoding → JavaScript ─────────────────────

        class Decoder
        {
        public:
            explicit Decoder(std::span<const std::uint8_t> input) : bytes(input) {}

            const std::uint8_t* take(std::size_t size)
            {
                if (bytes.size() - at < size)
                    throw std::runtime_error("the controller's result is malformed");
                const std::uint8_t* taken = bytes.data() + at;
                at += size;
                return taken;
            }

            template <typename T>
            T number()
            {
                T value {};
                std::memcpy(&value, take(sizeof value), sizeof value);
                return value;
            }

            // A count of elements each `size` bytes long, checked against
            // what is left.
            std::size_t count(std::size_t size)
            {
                const auto length = static_cast<std::size_t>(number<std::uint32_t>());
                if (length * std::max<std::size_t>(size, 1) > bytes.size() - at)
                    throw std::runtime_error("the controller's result is malformed");
                return length;
            }

            void finish() const
            {
                if (at != bytes.size())
                    throw std::runtime_error("the controller's result is malformed");
            }

        private:
            std::span<const std::uint8_t> bytes;
            std::size_t at = 0;
        };

        template <typename T>
        jsi::Value decodeBuffer(ContextState& ctx, Decoder& in)
        {
            const std::size_t length = in.count(sizeof(T));
            std::vector<T> values(length);
            if (length > 0)
                std::memcpy(values.data(), in.take(length * sizeof(T)), length * sizeof(T));
            return writeBuffer(ctx, std::move(values));
        }

        jsi::Value decodeBufferOf(Tag element, ContextState& ctx, Decoder& in)
        {
            switch (element)
            {
                case Tag::Int8:
                    return decodeBuffer<std::int8_t>(ctx, in);
                case Tag::Uint8:
                    return decodeBuffer<std::uint8_t>(ctx, in);
                case Tag::Int16:
                    return decodeBuffer<std::int16_t>(ctx, in);
                case Tag::Uint16:
                    return decodeBuffer<std::uint16_t>(ctx, in);
                case Tag::Int32:
                    return decodeBuffer<std::int32_t>(ctx, in);
                case Tag::Uint32:
                    return decodeBuffer<std::uint32_t>(ctx, in);
                case Tag::Int64:
                    return decodeBuffer<std::int64_t>(ctx, in);
                case Tag::Uint64:
                    return decodeBuffer<std::uint64_t>(ctx, in);
                case Tag::Float32:
                    return decodeBuffer<float>(ctx, in);
                case Tag::Float64:
                    return decodeBuffer<double>(ctx, in);
                default:
                    throw std::logic_error("a buffer of a type that is not a number");
            }
        }

        jsi::Value decode(ContextState& ctx, Decoder& in, const ControllerContract& contract, std::uint32_t node)
        {
            const ControllerContract::Type& type = contract.nodes.at(node);
            switch (type.tag)
            {
                case Tag::Void:
                    return jsi::Value::undefined();
                case Tag::Boolean:
                {
                    const auto flag = in.number<std::uint8_t>();
                    if (flag > 1)
                        throw std::runtime_error("the controller's result is malformed");
                    return write(ctx, flag == 1);
                }
                case Tag::String:
                {
                    const std::size_t length = in.count(1);
                    const auto* text = in.take(length);
                    return write(ctx, std::string_view(reinterpret_cast<const char*>(text), length));
                }
                case Tag::Int8:
                    return write(ctx, in.number<std::int8_t>());
                case Tag::Uint8:
                    return write(ctx, in.number<std::uint8_t>());
                case Tag::Int16:
                    return write(ctx, in.number<std::int16_t>());
                case Tag::Uint16:
                    return write(ctx, in.number<std::uint16_t>());
                case Tag::Int32:
                    return write(ctx, in.number<std::int32_t>());
                case Tag::Uint32:
                    return write(ctx, in.number<std::uint32_t>());
                case Tag::Int64:
                    return write(ctx, in.number<std::int64_t>());
                case Tag::Uint64:
                    return write(ctx, in.number<std::uint64_t>());
                case Tag::Float32:
                    return write(ctx, in.number<float>());
                case Tag::Float64:
                    return write(ctx, in.number<double>());
                case Tag::Declared:
                {
                    const auto& declared = contract.types.at(type.index);
                    if (declared.isEnum)
                    {
                        const auto index = static_cast<std::size_t>(in.number<std::uint32_t>());
                        if (index >= declared.valueViews.size())
                            throw std::runtime_error("the controller's result is malformed");
                        return writeEnum(ctx, declared.valueViews[index]);
                    }
                    ObjectBuilder object(ctx);
                    for (const auto& field : declared.fields)
                        object.set(field.name.c_str(), decode(ctx, in, contract, field.type));
                    return object.release();
                }
                case Tag::Array:
                {
                    const std::size_t length = in.count(0);
                    jsi::Array array(ctx.rt, length);
                    for (std::size_t i = 0; i < length; ++i)
                        array.setValueAtIndex(ctx.rt, i, decode(ctx, in, contract, type.index));
                    return array;
                }
                case Tag::Buffer:
                    return decodeBufferOf(type.element, ctx, in);
                case Tag::Nullable:
                {
                    const auto present = in.number<std::uint8_t>();
                    if (present > 1)
                        throw std::runtime_error("the controller's result is malformed");
                    return present == 0 ? jsi::Value::null() : decode(ctx, in, contract, type.index);
                }
            }
            throw std::logic_error("unknown type");
        }

        jsi::Value result(ContextState& ctx, const ControllerContract& contract, std::uint32_t node,
                          std::span<const std::uint8_t> bytes)
        {
            Decoder in(bytes);
            jsi::Value value = decode(ctx, in, contract, node);
            in.finish();
            return value;
        }

        // An async call's completion, from RustController::pump(): it never
        // throws, as the controller requires.
        void complete(const std::weak_ptr<RustBinding>& weak, detail::PendingPromise& pending, std::uint32_t method,
                      std::uint64_t operation, RustController::Outcome outcome) noexcept
        {
            const auto binding = weak.lock();
            if (binding == nullptr)
                return;
            binding->operations.erase(operation);
            ContextState& ctx = *binding->context;
            const ControllerContract& contract = binding->controller->contract();
            try
            {
                if (outcome.ok)
                    resolvePromise(
                        pending, [&](ContextState& owner)
                        { return result(owner, contract, contract.methods.at(method).returns, outcome.bytes); });
                else
                    detail::rejectPromise(pending, outcome.message);
            }
            catch (const std::exception& error)
            {
                // Out of memory while settling: the promise rejects with it.
                detail::rejectPromise(pending, error.what());
            }
            // The microtask checkpoint: the promise's reactions run now, after
            // the task that settled it, not at the next frame.
            try
            {
                if (! ctx.halted() && ctx.javaScriptDepth == 0)
                    ctx.drainJobs();
            }
            catch (const std::exception& error)
            {
                ctx.runtime->log(LogLevel::Error, std::string("Running a promise's reactions failed: ") + error.what());
            }
        }

        jsi::Value callMethod(ContextState& ctx, RustBinding& binding, std::uint32_t index, const jsi::Value* args,
                              std::size_t count)
        {
            RustController& controller = *binding.controller;
            const ControllerContract& contract = controller.contract();
            const ControllerContract::Method& method = contract.methods.at(index);
            const char* name = method.name.c_str();
            return invoke(ctx, name,
                          [&]() -> jsi::Value
                          {
                              expectArgumentCount(ctx, name, count, method.args.size());
                              const Path call { name };
                              std::vector<std::uint8_t> bytes;
                              Encoder out(bytes);
                              for (std::size_t i = 0; i < method.args.size(); ++i)
                                  encode(ctx, args[i], call.field(method.args[i].name.c_str()), contract,
                                         method.args[i].type, out);
                              if (! method.async)
                              {
                                  const RustController::Outcome outcome = controller.call(index, bytes);
                                  if (! outcome.ok)
                                      throw std::runtime_error(outcome.message);
                                  return result(ctx, contract, method.returns, outcome.bytes);
                              }
                              std::shared_ptr<detail::PendingPromise> pending;
                              jsi::Value promise = newPromise(ctx, name, pending);
                              auto operation = std::make_shared<std::uint64_t>(0);
                              const RustController::Outcome started = controller.start(
                                  index, bytes,
                                  [weak = binding.self, pending, index, operation](RustController::Outcome outcome)
                                  { complete(weak, *pending, index, *operation, std::move(outcome)); }, *operation);
                              if (started.ok)
                                  binding.operations.insert(*operation);
                              else
                                  detail::rejectPromise(*pending, started.message);
                              return promise;
                          });
        }
    } // namespace

    void setRustController(Context& context, const void* key, std::shared_ptr<processor::RustController> controller)
    {
        auto binding = std::make_shared<RustBinding>();
        binding->controller = std::move(controller);
        binding->context = &stateOf(context);
        binding->self = binding;
        setContextData(context, key, std::move(binding));
    }

    void installRustMethods(ContextState& context, jsi::Object& exports, const void* key)
    {
        auto* binding = contextData<RustBinding>(context, key);
        if (binding == nullptr || binding->controller == nullptr)
            throwInternalError(context, "soundor:native has no Rust controller in this context");
        std::uint32_t index = 0;
        for (const auto& method : binding->controller->contract().methods)
        {
            const char* name = method.name.c_str();
            setProperty(context, exports, name,
                        closure(context, name, static_cast<unsigned>(method.args.size()),
                                [binding, index](ContextState& ctx, const jsi::Value&, const jsi::Value* args,
                                                 std::size_t count)
                                { return callMethod(ctx, *binding, index, args, count); }));
            ++index;
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
