#include "Engine.h"

#include "ui/StyleReader.h"

#include <algorithm>
#include <bit>
#include <charconv>
#include <cmath>
#include <cstring>
#include <exception>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::wasm
{
    // Reads commands: 32-bit little-endian words, strings as a byte count
    // then UTF-8 padded to a whole word. Throws on a truncated buffer.
    class CommandReader
    {
    public:
        CommandReader(const std::uint8_t* bytes, std::size_t length) : data(bytes), size(length) {}

        [[nodiscard]] bool done() const noexcept { return position >= size; }

        std::uint32_t word()
        {
            std::uint32_t value = 0;
            std::memcpy(&value, take(4), 4);
            return value;
        }

        float real() { return std::bit_cast<float>(word()); }

        double real64()
        {
            double value = 0;
            std::memcpy(&value, take(8), 8);
            return value;
        }

        std::string_view text()
        {
            const std::uint32_t length = word();
            const auto* bytes = reinterpret_cast<const char*>(take(length));
            take((4 - length % 4) % 4);
            return { bytes, length };
        }

    private:
        const std::uint8_t* take(std::size_t count)
        {
            if (count > size - position)
                throw std::runtime_error("truncated command buffer");
            const std::uint8_t* at = data + position;
            position += count;
            return at;
        }

        const std::uint8_t* data;
        std::size_t size;
        std::size_t position = 0;
    };

    namespace
    {
        // An invalid style: a TypeError in JavaScript, as soundor:ui's.
        class StyleError : public std::invalid_argument
        {
        public:
            using std::invalid_argument::invalid_argument;
        };

        // A number as JavaScript's String() shows it, for the common cases.
        std::string jsNumber(double value)
        {
            if (std::isnan(value))
                return "NaN";
            if (std::isinf(value))
                return value > 0 ? "Infinity" : "-Infinity";
            char buffer[32];
            const auto result = std::to_chars(std::begin(buffer), std::end(buffer), value);
            return { std::begin(buffer), result.ptr };
        }

        // A Style command's properties.
        class WireStyle final : public ui::StyleSource
        {
        public:
            explicit WireStyle(CommandReader& reader)
            {
                const std::uint32_t count = reader.word();
                properties.reserve(count);
                for (std::uint32_t i = 0; i < count; ++i)
                {
                    const std::string_view key = reader.text();
                    ui::StyleValue value;
                    switch (static_cast<ValueKind>(reader.word()))
                    {
                        case ValueKind::Number:
                            value.kind = ui::StyleValue::Kind::Number;
                            value.number = reader.real64();
                            break;
                        case ValueKind::String:
                            value.kind = ui::StyleValue::Kind::String;
                            value.text = reader.text();
                            break;
                        case ValueKind::Other:
                            value.kind = ui::StyleValue::Kind::Other;
                            value.text = reader.text();
                            break;
                        default:
                            throw std::runtime_error("invalid style value kind");
                    }
                    properties.emplace_back(key, std::move(value));
                }
            }

            [[nodiscard]] ui::StyleValue get(std::string_view key) const override
            {
                const auto* found = find(key);
                return found == nullptr ? ui::StyleValue {} : *found;
            }

            [[noreturn]] void fail(std::string_view key, std::string_view expected) override
            {
                const ui::StyleValue* value = find(key);
                std::string got;
                if (value != nullptr)
                    got = value->kind == ui::StyleValue::Kind::Number   ? jsNumber(value->number)
                          : value->kind == ui::StyleValue::Kind::String ? "'" + value->text + "'"
                                                                        : value->text;
                throw StyleError("style." + std::string(key) + ": expected " + std::string(expected) + ", got " + got);
            }

            std::vector<ui::BoxShadow> boxShadow() override
            {
                unsupported("boxShadow");
                return {};
            }

            std::optional<ui::Presentation> transform() override
            {
                unsupported("transform");
                return std::nullopt;
            }

        private:
            [[nodiscard]] const ui::StyleValue* find(std::string_view key) const
            {
                for (const auto& [name, value] : properties)
                    if (name == key)
                        return &value;
                return nullptr;
            }

            void unsupported(std::string_view key) const
            {
                if (find(key) != nullptr)
                    throw StyleError("style." + std::string(key) + ": not supported by the WebAssembly engine yet");
            }

            std::vector<std::pair<std::string_view, ui::StyleValue>> properties;
        };

        // JavaScript indexes strings in UTF-16 code units, the surface in UTF-8 bytes.
        std::uint32_t utf16Index(std::string_view text, std::size_t offset)
        {
            std::uint32_t units = 0;
            for (std::size_t i = 0; i < offset && i < text.size(); ++i)
            {
                const auto byte = static_cast<unsigned char>(text[i]);
                if ((byte & 0xC0) != 0x80)
                    units += byte >= 0xF0 ? 2 : 1;
            }
            return units;
        }

        std::uint32_t bits(float value)
        {
            return std::bit_cast<std::uint32_t>(value);
        }

        void pushText(std::vector<std::uint32_t>& out, std::string_view text)
        {
            out.push_back(static_cast<std::uint32_t>(text.size()));
            const std::size_t start = out.size();
            out.resize(start + (text.size() + 3) / 4, 0);
            std::memcpy(out.data() + start, text.data(), text.size());
        }
    } // namespace

    Engine::Engine(std::shared_ptr<ui::TextEngine> text) : ui(ui::Surface::Options { .textEngine = std::move(text) })
    {
        nodes = { ui::noNode, ui.root().id() };
        reported.resize(nodes.size());
    }

    std::uint8_t* Engine::input(std::size_t size)
    {
        if (commands.size() < size)
            commands.resize(size);
        return commands.data();
    }

    std::size_t Engine::nodeCount() const noexcept
    {
        return static_cast<std::size_t>(std::ranges::count_if(nodes, [](ui::NodeId id) { return id != ui::noNode; }));
    }

    ui::NodeId Engine::node(std::uint32_t handle) const
    {
        if (handle >= nodes.size() || nodes[handle] == ui::noNode)
            throw std::invalid_argument("unknown node " + std::to_string(handle));
        return nodes[handle];
    }

    const std::uint8_t* Engine::apply(std::size_t length)
    {
        answer.assign(1, 0);
        CommandReader reader(commands.data(), std::min(length, commands.size()));
        std::uint32_t index = 0;
        while (! reader.done())
        {
            const auto command = static_cast<Command>(reader.word());
            try
            {
                run(command, reader);
            }
            catch (const std::exception& error)
            {
                answer.push_back(static_cast<std::uint32_t>(Record::Error));
                answer.push_back(index);
                answer.push_back(dynamic_cast<const StyleError*>(&error) != nullptr ? 1 : 2);
                pushText(answer, error.what());
                // A command that could not be read leaves the rest unreadable.
                if (dynamic_cast<const std::runtime_error*>(&error) != nullptr)
                    break;
            }
            ++index;
        }
        answer[0] = static_cast<std::uint32_t>((answer.size() - 1) * 4);
        return reinterpret_cast<const std::uint8_t*>(answer.data());
    }

    void Engine::run(Command command, CommandReader& reader)
    {
        switch (command)
        {
            case Command::Create:
            {
                const std::uint32_t handle = reader.word();
                const std::uint32_t type = reader.word();
                if (handle == 0 || (handle < nodes.size() && nodes[handle] != ui::noNode))
                    throw std::invalid_argument("handle " + std::to_string(handle) + " is in use");
                if (type > 1)
                    throw std::invalid_argument("unknown node type " + std::to_string(type));
                if (handle >= nodes.size())
                {
                    nodes.resize(handle + 1, ui::noNode);
                    reported.resize(handle + 1);
                }
                nodes[handle] = ui.createNode(type == 0 ? ui::NodeType::View : ui::NodeType::Text);
                return;
            }
            case Command::Release:
            {
                const std::uint32_t handle = reader.word();
                if (handle == rootHandle)
                    throw std::invalid_argument("the root cannot be released");
                ui.releaseNode(node(handle));
                nodes[handle] = ui::noNode;
                reported[handle] = {};
                return;
            }
            // Every operand is read before any is used: a failing command
            // leaves the next readable.
            case Command::Insert:
            {
                const std::uint32_t parent = reader.word();
                const std::uint32_t child = reader.word();
                const std::uint32_t before = reader.word();
                ui.insertChild(node(parent), node(child), before == 0 ? ui::noNode : node(before));
                return;
            }
            case Command::Remove:
            {
                const std::uint32_t parent = reader.word();
                const std::uint32_t child = reader.word();
                ui.removeChild(node(parent), node(child));
                return;
            }
            case Command::Style:
            {
                const std::uint32_t handle = reader.word();
                // Read the whole command first: an invalid style leaves the
                // rest of the batch readable.
                WireStyle style(reader);
                ui.setStyle(node(handle), ui::readStyle(style));
                return;
            }
            case Command::Text:
            {
                const std::uint32_t handle = reader.word();
                const std::string_view text = reader.text();
                ui.setText(node(handle), std::string(text));
                return;
            }
            case Command::Size:
            {
                const float width = reader.real();
                const float height = reader.real();
                ui.setSize({ std::max(0.0f, width), std::max(0.0f, height) });
                return;
            }
            case Command::Scale:
                ui.setScale(reader.real());
                return;
            case Command::Layout:
                ui.layout();
                report();
                return;
        }
        throw std::runtime_error("unknown command " + std::to_string(static_cast<std::uint32_t>(command)));
    }

    // Each connected node's box, relative to its parent's border box (as
    // soundor:ui's `layout`) and to its padding box (where an absolutely
    // positioned element's offsets start), and its borders; and a text node's
    // lines: when they differ from what was last reported.
    void Engine::report()
    {
        std::vector<std::uint32_t> words;
        for (std::uint32_t handle = 1; handle < nodes.size(); ++handle)
        {
            const ui::NodeId id = nodes[handle];
            if (id == ui::noNode || ! ui.isConnected(id))
                continue;
            const ui::Node& node = *ui.find(id);
            const ui::Rect frame = node.frame();
            const ui::Rect padding = node.paddingBox();
            ui::Rect origin {};
            if (const ui::Node* parent = node.parent(); parent != nullptr)
                origin = parent->paddingBox();
            words = { bits(frame.x),
                      bits(frame.y),
                      bits(frame.x - origin.x),
                      bits(frame.y - origin.y),
                      bits(frame.width),
                      bits(frame.height),
                      bits(padding.y),
                      bits(frame.width - padding.x - padding.width),
                      bits(frame.height - padding.y - padding.height),
                      bits(padding.x) };
            Reported& last = reported[handle];
            if (! last.frame || last.frameWords != words)
            {
                answer.push_back(static_cast<std::uint32_t>(Record::Frame));
                answer.push_back(handle);
                answer.insert(answer.end(), words.begin(), words.end());
                last.frame = true;
                last.frameWords = words;
            }

            if (node.type() != ui::NodeType::Text)
                continue;
            const ui::TextStyle& style = node.style().text;
            const ui::Rect content = node.contentBox();
            const ui::TextLayout& layout = ui.textLayout(id);
            words = { bits(style.fontSize), static_cast<std::uint32_t>(style.fontWeight),
                      style.fontStyle == ui::FontStyle::Italic ? 1U : 0U };
            pushText(words, style.fontFamily);
            words.push_back(static_cast<std::uint32_t>(layout.lines.size()));
            for (const ui::TextLine& line : layout.lines)
            {
                // Placed as the native renderer draws them (Renderer.cpp).
                float x = content.x;
                if (style.textAlign == ui::TextAlign::Center)
                    x += (content.width - line.width) / 2;
                else if (style.textAlign == ui::TextAlign::Right)
                    x += content.width - line.width;
                words.insert(words.end(), { utf16Index(node.text(), line.begin), utf16Index(node.text(), line.end),
                                            bits(x), bits(content.y + line.top), bits(line.width), bits(line.height) });
            }
            if (last.textWords != words)
            {
                answer.push_back(static_cast<std::uint32_t>(Record::Text));
                answer.push_back(handle);
                answer.insert(answer.end(), words.begin(), words.end());
                last.textWords = std::move(words);
            }
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::wasm
