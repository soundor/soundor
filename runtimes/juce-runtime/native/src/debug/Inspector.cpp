#include <soundor/debug/Inspector.h>

#if SOUNDOR_DEVTOOLS

    #include <algorithm>
    #include <charconv>
    #include <cmath>
    #include <stdexcept>
    #include <type_traits>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
{
    namespace
    {
        using Object = Value::Object;
        using Array = Value::Array;
        std::string quoted(const std::string& text)
        {
            std::string out = "\"";
            constexpr char hex[] = "0123456789abcdef";
            for (const char character : text)
            {
                const auto byte = static_cast<unsigned char>(character);
                if (byte == '"' || byte == '\\')
                {
                    out += '\\';
                    out += character;
                }
                else if (byte < 32)
                {
                    out += "\\u00";
                    out += hex[byte >> 4];
                    out += hex[byte & 15];
                }
                else
                    out += character;
            }
            return out + '"';
        }
        std::string prefix(const std::string& text, std::size_t maximum)
        {
            auto end = std::min(text.size(), maximum);
            while (end < text.size() && end > 0 && (static_cast<unsigned char>(text[end]) & 0xc0) == 0x80)
                --end;
            return text.substr(0, end);
        }
        template <typename T>
        std::string name(T value, std::initializer_list<const char*> names)
        {
            const auto index = static_cast<std::size_t>(value);
            return index < names.size() ? *(names.begin() + static_cast<std::ptrdiff_t>(index)) : "unknown";
        }
        Value rect(ui::Rect box)
        {
            return Object { { "x", box.x }, { "y", box.y }, { "width", box.width }, { "height", box.height } };
        }
        Value length(ui::Length value)
        {
            return Object { { "unit", name(value.unit, { "undefined", "point", "percent", "auto" }) },
                            { "value", value.value } };
        }
        Value edges(const ui::Edges<ui::Length>& value)
        {
            return Object { { "top", length(value.top) },
                            { "right", length(value.right) },
                            { "bottom", length(value.bottom) },
                            { "left", length(value.left) } };
        }
        Value color(ui::Color value)
        {
            return Array { value.r, value.g, value.b, value.a };
        }
        Value style(const ui::Style& value, ui::Rect frame)
        {
            const auto transform = value.transform.transform(frame.width, frame.height);
            return Object {
                { "display", name(value.display, { "flex", "none" }) },
                { "position", name(value.position, { "relative", "absolute", "static" }) },
                { "flexDirection", name(value.flexDirection, { "column", "column-reverse", "row", "row-reverse" }) },
                { "flexGrow", value.flexGrow },
                { "flexShrink", value.flexShrink },
                { "flexBasis", length(value.flexBasis) },
                { "width", length(value.width) },
                { "height", length(value.height) },
                { "minWidth", length(value.minWidth) },
                { "minHeight", length(value.minHeight) },
                { "maxWidth", length(value.maxWidth) },
                { "maxHeight", length(value.maxHeight) },
                { "margin", edges(value.margin) },
                { "padding", edges(value.padding) },
                { "inset", edges(value.inset) },
                { "overflow", name(value.overflow, { "visible", "hidden", "scroll" }) },
                { "pointerEvents", name(value.pointerEvents, { "auto", "none", "box-none", "box-only" }) },
                { "zIndex", value.zIndex },
                { "opacity", value.opacity },
                { "backgroundColor", color(value.backgroundColor) },
                { "borderColor", color(value.borderColor) },
                { "fontFamily", prefix(value.text.fontFamily, 16384) },
                { "fontSize", value.text.fontSize },
                { "fontWeight", value.text.fontWeight },
                { "textColor", color(value.text.color) },
                { "transform", Array { transform.a, transform.b, transform.c, transform.d, transform.e, transform.f } },
            };
        }
        Value layout(ui::Surface& surface, const ui::Node& node)
        {
            const auto scroll = node.scrollOffset();
            return Object { { "frame", rect(node.frame()) },
                            { "bounds", rect(surface.bounds(node.id())) },
                            { "contentBox", rect(node.contentBox()) },
                            { "scrollOffset", Object { { "x", scroll.x }, { "y", scroll.y } } },
                            { "scale", surface.scale() } };
        }
        bool visible(const ui::Node& node)
        {
            for (const ui::Node* current = &node; current; current = current->parent())
                if (current->presentedStyle().display == ui::Display::None || current->presentedStyle().opacity <= 0)
                    return false;
            return true;
        }
        Value accessibility(RuntimeHost& host, const ui::Node& node)
        {
            auto& semantics = host.accessibility();
            (void)semantics.inspect();
            const auto* element = semantics.tree().find(semantics.elementOf(node.id()));
            Object data { { "exposed", element != nullptr }, { "focusable", node.focusable() } };
            if (! element)
                return data;
            std::string role(a11y::roleName(element->role));
            if (role.empty())
            {
                switch (element->role)
                {
                    case a11y::Role::Group:
                        role = "group";
                        break;
                    case a11y::Role::TextInput:
                        role = "textinput";
                        break;
                    case a11y::Role::ScrollView:
                        role = "scrollview";
                        break;
                    case a11y::Role::View:
                        role = "view";
                        break;
                    default:
                        break;
                }
            }
            data["role"] = role;
            data["name"] = prefix(element->label, 16384);
            data["description"] = prefix(element->hint, 16384);
            Object states { { "disabled", element->state.disabled }, { "busy", element->state.busy } };
            if (element->state.checked != a11y::Checked::Unset)
                states["checked"] = name(element->state.checked, { "unset", "false", "true", "mixed" });
            if (element->state.selected)
                states["selected"] = *element->state.selected;
            if (element->state.expanded)
                states["expanded"] = *element->state.expanded;
            data["states"] = states;
            Object value;
            if (element->value.now)
                value["now"] = *element->value.now;
            if (element->value.min)
                value["min"] = *element->value.min;
            if (element->value.max)
                value["max"] = *element->value.max;
            if (! element->value.text.empty())
                value["text"] = prefix(element->value.text, 16384);
            data["value"] = value;
            data["focused"] = semantics.tree().focus() == element->id;
            return data;
        }
        Value ref(unsigned generation, ui::NodeId id)
        {
            return Object { { "generation", generation }, { "id", std::to_string(id) } };
        }
    } // namespace

    std::string Value::json() const
    {
        return std::visit(
            [](const auto& value) -> std::string
            {
                using T = std::decay_t<decltype(value)>;
                if constexpr (std::is_same_v<T, std::nullptr_t>)
                    return "null";
                else if constexpr (std::is_same_v<T, bool>)
                    return value ? "true" : "false";
                else if constexpr (std::is_same_v<T, double>)
                {
                    if (! std::isfinite(value))
                        return "null";
                    char buffer[64];
                    const auto result = std::to_chars(std::begin(buffer), std::end(buffer), value);
                    return std::string(buffer, result.ptr);
                }
                else if constexpr (std::is_same_v<T, std::string>)
                    return quoted(value);
                else
                {
                    std::string out = std::is_same_v<T, Object> ? "{" : "[";
                    bool comma = false;
                    for (const auto& entry : value)
                    {
                        if (std::exchange(comma, true))
                            out += ',';
                        if constexpr (std::is_same_v<T, Object>)
                            out += quoted(entry.first) + ':' + entry.second.json();
                        else
                            out += entry.json();
                    }
                    return out + (std::is_same_v<T, Object> ? '}' : ']');
                }
            },
            data);
    }

    Value Inspector::node(RuntimeHost& host, ui::NodeId id, bool details) const
    {
        auto& surface = host.surface();
        const auto* item = surface.find(id);
        if (! item || ! surface.isConnected(id))
            throw std::invalid_argument("Node was removed or disconnected");
        surface.layout();
        Array children;
        for (const auto* child : item->children())
        {
            if (children.size() >= 5000)
                break;
            children.emplace_back(std::to_string(child->id()));
        }
        Object result {
            { "ref", ref(currentGeneration, id) },
            { "type", name(item->type(), { "View", "Text", "Image", "Scroll", "Input", "Canvas" }) },
            { "parent", item->parent() ? Value(std::to_string(item->parent()->id())) : Value() },
            { "children", children },
            { "bounds", rect(surface.bounds(id)) },
            { "focused", surface.focused() == id },
            { "visible", visible(*item) },
        };
        if (! item->text().empty())
            result["text"] = prefix(item->text(), details ? 16384 : 256);
        if (! details)
        {
            const auto semantics = accessibility(host, *item);
            const auto& fields = std::get<Object>(semantics.data);
            Object summary { { "exposed", fields.at("exposed") } };
            if (fields.contains("role"))
                summary["role"] = fields.at("role");
            if (fields.contains("name"))
                summary["name"] = prefix(std::get<std::string>(fields.at("name").data), 256);
            result["accessibility"] = summary;
        }
        if (details)
        {
            Object properties { { "focusable", item->focusable() },
                                { "textTruncated", item->text().size() > 16384 },
                                { "childrenTruncated", item->children().size() > 5000 } };
            if (item->type() == ui::NodeType::Image)
                properties["source"] = prefix(item->source(), 16384);
            if (item->type() == ui::NodeType::Input)
            {
                properties["placeholder"] = prefix(item->placeholder(), 16384);
                properties["selectionBytes"] =
                    Object { { "anchor", item->selection().anchor }, { "focus", item->selection().focus } };
            }
            if (item->type() == ui::NodeType::Canvas && item->canvas())
            {
                const auto* canvas = item->canvas();
                properties["bufferWidth"] = canvas->gpuImage ? canvas->gpuImage->width() : canvas->pixels.width();
                properties["bufferHeight"] = canvas->gpuImage ? canvas->gpuImage->height() : canvas->pixels.height();
            }
            result["properties"] = properties;
            result["layout"] = layout(surface, *item);
            result["styles"] = Object { { "base", style(item->style(), item->frame()) } };
            result["presentation"] = style(item->presentedStyle(), item->frame());
            result["accessibility"] = accessibility(host, *item);
        }
        return result;
    }

    Value Inspector::tree(RuntimeHost& host) const
    {
        auto& surface = host.surface();
        surface.layout();
        Array nodes;
        std::vector<ui::NodeId> queue { surface.root().id(), surface.overlay().id() };
        std::size_t bytes = 0;
        bool truncated = false;
        for (std::size_t index = 0; index < queue.size(); ++index)
        {
            if (nodes.size() >= 5000)
            {
                truncated = true;
                break;
            }
            Value entry = node(host, queue[index], false);
            const auto size = entry.json().size();
            if (bytes + size > 900000)
            {
                truncated = true;
                break;
            }
            bytes += size;
            nodes.push_back(std::move(entry));
            for (const auto* child : surface.find(queue[index])->children())
            {
                if (queue.size() >= 10000)
                {
                    truncated = true;
                    break;
                }
                queue.push_back(child->id());
            }
        }
        return Object { { "generation", currentGeneration },
                        { "revision", surface.revision() },
                        { "roots",
                          Array { std::to_string(surface.root().id()), std::to_string(surface.overlay().id()) } },
                        { "nodes", std::move(nodes) },
                        { "truncated", truncated } };
    }

    void Inspector::event(const std::string& name, Value data, bool force) const
    {
        if (force || subscribed.contains(name))
            send(Value(Object { { "type", "event" }, { "event", name }, { "data", std::move(data) } }).json());
    }
    void Inspector::resetPicker(ui::Surface& surface)
    {
        surface.debugHighlight(ui::noNode);
        const bool wasPicking = std::exchange(picker, false);
        pressed = ui::noNode;
        if (wasPicking)
            event("UI.pickerChanged", Object { { "enabled", false } });
    }
    void Inspector::reset(ui::Surface& surface)
    {
        resetPicker(surface);
        surface.debugRecording(false);
        const bool hadRecording = profiling || ! frames.empty();
        profiling = false;
        frames.clear();
        phases = Object {};
        frameCount = 0;
        delayedTicks = 0;
        elapsedMs = 0;
        tickIntervalMs = 0;
        if (hadRecording)
            event("Diagnostics.metrics", metrics(false));
    }
    void Inspector::tick(RuntimeHost& host, unsigned generation)
    {
        auto& surface = host.surface();
        if (generation != currentGeneration)
        {
            reset(surface);
            surface.debugMetadataSubscription(subscribed.contains("UI.treeChanged"));
            currentGeneration = generation;
            event("Runtime.generationChanged", Object { { "generation", generation } }, true);
            revision = 0;
            structureRevision = 0;
        }
        if (surface.debugHighlight() != ui::noNode && ! surface.isConnected(surface.debugHighlight()))
            surface.debugHighlight(ui::noNode);
        const auto now = clock();
        surface.animations().debugObserve(subscribed.contains("Animation.changed"));
        if (subscribed.contains("Animation.changed") && now >= nextAnimationNotification)
        {
            bool truncated = false;
            const auto changes = surface.animations().takeDebugChanges(truncated);
            if (! changes.empty() || surface.animations().debugRunning())
            {
                Array records;
                constexpr std::array<const char*, 4> states { "running", "paused", "finished", "cancelled" };
                for (const auto& change : changes)
                    records.emplace_back(Object { { "id", std::to_string(change.id) },
                                                  { "node", ref(currentGeneration, change.node) },
                                                  { "playbackGeneration", change.playbackGeneration },
                                                  { "state", states[static_cast<std::size_t>(change.state)] } });
                event(
                    "Animation.changed",
                    Object { { "generation", currentGeneration }, { "changes", records }, { "truncated", truncated } });
            }
            nextAnimationNotification = now + std::chrono::milliseconds(100);
        }
        profileTick(host);
        if (subscribed.contains("UI.treeChanged") && now >= nextNotification
            && (revision != surface.revision() || lastFocus != surface.focused()))
        {
            bool overflow = false;
            const auto changed = surface.takeDebugMetadataChanges(overflow);
            Array updates;
            std::size_t bytes = 0;
            for (const auto id : changed)
                if (surface.isConnected(id))
                {
                    const auto data = node(host, id, false);
                    bytes += data.json().size();
                    if (bytes > 200000)
                    {
                        overflow = true;
                        break;
                    }
                    updates.push_back(data);
                }
            event(
                "UI.treeChanged",
                Object { { "generation", generation },
                         { "revision", surface.revision() },
                         { "kind", surface.debugStructureRevision() != structureRevision ? "structure" : "properties" },
                         { "nodes", updates },
                         { "metadataIncomplete", overflow } });
            revision = surface.revision();
            structureRevision = surface.debugStructureRevision();
            lastFocus = surface.focused();
            nextNotification = now + std::chrono::milliseconds(100);
        }
    }
    void Inspector::execute(RuntimeHost& host, const Command& command)
    {
        auto& surface = host.surface();
        if (command.method == "subscribe")
        {
            subscribed = command.events;
            surface.debugMetadataSubscription(subscribed.contains("UI.treeChanged"));
            surface.animations().debugObserve(subscribed.contains("Animation.changed"));
            event("UI.pickerChanged", Object { { "enabled", picker } });
            return;
        }
        if (command.method == "resetControl")
        {
            reset(surface);
            return;
        }
        Object response { { "type", "response" }, { "id", command.id } };
        try
        {
            if (command.targetGeneration != 0 && command.targetGeneration != currentGeneration)
                throw std::invalid_argument("Command belongs to an old runtime generation");
            if (command.nodeRequested && command.node == ui::noNode)
                throw std::invalid_argument("Unknown native node reference");
            if ((command.nodeRequested || command.node != ui::noNode) && command.generation != currentGeneration)
                throw std::invalid_argument("Node belongs to an old runtime generation");
            if (command.method == "UI.getTree")
                response["result"] = tree(host);
            else if (command.method == "UI.getNode")
                response["result"] = node(host, command.node);
            else if (command.method == "UI.getLayout" || command.method == "UI.getStyles"
                     || command.method == "UI.getAccessibility")
            {
                (void)node(host, command.node, false);
                const auto& item = *surface.find(command.node);
                if (command.method == "UI.getLayout")
                    response["result"] = layout(surface, item);
                if (command.method == "UI.getStyles")
                    response["result"] = Object { { "base", style(item.style(), item.frame()) },
                                                  { "presentation", style(item.presentedStyle(), item.frame()) } };
                if (command.method == "UI.getAccessibility")
                    response["result"] = accessibility(host, item);
            }
            else if (command.method == "Animation.getActive")
                response["result"] = animations(host, command.node);
            else if (command.method == "Diagnostics.getMetrics")
                response["result"] = metrics();
            else if (command.method == "Diagnostics.setRecording")
            {
                if (command.enabled && ! profiling)
                {
                    frames.clear();
                    phases = Object {};
                    frameCount = 0;
                    delayedTicks = 0;
                    tickIntervalMs = 0;
                    elapsedMs = 0;
                    recordingStarted = clock();
                    previousTick = recordingStarted;
                    previousSample = recordingStarted;
                    previousStatistics = host.statistics();
                }
                if (! command.enabled && profiling)
                    elapsedMs = std::chrono::duration<double, std::milli>(clock() - recordingStarted).count();
                profiling = command.enabled;
                surface.debugRecording(profiling);
                event("Diagnostics.metrics", metrics(false));
                response["result"] = nullptr;
            }
            else if (command.method == "UI.highlightNode")
            {
                (void)node(host, command.node, false);
                surface.debugHighlight(command.node);
                response["result"] = nullptr;
            }
            else if (command.method == "UI.clearHighlight")
            {
                surface.debugHighlight(ui::noNode);
                response["result"] = nullptr;
            }
            else if (command.method == "UI.setPickerEnabled")
            {
                resetPicker(surface);
                if (command.enabled)
                {
                    const auto captured = surface.cancelPointers();
                    suppressedPointers.insert(captured.begin(), captured.end());
                    picker = true;
                }
                event("UI.pickerChanged", Object { { "enabled", picker } });
                response["result"] = nullptr;
            }
            else
                response["error"] = Object { { "code", "MISSING_CAPABILITY" },
                                             { "message", "Operation is not supported by this instance" } };
        }
        catch (const std::invalid_argument& error)
        {
            response["error"] = Object { { "code", "STALE_NODE" }, { "message", std::string(error.what()) } };
        }
        catch (const std::exception&)
        {
            response["error"] = Object { { "code", "INTERNAL" }, { "message", "Native inspection failed" } };
        }
        send(Value(std::move(response)).json());
    }
    bool Inspector::pointer(ui::Surface& surface, const ui::PointerInput& input)
    {
        if (! picker && ! suppressedPointers.contains(input.pointerId))
            return false;
        if (input.phase == ui::PointerInput::Phase::Down)
        {
            suppressedPointers.insert(input.pointerId);
            if (input.button == 0 && picker)
                pressed = surface.hitTest(input.position);
        }
        if (picker && input.phase != ui::PointerInput::Phase::Leave)
            surface.debugHighlight(surface.hitTest(input.position));
        if (input.phase == ui::PointerInput::Phase::Leave && picker)
            surface.debugHighlight(ui::noNode);
        if (input.phase == ui::PointerInput::Phase::Up && input.buttons == 0)
        {
            suppressedPointers.erase(input.pointerId);
            if (picker && pressed != ui::noNode && surface.isConnected(pressed))
            {
                const auto selected = pressed;
                picker = false;
                pressed = ui::noNode;
                surface.debugHighlight(selected);
                event("UI.nodeSelected", Object { { "node", ref(currentGeneration, selected) } });
                event("UI.pickerChanged", Object { { "enabled", false } });
            }
        }
        if (input.phase == ui::PointerInput::Phase::Cancel)
        {
            suppressedPointers.erase(input.pointerId);
            pressed = ui::noNode;
        }
        return true;
    }
    bool Inspector::key(ui::Surface& surface, const ui::KeyInput& input)
    {
        if (input.key != "Escape" || (! picker && ! escapeHeld))
            return false;
        escapeHeld = input.down;
        resetPicker(surface);
        return true;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
#endif
