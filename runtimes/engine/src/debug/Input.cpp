#include <soundor/debug/Inspector.h>

#if SOUNDOR_DEVTOOLS

    #include <algorithm>
    #include <array>
    #include <cmath>
    #include <cstdint>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
{
    namespace
    {
        using Object = Value::Object;
        using Array = Value::Array;

        CommandError invalid(const std::string& message)
        {
            return { "INVALID_REQUEST", message };
        }
        const Value* field(const Object& params, const char* name)
        {
            const auto found = params.find(name);
            return found == params.end() ? nullptr : &found->second;
        }
        std::string text(const Object& params, const char* name)
        {
            const auto* value = field(params, name);
            const auto* out = value ? std::get_if<std::string>(&value->data) : nullptr;
            if (! out)
                throw invalid(std::string(name) + " must be a string");
            return *out;
        }
        std::optional<float> coordinate(const Object& params, const char* name)
        {
            const auto* value = field(params, name);
            if (! value)
                return {};
            const auto* number = std::get_if<double>(&value->data);
            if (! number || ! std::isfinite(*number) || std::abs(*number) > 1e6)
                throw invalid(std::string(name) + " must be a finite number");
            return static_cast<float>(*number);
        }
        ui::Modifiers modifierOf(std::string_view name)
        {
            if (name == "Shift")
                return ui::Modifier::Shift;
            if (name == "Control")
                return ui::Modifier::Control;
            if (name == "Alt")
                return ui::Modifier::Alt;
            if (name == "Meta")
                return ui::Modifier::Meta;
            return 0;
        }
        ui::Modifiers modifiers(const Object& params)
        {
            ui::Modifiers out = 0;
            const auto* value = field(params, "modifiers");
            if (! value)
                return out;
            const auto* list = std::get_if<Array>(&value->data);
            if (! list)
                throw invalid("modifiers must be an array");
            for (const auto& item : *list)
            {
                const auto* name = std::get_if<std::string>(&item.data);
                const auto bit = name ? modifierOf(*name) : 0;
                if (bit == 0)
                    throw invalid("modifiers are Shift, Control, Alt and Meta");
                out |= bit;
            }
            return out;
        }
        Value ref(unsigned generation, ui::NodeId id)
        {
            if (id == ui::noNode)
                return nullptr;
            return Object { { "generation", generation }, { "id", std::to_string(id) } };
        }
        // The code points of UTF-8 text, each as its own UTF-8; nothing when
        // the text is not UTF-8.
        std::optional<std::vector<std::string>> codePoints(const std::string& value)
        {
            std::vector<std::string> out;
            for (std::size_t at = 0; at < value.size();)
            {
                const auto lead = static_cast<unsigned char>(value[at]);
                const std::size_t length = lead < 0x80                   ? 1
                                           : lead >= 0xf0 && lead < 0xf5 ? 4
                                           : lead >= 0xe0                ? 3
                                           : lead >= 0xc2                ? 2
                                                                         : 0;
                if (length == 0 || at + length > value.size())
                    return {};
                for (std::size_t i = 1; i < length; ++i)
                    if ((static_cast<unsigned char>(value[at + i]) & 0xc0) != 0x80)
                        return {};
                out.push_back(value.substr(at, length));
                at += length;
            }
            return out;
        }
        // What a key types when the UI does not handle it, as a keyboard
        // would: a printable character, unless a shortcut modifier is held.
        std::string typedText(const std::string& key, ui::Modifiers held)
        {
            if ((held & (ui::Modifier::Control | ui::Modifier::Meta)) != 0)
                return {};
            const auto points = codePoints(key);
            if (! points || points->size() != 1)
                return {};
            const auto first = static_cast<unsigned char>(key[0]);
            return first < 32 || first == 127 ? std::string() : key;
        }
        struct Button
        {
            int index;
            unsigned bit;
        };
        Button button(const Object& params)
        {
            const auto* value = field(params, "button");
            const auto* name = value ? std::get_if<std::string>(&value->data) : nullptr;
            if (! value || (name && *name == "left"))
                return { 0, 1 };
            if (name && *name == "right")
                return { 2, 2 };
            if (name && *name == "middle")
                return { 1, 4 };
            throw invalid("button is left, middle or right");
        }
    } // namespace

    Value Inspector::input(RuntimeHost& host, const Command& command)
    {
        auto& surface = host.surface();
        const auto& params = command.params;
        const auto settle = [&] { host.runtime().runPendingJobs(); };
        ui::Modifiers held = 0;
        for (const auto& key : synthetic.keys)
            held |= modifierOf(key);
        if (command.method == "UI.hitTest")
        {
            const auto x = coordinate(params, "x");
            const auto y = coordinate(params, "y");
            if (! x || ! y)
                throw invalid("x and y are required");
            surface.layout();
            const auto hit = surface.hitTest({ *x, *y });
            Array path;
            for (const auto* node = surface.find(hit); node && path.size() < 512; node = node->parent())
                path.emplace_back(std::to_string(node->id()));
            std::ranges::reverse(path);
            return Object { { "node", ref(currentGeneration, hit) }, { "path", std::move(path) } };
        }
        if (command.method == "Input.dispatchPointer")
        {
            const auto action = text(params, "action");
            const auto x = coordinate(params, "x");
            const auto y = coordinate(params, "y");
            if (x.has_value() != y.has_value())
                throw invalid("give both x and y, or neither");
            if (x)
                synthetic.position = { *x, *y };
            else if ((action == "down" || action == "up") && ! synthetic.present)
                throw invalid("move the pointer before pressing a button");
            const auto mods = static_cast<ui::Modifiers>(modifiers(params) | held);
            const auto pointer = [&](ui::PointerInput::Phase phase, int index = -1)
            {
                const bool handled = surface.pointer({ .phase = phase,
                                                       .position = synthetic.position,
                                                       .pointerId = automationPointer,
                                                       .type = ui::PointerType::Mouse,
                                                       .button = index,
                                                       .buttons = synthetic.buttons,
                                                       .modifiers = mods });
                settle();
                return handled;
            };
            bool handled = false;
            if (action == "cancel")
            {
                if (synthetic.present)
                    handled = pointer(ui::PointerInput::Phase::Cancel);
                synthetic.present = false;
                synthetic.buttons = 0;
                return Object { { "handled", handled }, { "node", nullptr } };
            }
            const auto which = button(params);
            if (action == "move")
                handled = pointer(ui::PointerInput::Phase::Move);
            else if (action == "down" || action == "click")
            {
                if ((synthetic.buttons & which.bit) != 0)
                    throw invalid("the button is already down");
                if (action == "click" || ! synthetic.present)
                    pointer(ui::PointerInput::Phase::Move);
                synthetic.buttons |= which.bit;
                handled = pointer(ui::PointerInput::Phase::Down, which.index);
                if (action == "click")
                {
                    synthetic.buttons &= ~which.bit;
                    handled = pointer(ui::PointerInput::Phase::Up, which.index) || handled;
                }
            }
            else if (action == "up")
            {
                if ((synthetic.buttons & which.bit) == 0)
                    throw invalid("the button is not down");
                synthetic.buttons &= ~which.bit;
                handled = pointer(ui::PointerInput::Phase::Up, which.index);
            }
            else
                throw invalid("action is move, down, up, click or cancel");
            synthetic.present = true;
            return Object { { "handled", handled },
                            { "node", ref(currentGeneration, surface.hitTest(synthetic.position)) } };
        }
        if (command.method == "Input.dispatchWheel")
        {
            const auto x = coordinate(params, "x");
            const auto y = coordinate(params, "y");
            const auto deltaX = coordinate(params, "deltaX");
            const auto deltaY = coordinate(params, "deltaY");
            if (! x || ! y || ! deltaX || ! deltaY)
                throw invalid("x, y, deltaX and deltaY are required");
            const bool handled = surface.wheel({ .position = { *x, *y },
                                                 .deltaX = *deltaX,
                                                 .deltaY = *deltaY,
                                                 .unit = ui::WheelInput::Unit::Pixel,
                                                 .modifiers = static_cast<ui::Modifiers>(modifiers(params) | held) });
            settle();
            return Object { { "handled", handled }, { "node", ref(currentGeneration, surface.hitTest({ *x, *y })) } };
        }
        if (command.method == "Input.dispatchKey" || command.method == "Input.typeText")
        {
            const auto explicitModifiers = command.method == "Input.dispatchKey" ? modifiers(params) : ui::Modifiers {};
            const auto press = [&](const std::string& key, bool down)
            {
                if (key.empty() || key.size() > 32)
                    throw invalid("key must be a KeyboardEvent key name");
                // A modifier is held for its own keydown, as on the Web.
                const auto own = modifierOf(key);
                const bool repeat = down && synthetic.keys.contains(key);
                if (down)
                    synthetic.keys.insert(key);
                else
                    synthetic.keys.erase(key);
                ui::Modifiers mods = explicitModifiers | (down ? own : 0);
                for (const auto& name : synthetic.keys)
                    mods |= modifierOf(name);
                const ui::KeyInput input { .down = down, .key = key, .repeat = repeat, .modifiers = mods };
                const bool handled = surface.key(input, down ? typedText(key, mods) : std::string());
                settle();
                return handled;
            };
            bool handled = false;
            if (command.method == "Input.typeText")
            {
                const auto value = text(params, "text");
                const auto points = codePoints(value);
                if (! points || points->empty() || points->size() > 1024)
                    throw invalid("text must be 1 to 1024 characters of UTF-8");
                for (const auto& point : *points)
                {
                    handled = press(point, true) || handled;
                    handled = press(point, false) || handled;
                }
            }
            else
            {
                const auto key = text(params, "key");
                const auto action = text(params, "action");
                if (action == "down" || action == "press")
                    handled = press(key, true);
                if (action == "up" || action == "press")
                {
                    if (action == "up" && ! synthetic.keys.contains(key))
                        throw invalid("the key is not down");
                    handled = press(key, false) || handled;
                }
                if (action != "down" && action != "up" && action != "press")
                    throw invalid("action is down, up or press");
            }
            return Object { { "handled", handled }, { "node", ref(currentGeneration, surface.focused()) } };
        }
        if (command.method == "Input.focus")
        {
            (void)node(host, command.node, false);
            const auto* item = surface.find(command.node);
            if (! item->focusable())
                throw CommandError("NOT_ACTIONABLE", "The node is not focusable");
            surface.focus(command.node);
            settle();
            return nullptr;
        }
        throw CommandError("MISSING_CAPABILITY", "Operation is not supported by this instance");
    }

    void Inspector::resetInput(ui::Surface* surface)
    {
        auto held = std::exchange(synthetic, {});
        if (! surface)
            return;
        // Nothing stays pressed: the press ends without a click.
        if (held.present)
            surface->pointer({ .phase = ui::PointerInput::Phase::Cancel, .pointerId = automationPointer });
        for (const auto& key : held.keys)
            surface->key(ui::KeyInput { .down = false, .key = key });
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
#endif
