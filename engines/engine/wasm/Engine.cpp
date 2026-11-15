#include "Engine.h"

#include "ui/Color.h"
#include "ui/StyleReader.h"

#include <algorithm>
#include <array>
#include <bit>
#include <charconv>
#include <cmath>
#include <cstring>
#include <exception>
#include <numbers>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
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

    // The natural sizes of the image nodes images, canvases and SVGs are
    // here, by the source each is given: its handle.
    class NaturalSizes final : public ui::ImageSource
    {
    public:
        std::optional<ui::Size> imageSize(std::string_view source) override
        {
            const auto found = sizes.find(std::string(source));
            if (found == sizes.end())
                return std::nullopt;
            return found->second;
        }

        std::unordered_map<std::string, ui::Size> sizes;
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

        // A value of a Style command: what JavaScript had, as far as reading
        // a style looks into it.
        struct WireValue
        {
            ValueKind kind = ValueKind::Other;
            double number = 0;
            bool boolean = false;
            // A string's value; otherwise how String() shows the value.
            std::string text;
            // Other: its type, as soundor:ui's errors name it.
            std::string type;
            // An array's values; an object's, its keys in `names`.
            std::vector<WireValue> items;
            std::vector<std::string> names;

            static WireValue read(CommandReader& reader)
            {
                WireValue value;
                value.kind = static_cast<ValueKind>(reader.word());
                switch (value.kind)
                {
                    case ValueKind::Number:
                        value.number = reader.real64();
                        value.text = jsNumber(value.number);
                        return value;
                    case ValueKind::String:
                        value.text = reader.text();
                        return value;
                    case ValueKind::Boolean:
                        value.boolean = reader.word() != 0;
                        value.text = value.boolean ? "true" : "false";
                        return value;
                    case ValueKind::Other:
                        value.text = reader.text();
                        value.type = reader.text();
                        return value;
                    case ValueKind::Array:
                    {
                        value.text = reader.text();
                        const std::uint32_t count = reader.word();
                        value.items.reserve(count);
                        for (std::uint32_t i = 0; i < count; ++i)
                            value.items.push_back(read(reader));
                        return value;
                    }
                    case ValueKind::Object:
                    {
                        value.text = reader.text();
                        const std::uint32_t count = reader.word();
                        value.names.reserve(count);
                        value.items.reserve(count);
                        for (std::uint32_t i = 0; i < count; ++i)
                        {
                            value.names.emplace_back(reader.text());
                            value.items.push_back(read(reader));
                        }
                        return value;
                    }
                }
                throw std::runtime_error("invalid style value kind");
            }

            // An object's value of `key`; null when it is missing, undefined or null.
            [[nodiscard]] const WireValue* field(std::string_view key) const
            {
                for (std::size_t i = 0; i < names.size(); ++i)
                    if (names[i] == key)
                        return items[i].absent() ? nullptr : &items[i];
                return nullptr;
            }

            [[nodiscard]] bool absent() const noexcept
            {
                return kind == ValueKind::Other && (type == "undefined" || type == "null");
            }

            // As soundor:ui's type errors name it (bind::describeType()).
            [[nodiscard]] std::string typeName() const
            {
                switch (kind)
                {
                    case ValueKind::Number:
                        return "number";
                    case ValueKind::String:
                        return "string";
                    case ValueKind::Boolean:
                        return "boolean";
                    case ValueKind::Array:
                        return "array";
                    case ValueKind::Object:
                        return "object";
                    case ValueKind::Other:
                        break;
                }
                return type;
            }

            // As an error's "got": strings quoted, the rest as String() shows them.
            [[nodiscard]] std::string shown() const { return kind == ValueKind::String ? "'" + text + "'" : text; }
        };

        [[noreturn]] void styleError(const std::string& message)
        {
            throw StyleError(message);
        }

        // `path`: expected `expected`, got the value.
        [[noreturn]] void expected(const std::string& path, const WireValue& value, std::string_view expected)
        {
            styleError(path + ": expected " + std::string(expected) + ", got " + value.shown());
        }

        // `transform`, read as soundor:ui reads it natively (UiModule.cpp's
        // readTransform()), with the same errors.
        ui::Presentation readTransform(const WireValue& value)
        {
            if (value.kind != ValueKind::Array)
                styleError("style.transform: expected an array");
            ui::Presentation result;
            if (value.items.size() > result.order.size())
                styleError("style.transform: each supported transform may appear once");
            static constexpr std::array<std::string_view, 7> names { "opacity", "translateX", "translateY", "scale",
                                                                     "scaleX",  "scaleY",     "rotate" };
            ui::PropertyMask seen = 0;
            for (const WireValue& item : value.items)
            {
                if (item.kind != ValueKind::Object)
                    styleError("style.transform: expected object, got " + item.typeName());
                if (item.names.size() != 1)
                    styleError("style.transform: expected one property per entry");
                const std::string& name = item.names.front();
                const WireValue& input = item.items.front();
                const auto found = std::ranges::find(names, name);
                if (found == names.end() || found == names.begin())
                    styleError("style.transform: unsupported property " + name);
                const auto property = static_cast<ui::AnimatedProperty>(found - names.begin());
                if ((seen & ui::propertyBit(property)) != 0)
                    styleError("style.transform: duplicate " + name);
                seen |= ui::propertyBit(property);
                double number = 0;
                if (input.kind == ValueKind::Number)
                    number = input.number;
                else if (property == ui::AnimatedProperty::Rotate && input.kind == ValueKind::String)
                {
                    const std::string& text = input.text;
                    if (text.size() <= 3 || (! text.ends_with("deg") && ! text.ends_with("rad")))
                        styleError("style.transform.rotate: expected radians or a deg/rad angle");
                    const std::string_view numeric(text.data(), text.size() - 3);
                    const auto parsed = ui::parseCssNumber(numeric);
                    // CSS exponents contain integer digits, never a decimal.
                    const auto exponent = numeric.find_first_of("eE");
                    bool validExponent = true;
                    if (exponent != std::string_view::npos)
                    {
                        auto digits = numeric.substr(exponent + 1);
                        if (! digits.empty() && (digits.front() == '+' || digits.front() == '-'))
                            digits.remove_prefix(1);
                        validExponent =
                            ! digits.empty()
                            && std::ranges::all_of(digits, [](char digit) { return digit >= '0' && digit <= '9'; });
                    }
                    if (! parsed || ! validExponent)
                        styleError("style.transform.rotate: invalid angle");
                    number = *parsed;
                    if (text.ends_with("deg"))
                        number *= std::numbers::pi / 180;
                }
                else
                    styleError("style.transform." + name + ": expected a finite number");
                if (! std::isfinite(number) || ! std::isfinite(static_cast<float>(number)))
                    styleError("style.transform." + name + ": expected a finite number");
                result[property] = static_cast<float>(number);
                result.order[result.count++] = property;
            }
            return result;
        }

        // `boxShadow`, read as soundor:ui reads it natively, with the same errors.
        std::vector<ui::BoxShadow> readBoxShadow(const WireValue& value)
        {
            if (value.kind != ValueKind::Array)
                expected("style.boxShadow", value, "an array");
            static constexpr std::array<std::string_view, 6> keys { "offsetX", "offsetY", "blur",
                                                                    "spread",  "color",   "inset" };
            std::vector<ui::BoxShadow> result;
            result.reserve(value.items.size());
            for (std::size_t i = 0; i < value.items.size(); ++i)
            {
                const std::string path = "style.boxShadow[" + std::to_string(i) + "]";
                const WireValue& entry = value.items[i];
                if (entry.kind != ValueKind::Object)
                    expected(path, entry, "an object");
                for (const std::string& name : entry.names)
                    if (std::ranges::find(keys, name) == keys.end())
                        styleError(std::string(path).append(": unsupported property ").append(name));
                ui::BoxShadow shadow;
                const auto number = [&](const char* name, bool nonnegative, float& out)
                {
                    const WireValue* field = entry.field(name);
                    if (field == nullptr)
                        return;
                    if (field->kind != ValueKind::Number || ! std::isfinite(field->number)
                        || ! std::isfinite(static_cast<float>(field->number)) || (nonnegative && field->number < 0))
                        expected(path + "." + name, *field,
                                 nonnegative ? "a finite nonnegative number" : "a finite number");
                    out = static_cast<float>(field->number);
                };
                number("offsetX", false, shadow.offsetX);
                number("offsetY", false, shadow.offsetY);
                number("blur", true, shadow.blur);
                number("spread", false, shadow.spread);
                if (const WireValue* field = entry.field("color"))
                {
                    std::optional<ui::Color> parsed;
                    if (field->kind == ValueKind::String)
                        parsed = ui::parseColor(field->text);
                    if (! parsed)
                        expected(path + ".color", *field, "a CSS color");
                    shadow.color = *parsed;
                }
                if (const WireValue* field = entry.field("inset"))
                {
                    if (field->kind != ValueKind::Boolean)
                        expected(path + ".inset", *field, "a boolean");
                    shadow.inset = field->boolean;
                }
                result.push_back(shadow);
            }
            return result;
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
                    std::string key(reader.text());
                    properties.emplace_back(std::move(key), WireValue::read(reader));
                }
            }

            [[nodiscard]] ui::StyleValue get(std::string_view key) const override
            {
                const WireValue* found = find(key);
                if (found == nullptr)
                    return {};
                switch (found->kind)
                {
                    case ValueKind::Number:
                        return { .kind = ui::StyleValue::Kind::Number, .number = found->number };
                    case ValueKind::String:
                        return { .kind = ui::StyleValue::Kind::String, .text = found->text };
                    default:
                        return { .kind = ui::StyleValue::Kind::Other, .text = found->text };
                }
            }

            [[noreturn]] void fail(std::string_view key, std::string_view expectation) override
            {
                const WireValue* value = find(key);
                expected("style." + std::string(key), value != nullptr ? *value : WireValue {}, expectation);
            }

            std::vector<ui::BoxShadow> boxShadow() override
            {
                const WireValue* value = find("boxShadow");
                return value == nullptr ? std::vector<ui::BoxShadow> {} : readBoxShadow(*value);
            }

            std::optional<ui::Presentation> transform() override
            {
                const WireValue* value = find("transform");
                if (value == nullptr)
                    return std::nullopt;
                return readTransform(*value);
            }

        private:
            [[nodiscard]] const WireValue* find(std::string_view key) const
            {
                for (const auto& [name, value] : properties)
                    if (name == key)
                        return &value;
                return nullptr;
            }

            std::vector<std::pair<std::string, WireValue>> properties;
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

        // The engine's node type for what JavaScript creates. The browser has
        // a canvas's pixels and draws an SVG's scene: here both are image
        // nodes, measured by the natural size JavaScript gives.
        ui::NodeType surfaceType(NodeKind kind)
        {
            switch (kind)
            {
                case NodeKind::View:
                    return ui::NodeType::View;
                case NodeKind::Text:
                    return ui::NodeType::Text;
                case NodeKind::Input:
                    return ui::NodeType::Input;
                case NodeKind::Image:
                case NodeKind::Canvas:
                case NodeKind::Svg:
                    return ui::NodeType::Image;
            }
            throw std::invalid_argument("unknown node type " + std::to_string(static_cast<std::uint32_t>(kind)));
        }

        bool measuredByNaturalSize(NodeKind kind)
        {
            return kind == NodeKind::Image || kind == NodeKind::Canvas || kind == NodeKind::Svg;
        }
    } // namespace

    Engine::Engine(std::shared_ptr<ui::TextEngine> text)
        : naturals(std::make_shared<NaturalSizes>()),
          ui(ui::Surface::Options { .textEngine = std::move(text), .images = naturals })
    {
        nodes = { ui::noNode, ui.root().id(), ui.overlay().id() };
        kinds = { NodeKind::View, NodeKind::View, NodeKind::View };
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
                const auto kind = static_cast<NodeKind>(reader.word());
                if (handle == 0 || (handle < nodes.size() && nodes[handle] != ui::noNode))
                    throw std::invalid_argument("handle " + std::to_string(handle) + " is in use");
                const ui::NodeType type = surfaceType(kind);
                if (handle >= nodes.size())
                {
                    nodes.resize(handle + 1, ui::noNode);
                    kinds.resize(handle + 1, NodeKind::View);
                    reported.resize(handle + 1);
                }
                const ui::NodeId id = ui.createNode(type);
                nodes[handle] = id;
                kinds[handle] = kind;
                if (measuredByNaturalSize(kind))
                {
                    const std::string source = std::to_string(handle);
                    // An HTML canvas's default size, and an SVG's without a scene, as natively.
                    if (kind != NodeKind::Image)
                        naturals->sizes[source] = { 300, 150 };
                    ui.setSource(id, source);
                }
                return;
            }
            case Command::Release:
            {
                const std::uint32_t handle = reader.word();
                if (handle == rootHandle || handle == overlayHandle)
                    throw std::invalid_argument("a root cannot be released");
                ui.releaseNode(node(handle));
                naturals->sizes.erase(std::to_string(handle));
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
            case Command::Check:
            {
                WireStyle style(reader);
                static_cast<void>(ui::readStyle(style));
                return;
            }
            case Command::Text:
            {
                const std::uint32_t handle = reader.word();
                const std::string_view text = reader.text();
                ui.setText(node(handle), std::string(text));
                return;
            }
            case Command::Placeholder:
            {
                const std::uint32_t handle = reader.word();
                const std::string_view text = reader.text();
                ui.setPlaceholder(node(handle), std::string(text));
                return;
            }
            case Command::Natural:
            {
                const std::uint32_t handle = reader.word();
                const float width = reader.real();
                const float height = reader.real();
                const ui::NodeId id = node(handle);
                if (! measuredByNaturalSize(kinds[handle]))
                    throw std::invalid_argument("only images, canvases and SVGs have a natural size");
                const std::string source = std::to_string(handle);
                naturals->sizes[source] = { std::max(0.0f, width), std::max(0.0f, height) };
                // Measured again: the surface sees a new source for a moment.
                ui.setSource(id, {});
                ui.setSource(id, source);
                return;
            }
            case Command::Fonts:
                // Text measures itself again (BrowserTextEngine forgets its widths).
                ui.addFont({}, {}, 400, ui::FontStyle::Normal);
                return;
            case Command::Extent:
                reportExtent(reader.word(), true);
                return;
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

    // A node's content size and client size (Surface::contentSize() and
    // clientSize()): how far a scroll view scrolls. Reported when it changed,
    // or `always`.
    void Engine::reportExtent(std::uint32_t handle, bool always)
    {
        const ui::NodeId id = node(handle);
        const ui::Size content = ui.contentSize(id);
        const ui::Size client = ui.clientSize(id);
        std::vector<std::uint32_t> words { bits(content.width), bits(content.height), bits(client.width),
                                           bits(client.height) };
        Reported& last = reported[handle];
        if (! always && last.extentWords == words)
            return;
        answer.push_back(static_cast<std::uint32_t>(Record::Extent));
        answer.push_back(handle);
        answer.insert(answer.end(), words.begin(), words.end());
        last.extentWords = std::move(words);
    }

    // Each connected node's box, relative to its parent's border box (as
    // soundor:ui's `layout`) and to its padding box (where an absolutely
    // positioned element's offsets start), its borders and padding; a text
    // or input node's lines; and how far a scroll view's content reaches:
    // when they differ from what was last reported.
    void Engine::report()
    {
        std::vector<std::uint32_t> words;
        for (std::uint32_t handle = 1; handle < nodes.size(); ++handle)
        {
            const ui::NodeId id = nodes[handle];
            if (id == ui::noNode)
                continue;
            // Out of the trees: told everything again when it comes back.
            if (! ui.isConnected(id))
            {
                reported[handle] = {};
                continue;
            }
            const ui::Node& node = *ui.find(id);
            const ui::Rect frame = node.frame();
            const ui::Rect padding = node.paddingBox();
            const ui::Rect content = node.contentBox();
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
                      bits(padding.x),
                      bits(content.y - padding.y),
                      bits(padding.x + padding.width - content.x - content.width),
                      bits(padding.y + padding.height - content.y - content.height),
                      bits(content.x - padding.x) };
            Reported& last = reported[handle];
            if (! last.frame || last.frameWords != words)
            {
                answer.push_back(static_cast<std::uint32_t>(Record::Frame));
                answer.push_back(handle);
                answer.insert(answer.end(), words.begin(), words.end());
                last.frame = true;
                last.frameWords = words;
            }

            if (node.scrolls())
                reportExtent(handle, false);

            if (node.type() != ui::NodeType::Text && node.type() != ui::NodeType::Input)
                continue;
            const ui::TextStyle& style = node.style().text;
            const ui::TextLayout& layout = ui.textLayout(id);
            const float lineHeight = style.lineHeight > 0 ? style.lineHeight : style.fontSize * 1.2f;
            words = { bits(style.fontSize), static_cast<std::uint32_t>(style.fontWeight),
                      style.fontStyle == ui::FontStyle::Italic ? 1U : 0U };
            pushText(words, style.fontFamily);
            words.push_back(bits(lineHeight));
            words.push_back(bits(ui.bounds(id).y + content.y));
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
