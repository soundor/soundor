#include "a11y/windows/Uia.h"

#include "a11y/PlatformSupport.h"

#include <soundor/runtime/RuntimeHost.h>

#include <commctrl.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <functional>
#include <limits>
#include <mutex>
#include <new>
#include <unordered_map>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::uia
{
    namespace
    {
        CONTROLTYPEID controlType(Role role)
        {
            switch (role)
            {
                case Role::Text:
                    return UIA_TextControlTypeId;
                case Role::Image:
                    return UIA_ImageControlTypeId;
                case Role::Button:
                case Role::ToggleButton:
                case Role::KeyboardKey:
                    return UIA_ButtonControlTypeId;
                case Role::Link:
                    return UIA_HyperlinkControlTypeId;
                case Role::Adjustable:
                    return UIA_SliderControlTypeId;
                case Role::CheckBox:
                case Role::Switch:
                    return UIA_CheckBoxControlTypeId;
                case Role::Radio:
                    return UIA_RadioButtonControlTypeId;
                case Role::ProgressBar:
                    return UIA_ProgressBarControlTypeId;
                case Role::ComboBox:
                    return UIA_ComboBoxControlTypeId;
                case Role::Menu:
                    return UIA_MenuControlTypeId;
                case Role::MenuBar:
                    return UIA_MenuBarControlTypeId;
                case Role::MenuItem:
                    return UIA_MenuItemControlTypeId;
                case Role::ScrollBar:
                    return UIA_ScrollBarControlTypeId;
                case Role::SpinButton:
                    return UIA_SpinnerControlTypeId;
                case Role::Tab:
                    return UIA_TabItemControlTypeId;
                case Role::TabList:
                    return UIA_TabControlTypeId;
                case Role::Header:
                    return UIA_HeaderControlTypeId;
                case Role::Toolbar:
                    return UIA_ToolBarControlTypeId;
                case Role::TextInput:
                    return UIA_EditControlTypeId;
                case Role::ScrollView:
                case Role::View:
                    return UIA_PaneControlTypeId;
                case Role::None:
                case Role::RadioGroup:
                case Role::Search:
                case Role::Summary:
                case Role::Timer:
                case Role::Alert:
                case Role::Dialog:
                case Role::Group:
                    return UIA_GroupControlTypeId;
            }
            return UIA_GroupControlTypeId;
        }

        bool range(const Node& node)
        {
            return node.value.now && node.value.min && node.value.max;
        }
        bool selectable(const Node& node)
        {
            return node.state.selected.has_value() || node.role == Role::Radio;
        }
        bool selection(const Node& node)
        {
            return node.role == Role::RadioGroup || node.role == Role::TabList;
        }
        bool toggled(const Node& node)
        {
            return node.state.checked != Checked::Unset && node.role != Role::Radio;
        }

        ToggleState toggleState(const Node& node)
        {
            return node.state.checked == Checked::Mixed  ? ToggleState_Indeterminate
                   : node.state.checked == Checked::True ? ToggleState_On
                                                         : ToggleState_Off;
        }
        bool selected(const Node& node)
        {
            return node.state.selected.value_or(node.state.checked == Checked::True);
        }

        HRESULT stringValue(const std::string& text, BSTR* out)
        {
            const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
            *out = SysAllocStringLen(nullptr, static_cast<UINT>(size));
            if (*out == nullptr)
                return E_OUTOFMEMORY;
            MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), *out, size);
            return S_OK;
        }

        UiaRect screenBounds(const Node& node, const ViewGeometry& geometry, POINT origin)
        {
            return { static_cast<double>(origin.x) + geometry.x + node.bounds.x * geometry.scale,
                     static_cast<double>(origin.y) + geometry.y + node.bounds.y * geometry.scale,
                     node.bounds.width * geometry.scale, node.bounds.height * geometry.scale };
        }

        HRESULT rectangleValue(const UiaRect& rect, VARIANT* out)
        {
            SAFEARRAY* array = SafeArrayCreateVector(VT_R8, 0, 4);
            if (array == nullptr)
                return E_OUTOFMEMORY;
            double values[] = { rect.left, rect.top, rect.width, rect.height };
            for (LONG i = 0; i < 4; ++i)
                SafeArrayPutElement(array, &i, &values[i]);
            out->vt = VT_ARRAY | VT_R8;
            out->parray = array;
            return S_OK;
        }

        // Every COM entry point that allocates or takes a mutex is guarded.
        // No C++ exception crosses the Windows ABI.
        template <typename F>
        HRESULT guarded(F&& body) noexcept
        {
            try
            {
                return body();
            }
            catch (const std::bad_alloc&)
            {
                return E_OUTOFMEMORY;
            }
            catch (...)
            {
                return E_FAIL;
            }
        }

        struct Variant
        {
            Variant() { VariantInit(&value); }
            ~Variant() { VariantClear(&value); }
            Variant(const Variant&) = delete;
            Variant& operator=(const Variant&) = delete;
            VARIANT value;
        };
    } // namespace

    std::vector<PROPERTYID> changedProperties(const Node& before, const Node& after)
    {
        std::vector<PROPERTYID> properties;
        const auto changed = [&](bool different, PROPERTYID property)
        {
            if (different)
                properties.push_back(property);
        };
        changed(before.role != after.role, UIA_ControlTypePropertyId);
        changed(before.label != after.label, UIA_NamePropertyId);
        changed(before.hint != after.hint, UIA_HelpTextPropertyId);
        changed(before.hint != after.hint, UIA_FullDescriptionPropertyId);
        changed(before.state.disabled != after.state.disabled, UIA_IsEnabledPropertyId);
        changed(before.focusable != after.focusable || before.state.disabled != after.state.disabled,
                UIA_IsKeyboardFocusablePropertyId);
        changed(before.state.busy != after.state.busy, UIA_ItemStatusPropertyId);
        changed(before.state.checked != after.state.checked, UIA_ToggleToggleStatePropertyId);
        changed(selected(before) != selected(after), UIA_SelectionItemIsSelectedPropertyId);
        changed(before.state.expanded != after.state.expanded, UIA_ExpandCollapseExpandCollapseStatePropertyId);
        changed(before.modal != after.modal || before.role != after.role, UIA_IsDialogPropertyId);
        if (after.supports(Action::SetValue))
        {
            changed(before.value.text != after.value.text, UIA_ValueValuePropertyId);
            changed(before.value.now != after.value.now, UIA_RangeValueValuePropertyId);
        }
        changed(before.value.min != after.value.min, UIA_RangeValueMinimumPropertyId);
        changed(before.value.max != after.value.max, UIA_RangeValueMaximumPropertyId);
        changed(before.bounds != after.bounds, UIA_BoundingRectanglePropertyId);
        changed((before.bounds.width <= 0 || before.bounds.height <= 0)
                    != (after.bounds.width <= 0 || after.bounds.height <= 0),
                UIA_IsOffscreenPropertyId);
        return properties;
    }

    struct Session::State
    {
        std::mutex mutex;
        Tree tree;
        std::unordered_map<NodeId, Provider*> providers; // owns one COM reference each
        std::vector<ActionRequest> requests;
        HWND window = nullptr;
        Microsoft::WRL::ComPtr<IRawElementProviderSimple> hostProvider;
        std::string name;
        ViewGeometry geometry;
        POINT origin {};
        GUID identity {};
        bool focused = false;
        bool alive = true;
        bool listening = false;

        // Caller holds mutex. Zero is the persistent HWND fragment root,
        // independent of the RuntimeHost's root (which changes on reload).
        Provider* element(const std::shared_ptr<State>& owner, NodeId id);
        const Node* node(NodeId id) const { return tree.find(id == noNode ? tree.root() : id); }
        NodeId key(NodeId id) const { return id == tree.root() ? noNode : id; }
        UiaRect bounds(const Node& node) const { return screenBounds(node, geometry, origin); }
    };

    class Session::Provider final : public IRawElementProviderSimple,
                                    public IRawElementProviderFragment,
                                    public IRawElementProviderFragmentRoot,
                                    public IInvokeProvider,
                                    public IValueProvider,
                                    public IRangeValueProvider,
                                    public IToggleProvider,
                                    public ISelectionProvider,
                                    public ISelectionItemProvider,
                                    public IExpandCollapseProvider
    {
    public:
        Provider(std::shared_ptr<State> owner, NodeId key) : state(std::move(owner)), id(key) {}

        HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            if (iid == __uuidof(IUnknown) || iid == __uuidof(IRawElementProviderSimple))
                *out = static_cast<IRawElementProviderSimple*>(this);
            else if (iid == __uuidof(IRawElementProviderFragment))
                *out = static_cast<IRawElementProviderFragment*>(this);
            else if (iid == __uuidof(IRawElementProviderFragmentRoot) && id == noNode)
                *out = static_cast<IRawElementProviderFragmentRoot*>(this);
            else if (iid == __uuidof(IInvokeProvider))
                *out = static_cast<IInvokeProvider*>(this);
            else if (iid == __uuidof(IValueProvider))
                *out = static_cast<IValueProvider*>(this);
            else if (iid == __uuidof(IRangeValueProvider))
                *out = static_cast<IRangeValueProvider*>(this);
            else if (iid == __uuidof(IToggleProvider))
                *out = static_cast<IToggleProvider*>(this);
            else if (iid == __uuidof(ISelectionProvider))
                *out = static_cast<ISelectionProvider*>(this);
            else if (iid == __uuidof(ISelectionItemProvider))
                *out = static_cast<ISelectionItemProvider*>(this);
            else if (iid == __uuidof(IExpandCollapseProvider))
                *out = static_cast<IExpandCollapseProvider*>(this);
            else
                return E_NOINTERFACE;
            AddRef();
            return S_OK;
        }
        ULONG STDMETHODCALLTYPE AddRef() override { return ++references; }
        ULONG STDMETHODCALLTYPE Release() override
        {
            const ULONG left = --references;
            if (left == 0)
                delete this;
            return left;
        }

        HRESULT STDMETHODCALLTYPE get_ProviderOptions(ProviderOptions* out) override
        {
            if (out == nullptr)
                return E_POINTER;
            // UIA may call on any thread. We implement our own synchronization,
            // so do not ask COM to marshal queries back to the editor's STA.
            *out = ProviderOptions_ServerSideProvider;
            return S_OK;
        }
        HRESULT STDMETHODCALLTYPE GetPatternProvider(PATTERNID pattern, IUnknown** out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            return read(
                [&](const Node& node)
                {
                    if (pattern == UIA_InvokePatternId && node.supports(Action::Activate) && ! toggled(node)
                        && ! selectable(node))
                        *out = static_cast<IInvokeProvider*>(this);
                    else if (pattern == UIA_ValuePatternId
                             && (node.role == Role::TextInput || ! node.value.text.empty()))
                        *out = static_cast<IValueProvider*>(this);
                    else if (pattern == UIA_RangeValuePatternId && range(node))
                        *out = static_cast<IRangeValueProvider*>(this);
                    else if (pattern == UIA_TogglePatternId && toggled(node))
                        *out = static_cast<IToggleProvider*>(this);
                    else if (pattern == UIA_SelectionPatternId && selection(node))
                        *out = static_cast<ISelectionProvider*>(this);
                    else if (pattern == UIA_SelectionItemPatternId && selectable(node))
                        *out = static_cast<ISelectionItemProvider*>(this);
                    else if (pattern == UIA_ExpandCollapsePatternId && node.state.expanded)
                        *out = static_cast<IExpandCollapseProvider*>(this);
                    if (*out != nullptr)
                        AddRef();
                    return S_OK;
                });
        }
        HRESULT STDMETHODCALLTYPE GetPropertyValue(PROPERTYID property, VARIANT* out) override
        {
            if (out == nullptr)
                return E_POINTER;
            VariantInit(out);
            return read([&](const Node& node) { return propertyValue(node, property, out); });
        }
        HRESULT STDMETHODCALLTYPE get_HostRawElementProvider(IRawElementProviderSimple** out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            Microsoft::WRL::ComPtr<IRawElementProviderSimple> host;
            const HRESULT result = read(
                [&](const Node&)
                {
                    if (id == noNode)
                        host = state->hostProvider;
                    return S_OK;
                });
            *out = host.Detach();
            return result;
        }

        HRESULT STDMETHODCALLTYPE Navigate(NavigateDirection direction, IRawElementProviderFragment** out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            return read(
                [&](const Node& node)
                {
                    NodeId target = noNode;
                    const Tree& tree = state->tree;
                    if (direction == NavigateDirection_Parent)
                        target = tree.parent(node.id);
                    else if (direction == NavigateDirection_FirstChild && ! node.children.empty())
                        target = node.children.front();
                    else if (direction == NavigateDirection_LastChild && ! node.children.empty())
                        target = node.children.back();
                    else if (direction == NavigateDirection_NextSibling
                             || direction == NavigateDirection_PreviousSibling)
                    {
                        if (const Node* parent = tree.find(tree.parent(node.id)))
                        {
                            const auto found = std::ranges::find(parent->children, node.id);
                            if (found != parent->children.end())
                            {
                                if (direction == NavigateDirection_NextSibling && found + 1 != parent->children.end())
                                    target = *(found + 1);
                                else if (direction == NavigateDirection_PreviousSibling
                                         && found != parent->children.begin())
                                    target = *(found - 1);
                            }
                        }
                    }
                    return fragment(target, out);
                });
        }
        HRESULT STDMETHODCALLTYPE GetRuntimeId(SAFEARRAY** out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            return read(
                [&](const Node&)
                {
                    if (id == noNode)
                        return S_OK; // HWND supplies the root's ID.
                    // Include an editor GUID: node counters in independently linked
                    // engines can overlap, and Windows may reuse an HWND.
                    const auto& guid = state->identity;
                    const int values[] = {
                        UiaAppendRuntimeId,
                        static_cast<int>(guid.Data1),
                        static_cast<int>((static_cast<unsigned>(guid.Data2) << 16) | guid.Data3),
                        static_cast<int>((static_cast<unsigned>(guid.Data4[0]) << 24)
                                         | (static_cast<unsigned>(guid.Data4[1]) << 16)
                                         | (static_cast<unsigned>(guid.Data4[2]) << 8) | guid.Data4[3]),
                        static_cast<int>((static_cast<unsigned>(guid.Data4[4]) << 24)
                                         | (static_cast<unsigned>(guid.Data4[5]) << 16)
                                         | (static_cast<unsigned>(guid.Data4[6]) << 8) | guid.Data4[7]),
                        static_cast<int>(id >> 32),
                        static_cast<int>(id & 0xffffffffU)
                    };
                    *out = SafeArrayCreateVector(VT_I4, 0, static_cast<ULONG>(std::size(values)));
                    if (*out == nullptr)
                        return E_OUTOFMEMORY;
                    for (LONG i = 0; i < static_cast<LONG>(std::size(values)); ++i)
                        SafeArrayPutElement(*out, &i, const_cast<int*>(&values[i]));
                    return S_OK;
                });
        }
        HRESULT STDMETHODCALLTYPE get_BoundingRectangle(UiaRect* out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = {};
            return read(
                [&](const Node& node)
                {
                    *out = state->bounds(node);
                    return S_OK;
                });
        }
        HRESULT STDMETHODCALLTYPE GetEmbeddedFragmentRoots(SAFEARRAY** out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            return read([](const Node&) { return S_OK; });
        }
        HRESULT STDMETHODCALLTYPE SetFocus() override { return ask(Action::Focus); }
        HRESULT STDMETHODCALLTYPE get_FragmentRoot(IRawElementProviderFragmentRoot** out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            return read(
                [&](const Node&)
                {
                    auto* root = state->element(state, noNode);
                    root->AddRef();
                    *out = root;
                    return S_OK;
                });
        }
        HRESULT STDMETHODCALLTYPE ElementProviderFromPoint(double x, double y,
                                                           IRawElementProviderFragment** out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            return read(
                [&](const Node&)
                {
                    std::function<NodeId(NodeId)> hit = [&](NodeId target) -> NodeId
                    {
                        const Node* node = state->tree.find(target);
                        if (node == nullptr)
                            return noNode;
                        // Reverse paint order; children may overflow their parent.
                        for (auto child = node->children.rbegin(); child != node->children.rend(); ++child)
                            if (const NodeId found = hit(*child); found != noNode)
                                return found;
                        const UiaRect rect = state->bounds(*node);
                        return x >= rect.left && x < rect.left + rect.width && y >= rect.top
                                       && y < rect.top + rect.height
                                   ? target
                                   : noNode;
                    };
                    return fragment(hit(state->tree.root()), out);
                });
        }
        HRESULT STDMETHODCALLTYPE GetFocus(IRawElementProviderFragment** out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            return read([&](const Node&) { return fragment(state->focused ? focus() : noNode, out); });
        }
        HRESULT STDMETHODCALLTYPE Invoke() override { return ask(Action::Activate); }
        HRESULT STDMETHODCALLTYPE SetValue(LPCWSTR value) override
        {
            if (value == nullptr)
                return E_INVALIDARG;
            return guarded(
                [&]
                {
                    const int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
                    if (size <= 0)
                        return E_INVALIDARG;
                    std::string text(static_cast<std::size_t>(size), '\0');
                    WideCharToMultiByte(CP_UTF8, 0, value, -1, text.data(), size, nullptr, nullptr);
                    text.pop_back();
                    return ask(Action::SetValue, std::move(text));
                });
        }
        HRESULT STDMETHODCALLTYPE get_Value(BSTR* out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            return read([&](const Node& node) { return stringValue(node.value.text, out); });
        }
        HRESULT STDMETHODCALLTYPE get_IsReadOnly(BOOL* out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = TRUE;
            return read(
                [&](const Node& node)
                {
                    *out = ! node.supports(Action::SetValue);
                    return S_OK;
                });
        }
        HRESULT STDMETHODCALLTYPE SetValue(double value) override
        {
            return read(
                [&](const Node& node)
                {
                    if (! std::isfinite(value) || ! range(node) || value < *node.value.min || value > *node.value.max)
                        return E_INVALIDARG;
                    return enqueue(node, Action::SetValue, value);
                });
        }
        HRESULT STDMETHODCALLTYPE get_Value(double* out) override { return number(out, &Value::now); }
        HRESULT STDMETHODCALLTYPE get_Maximum(double* out) override { return number(out, &Value::max); }
        HRESULT STDMETHODCALLTYPE get_Minimum(double* out) override { return number(out, &Value::min); }
        // The semantic contract has no step size. UIA specifies NaN when unknown.
        HRESULT STDMETHODCALLTYPE get_LargeChange(double* out) override { return change(out); }
        HRESULT STDMETHODCALLTYPE get_SmallChange(double* out) override { return change(out); }
        HRESULT STDMETHODCALLTYPE Toggle() override { return ask(Action::Activate); }
        HRESULT STDMETHODCALLTYPE get_ToggleState(ToggleState* out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = ToggleState_Off;
            return read(
                [&](const Node& node)
                {
                    *out = toggleState(node);
                    return S_OK;
                });
        }
        HRESULT STDMETHODCALLTYPE Select() override
        {
            return read([&](const Node& node) { return selected(node) ? S_OK : enqueue(node, Action::Activate); });
        }
        HRESULT STDMETHODCALLTYPE AddToSelection() override
        {
            return read(
                [&](const Node& node)
                {
                    if (selected(node))
                        return S_OK;
                    if (const Node* container = selectionContainer(node))
                        for (const NodeId child : container->children)
                            if (const Node* sibling = state->tree.find(child); sibling != nullptr && selected(*sibling))
                                return UIA_E_INVALIDOPERATION;
                    return enqueue(node, Action::Activate);
                });
        }
        HRESULT STDMETHODCALLTYPE RemoveFromSelection() override
        {
            return read(
                [&](const Node& node)
                {
                    if (! selected(node))
                        return S_OK;
                    return selectionContainer(node) != nullptr ? UIA_E_INVALIDOPERATION
                                                               : enqueue(node, Action::Activate);
                });
        }

        HRESULT STDMETHODCALLTYPE get_IsSelected(BOOL* out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = FALSE;
            return read(
                [&](const Node& node)
                {
                    *out = selected(node);
                    return S_OK;
                });
        }
        HRESULT STDMETHODCALLTYPE get_SelectionContainer(IRawElementProviderSimple** out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            return read(
                [&](const Node& node)
                {
                    if (const Node* container = selectionContainer(node))
                    {
                        *out = state->element(state, state->key(container->id));
                        (*out)->AddRef();
                    }
                    return S_OK;
                });
        }
        HRESULT STDMETHODCALLTYPE GetSelection(SAFEARRAY** out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = nullptr;
            return read(
                [&](const Node& node)
                {
                    std::vector<NodeId> chosen;
                    for (const NodeId child : node.children)
                        if (const Node* item = state->tree.find(child);
                            item != nullptr && selectable(*item) && selected(*item))
                            chosen.push_back(child);
                    std::unique_ptr<SAFEARRAY, decltype(&SafeArrayDestroy)> array(
                        SafeArrayCreateVector(VT_UNKNOWN, 0, static_cast<ULONG>(chosen.size())), SafeArrayDestroy);
                    if (array == nullptr)
                        return E_OUTOFMEMORY;
                    for (LONG i = 0; i < static_cast<LONG>(chosen.size()); ++i)
                    {
                        auto* item = static_cast<IRawElementProviderSimple*>(
                            state->element(state, chosen[static_cast<std::size_t>(i)]));
                        SafeArrayPutElement(array.get(), &i, item);
                    }
                    *out = array.release();
                    return S_OK;
                });
        }
        HRESULT STDMETHODCALLTYPE get_CanSelectMultiple(BOOL* out) override { return selectionFlag(out, false); }
        HRESULT STDMETHODCALLTYPE get_IsSelectionRequired(BOOL* out) override { return selectionFlag(out, true); }
        HRESULT STDMETHODCALLTYPE Expand() override { return ask(Action::Expand); }
        HRESULT STDMETHODCALLTYPE Collapse() override { return ask(Action::Collapse); }
        HRESULT STDMETHODCALLTYPE get_ExpandCollapseState(ExpandCollapseState* out) override
        {
            if (out == nullptr)
                return E_POINTER;
            *out = ExpandCollapseState_LeafNode;
            return read(
                [&](const Node& node)
                {
                    if (node.state.expanded)
                        *out = *node.state.expanded ? ExpandCollapseState_Expanded : ExpandCollapseState_Collapsed;
                    return S_OK;
                });
        }

        // Called only with state->mutex held, including by event collection.
        HRESULT propertyValue(const Node& node, PROPERTYID property, VARIANT* out) const
        {
            const auto boolean = [&](bool value)
            {
                out->vt = VT_BOOL;
                out->boolVal = value ? VARIANT_TRUE : VARIANT_FALSE;
                return S_OK;
            };
            const auto integer = [&](int value)
            {
                out->vt = VT_I4;
                out->lVal = value;
                return S_OK;
            };
            const auto text = [&](const std::string& value)
            {
                out->vt = VT_BSTR;
                return stringValue(value, &out->bstrVal);
            };
            switch (property)
            {
                case UIA_BoundingRectanglePropertyId:
                    return rectangleValue(state->bounds(node), out);
                case UIA_ControlTypePropertyId:
                    return integer(controlType(node.role));
                case UIA_NamePropertyId:
                    return text(node.label.empty() && id == noNode ? state->name : node.label);
                case UIA_HelpTextPropertyId:
                    return text(node.hint);
                case UIA_FullDescriptionPropertyId:
                    return text(node.hint);
                case UIA_ItemStatusPropertyId:
                    return text(node.state.busy ? "Busy" : "");
                case UIA_FrameworkIdPropertyId:
                    return text("Soundor");
                case UIA_AutomationIdPropertyId:
                    return text(std::to_string(node.id));
                case UIA_IsControlElementPropertyId:
                case UIA_IsContentElementPropertyId:
                    return boolean(true);
                case UIA_IsEnabledPropertyId:
                    return boolean(! node.state.disabled);
                case UIA_IsKeyboardFocusablePropertyId:
                    return boolean(node.focusable && ! node.state.disabled);
                case UIA_HasKeyboardFocusPropertyId:
                    return boolean(state->focused && node.id == focus());
                case UIA_IsPasswordPropertyId:
                    return boolean(false);
                case UIA_IsOffscreenPropertyId:
                    return boolean(node.bounds.width <= 0 || node.bounds.height <= 0);
                case UIA_ValueValuePropertyId:
                    return text(node.value.text);
                case UIA_ValueIsReadOnlyPropertyId:
                case UIA_RangeValueIsReadOnlyPropertyId:
                    return boolean(! node.supports(Action::SetValue));
                case UIA_RangeValueValuePropertyId:
                case UIA_RangeValueMinimumPropertyId:
                case UIA_RangeValueMaximumPropertyId:
                    out->vt = VT_R8;
                    out->dblVal = (property == UIA_RangeValueValuePropertyId     ? node.value.now
                                   : property == UIA_RangeValueMinimumPropertyId ? node.value.min
                                                                                 : node.value.max)
                                      .value_or(0);
                    return S_OK;
                case UIA_ToggleToggleStatePropertyId:
                    return integer(toggleState(node));
                case UIA_SelectionItemIsSelectedPropertyId:
                    return boolean(selected(node));
                case UIA_ExpandCollapseExpandCollapseStatePropertyId:
                    return integer(! node.state.expanded  ? ExpandCollapseState_LeafNode
                                   : *node.state.expanded ? ExpandCollapseState_Expanded
                                                          : ExpandCollapseState_Collapsed);
                case UIA_IsDialogPropertyId:
                    return boolean(node.role == Role::Dialog || node.modal);
                default:
                    return S_OK; // VT_EMPTY: UIA supplies defaults.
            }
        }

    private:
        ~Provider() = default;
        template <typename F>
        HRESULT read(F&& body)
        {
            return guarded(
                [&]
                {
                    const std::scoped_lock lock(state->mutex);
                    if (! state->alive)
                        return UIA_E_ELEMENTNOTAVAILABLE;
                    const Node* node = state->node(id);
                    if (node == nullptr)
                        return UIA_E_ELEMENTNOTAVAILABLE;
                    return body(*node);
                });
        }
        const Node* selectionContainer(const Node& node) const
        {
            for (NodeId parent = state->tree.parent(node.id); parent != noNode; parent = state->tree.parent(parent))
                if (const Node* container = state->tree.find(parent); container != nullptr && selection(*container))
                    return container;
            return nullptr;
        }
        NodeId focus() const { return state->tree.focus() != noNode ? state->tree.focus() : state->tree.root(); }
        HRESULT fragment(NodeId target, IRawElementProviderFragment** out)
        {
            if (target != noNode && state->tree.find(target) != nullptr)
            {
                auto* result = state->element(state, state->key(target));
                result->AddRef();
                *out = result;
            }
            return S_OK;
        }
        HRESULT enqueue(const Node& node, Action action, std::variant<std::monostate, double, std::string> value = {})
        {
            if (node.state.disabled)
                return UIA_E_ELEMENTNOTENABLED;
            if (! node.supports(action))
                return UIA_E_NOTSUPPORTED;
            if (state->requests.size() >= 1024)
                return UIA_E_INVALIDOPERATION;
            state->requests.push_back({ node.id, action, {}, std::move(value) });
            return S_OK;
        }
        HRESULT ask(Action action, std::variant<std::monostate, double, std::string> value = {})
        {
            return read([&](const Node& node) { return enqueue(node, action, std::move(value)); });
        }
        HRESULT number(double* out, std::optional<double> Value::*member)
        {
            if (out == nullptr)
                return E_POINTER;
            *out = 0;
            return read(
                [&](const Node& node)
                {
                    *out = (node.value.*member).value_or(0);
                    return S_OK;
                });
        }
        HRESULT change(double* out)
        {
            if (out == nullptr)
                return E_POINTER;
            *out = std::numeric_limits<double>::quiet_NaN();
            return read([](const Node&) { return S_OK; });
        }
        HRESULT selectionFlag(BOOL* out, bool value)
        {
            if (out == nullptr)
                return E_POINTER;
            *out = value;
            return read([](const Node&) { return S_OK; });
        }
        std::atomic<ULONG> references { 1 };
        std::shared_ptr<State> state;
        NodeId id;
    };

    Session::Provider* Session::State::element(const std::shared_ptr<State>& owner, NodeId id)
    {
        if (const auto found = providers.find(id); found != providers.end())
            return found->second;
        auto* created = new Provider(owner, id);
        try
        {
            providers.emplace(id, created);
        }
        catch (...)
        {
            created->Release();
            throw;
        }
        return created;
    }

    Session::Session(HWND window, std::string name) : state(std::make_shared<State>())
    {
        state->window = window;
        UiaHostProviderFromHwnd(window, &state->hostProvider);
        state->name = std::move(name);
        // CoCreateGuid does not require COM initialization. The host owns COM.
        if (FAILED(CoCreateGuid(&state->identity)))
            throw std::bad_alloc();
        // A useful root is available even before the first UI tick.
        Node root;
        root.id = 1;
        root.role = Role::View;
        state->tree.apply({ { root }, {}, root.id, noNode, true });
    }
    Session::~Session()
    {
        close();
    }

    IRawElementProviderSimple* Session::provider()
    {
        const std::scoped_lock lock(state->mutex);
        if (! state->alive)
            return nullptr;
        // COM clients can retain vtables after editor teardown. Like the Apple
        // bridge, pin only this binary, once it exposes platform objects.
        detail::pinModule();
        state->listening = true;
        auto* root = state->element(state, noNode);
        root->AddRef();
        return root;
    }
    bool Session::active() const
    {
        const std::scoped_lock lock(state->mutex);
        return state->alive && state->listening;
    }
    std::vector<ActionRequest> Session::takeRequests()
    {
        const std::scoped_lock lock(state->mutex);
        std::vector<ActionRequest> result;
        result.swap(state->requests);
        return result;
    }
    void Session::close()
    {
        std::unordered_map<NodeId, Provider*> retired;
        Microsoft::WRL::ComPtr<IRawElementProviderSimple> host;
        {
            const std::scoped_lock lock(state->mutex);
            state->alive = false;
            state->window = nullptr;
            host.Swap(state->hostProvider);
            state->requests.clear();
            retired.swap(state->providers);
        }
        // Never hold our lock across UIA: it can re-enter providers. Only this
        // session's objects are disconnected. Never disconnect all providers.
        for (const auto& [id, provider] : retired)
        {
            static_cast<void>(id);
            UiaDisconnectProvider(provider);
            provider->Release();
        }
    }

    void Session::update(const TreeUpdate& update, const ViewGeometry& geometry, bool focused)
    {
        // Snapshot screen origin on the HWND thread; queries never send window
        // messages or touch a RuntimeHost. UIA calls happen after unlocking.
        POINT origin {};
        ClientToScreen(state->window, &origin);
        struct PropertyEvent
        {
            Microsoft::WRL::ComPtr<Provider> provider;
            PROPERTYID property;
            std::shared_ptr<Variant> before;
            std::shared_ptr<Variant> after;
        };
        std::vector<PropertyEvent> events;
        std::vector<Microsoft::WRL::ComPtr<Provider>> retired;
        Microsoft::WRL::ComPtr<Provider> rootEvent;
        Microsoft::WRL::ComPtr<Provider> focusEvent;
        const bool clients = UiaClientsAreListening() != FALSE;
        {
            const std::scoped_lock lock(state->mutex);
            if (! state->alive)
                return;
            const NodeId oldFocus =
                state->focused ? (state->tree.focus() != noNode ? state->tree.focus() : state->tree.root()) : noNode;
            const bool notify = state->listening && clients;
            bool structure = update.full || ! update.removed.empty();
            const bool moved =
                geometry != state->geometry || origin.x != state->origin.x || origin.y != state->origin.y;
            const auto boundsEvent = [&](Provider* provider, const Node& before, const Node& after)
            {
                auto was = std::make_shared<Variant>();
                auto now = std::make_shared<Variant>();
                if (SUCCEEDED(rectangleValue(state->bounds(before), &was->value))
                    && SUCCEEDED(rectangleValue(screenBounds(after, geometry, origin), &now->value)))
                    events.push_back({ provider, UIA_BoundingRectanglePropertyId, std::move(was), std::move(now) });
            };
            // Cached elements may move because the native window moved, even
            // if their logical bounds did not change in this tree update.
            if (notify && moved)
                for (const auto& [key, provider] : state->providers)
                    if (const Node* node = state->node(key);
                        node != nullptr && std::ranges::find(update.nodes, node->id, &Node::id) == update.nodes.end())
                        boundsEvent(provider, *node, *node);
            for (const Node& node : update.nodes)
            {
                const Node* before = state->tree.find(node.id);
                structure = structure || before == nullptr || before->children != node.children;
                if (! notify || before == nullptr)
                    continue;
                auto* provider = state->element(state, state->key(node.id));
                if (moved || node.bounds != before->bounds)
                    boundsEvent(provider, *before, node);
                for (const PROPERTYID property : changedProperties(*before, node))
                {
                    if (property == UIA_BoundingRectanglePropertyId)
                        continue;
                    auto was = std::make_shared<Variant>();
                    auto now = std::make_shared<Variant>();
                    if (FAILED(provider->propertyValue(*before, property, &was->value))
                        || FAILED(provider->propertyValue(node, property, &now->value)))
                        continue;
                    events.push_back({ provider, property, std::move(was), std::move(now) });
                }
            }
            state->tree.apply(update);
            state->geometry = geometry;
            state->origin = origin;
            state->focused = focused;
            for (auto it = state->providers.begin(); it != state->providers.end();)
            {
                if (it->first != noNode && state->tree.find(it->first) == nullptr)
                {
                    Microsoft::WRL::ComPtr<Provider> removed;
                    removed.Attach(it->second);
                    retired.push_back(std::move(removed));
                    it = state->providers.erase(it);
                }
                else
                    ++it;
            }
            if (notify && structure)
            {
                rootEvent = state->element(state, noNode);
            }
            const NodeId newFocus =
                focused ? (state->tree.focus() != noNode ? state->tree.focus() : state->tree.root()) : noNode;
            if (notify && oldFocus != newFocus)
            {
                const auto focusProperty = [&](NodeId target, bool gained)
                {
                    if (target == noNode || state->tree.find(target) == nullptr)
                        return;
                    auto* provider = state->element(state, state->key(target));
                    auto was = std::make_shared<Variant>();
                    auto now = std::make_shared<Variant>();
                    was->value.vt = now->value.vt = VT_BOOL;
                    was->value.boolVal = gained ? VARIANT_FALSE : VARIANT_TRUE;
                    now->value.boolVal = gained ? VARIANT_TRUE : VARIANT_FALSE;
                    events.push_back({ provider, UIA_HasKeyboardFocusPropertyId, std::move(was), std::move(now) });
                    if (gained)
                        focusEvent = provider;
                };
                focusProperty(oldFocus, false);
                focusProperty(newFocus, true);
            }
        }
        for (const PropertyEvent& event : events)
        {
            UiaRaiseAutomationPropertyChangedEvent(event.provider.Get(), event.property, event.before->value,
                                                   event.after->value);
            if (event.property == UIA_SelectionItemIsSelectedPropertyId)
                UiaRaiseAutomationEvent(event.provider.Get(),
                                        event.after->value.boolVal == VARIANT_TRUE
                                            ? UIA_SelectionItem_ElementSelectedEventId
                                            : UIA_SelectionItem_ElementRemovedFromSelectionEventId);
        }
        if (rootEvent != nullptr)
        {
            UiaRaiseStructureChangedEvent(rootEvent.Get(), StructureChangeType_ChildrenInvalidated, nullptr, 0);
        }
        if (focusEvent != nullptr)
        {
            UiaRaiseAutomationEvent(focusEvent.Get(), UIA_AutomationFocusChangedEventId);
        }
        for (const auto& provider : retired)
            UiaDisconnectProvider(provider.Get());
    }

    namespace
    {
        class WindowsPlatform final : public PlatformAccessibility
        {
        public:
            WindowsPlatform(HWND window, std::string name) : hwnd(window), session(window, std::move(name)) {}
            ~WindowsPlatform() override { detach(); }
            bool attach()
            {
                return SetWindowSubclass(hwnd, windowProc, reinterpret_cast<UINT_PTR>(this),
                                         reinterpret_cast<DWORD_PTR>(this))
                       != FALSE;
            }
            void tick(RuntimeHost& host) override
            {
                if (hwnd == nullptr || ! session.active())
                    return;
                const bool sameHost = lastHost == &host;
                for (const ActionRequest& request : session.takeRequests())
                    if (sameHost)
                        host.performAccessibilityAction(request);
                session.update(host.accessibility().update(! sameHost), geometry, focused);
                lastHost = &host;
            }
            void setGeometry(const ViewGeometry& next) override { geometry = next; }
            void setFocused(bool next) override { focused = next; }
            bool active() const override { return session.active(); }

        private:
            void detach()
            {
                if (hwnd != nullptr)
                {
                    RemoveWindowSubclass(hwnd, windowProc, reinterpret_cast<UINT_PTR>(this));
                    hwnd = nullptr;
                }
                session.close();
            }
            static LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR,
                                               DWORD_PTR data)
            {
                auto* self = reinterpret_cast<WindowsPlatform*>(data); // NOLINT(performance-no-int-to-ptr)
                if (message == WM_GETOBJECT && static_cast<LONG>(lParam) == UiaRootObjectId && self->hwnd == window)
                {
                    LRESULT result = 0;
                    // Window procedures cannot let exceptions escape either.
                    guarded(
                        [&]
                        {
                            if (auto* provider = self->session.provider())
                            {
                                result = UiaReturnRawElementProvider(window, wParam, lParam, provider);
                                provider->Release();
                            }
                            return S_OK;
                        });
                    return result;
                }
                if (message == WM_NCDESTROY)
                    self->detach();
                return DefSubclassProc(window, message, wParam, lParam);
            }
            HWND hwnd;
            Session session;
            const RuntimeHost* lastHost = nullptr;
            ViewGeometry geometry;
            bool focused = false;
        };
    } // namespace

    std::unique_ptr<PlatformAccessibility> createPlatform(const PlatformOptions& options)
    {
        const auto window = static_cast<HWND>(options.view.handle);
        if (window == nullptr || ! IsWindow(window)
            || GetWindowThreadProcessId(window, nullptr) != GetCurrentThreadId())
            return nullptr;
        auto platform = std::make_unique<WindowsPlatform>(window, options.name);
        if (! platform->attach())
            return nullptr;
        return platform;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::uia
