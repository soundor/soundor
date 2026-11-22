#include "a11y/windows/Uia.h"

#include <doctest/doctest.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <thread>
#include <vector>

using namespace soundor;
using namespace soundor::a11y;
using Microsoft::WRL::ComPtr;

namespace
{
    struct Window
    {
        Window()
        {
            handle = CreateWindowExW(0, L"STATIC", L"Host", WS_POPUP, 20, 30, 400, 300, nullptr, nullptr,
                                     GetModuleHandleW(nullptr), nullptr);
            REQUIRE(handle != nullptr);
        }
        ~Window()
        {
            if (handle != nullptr)
                DestroyWindow(handle);
        }
        Window(const Window&) = delete;
        Window& operator=(const Window&) = delete;
        HWND handle = nullptr;
    };

    TreeUpdate tree()
    {
        Node root;
        root.id = 100;
        root.role = Role::View;
        root.children = { 101, 102, 103 };
        root.bounds = { 0, 0, 200, 100 };
        Node knob;
        knob.id = 101;
        knob.role = Role::Adjustable;
        knob.label = "Gain";
        knob.hint = "Output level";
        knob.keyShortcuts = "Control+G";
        knob.value = { -60, 12, -3.5, "-3.5 dB" };
        knob.bounds = { 10, 20, 40, 40 };
        knob.focusable = true;
        knob.actions = { { Action::SetValue }, { Action::Focus } };
        Node toggle;
        toggle.id = 102;
        toggle.role = Role::Switch;
        toggle.state.checked = Checked::Mixed;
        toggle.actions = { { Action::Activate } };
        Node tabs;
        tabs.id = 103;
        tabs.role = Role::TabList;
        tabs.children = { 104, 105 };
        Node first;
        first.id = 104;
        first.role = Role::Tab;
        first.state.selected = true;
        first.actions = { { Action::Activate } };
        Node second = first;
        second.id = 105;
        second.state.selected = false;
        return { { root, knob, toggle, tabs, first, second }, {}, 100, 101, true };
    }

    ComPtr<IRawElementProviderSimple> root(uia::Session& session)
    {
        ComPtr<IRawElementProviderSimple> result;
        result.Attach(session.provider());
        REQUIRE(result != nullptr);
        return result;
    }

    ComPtr<IRawElementProviderSimple> navigate(IRawElementProviderSimple* from, NavigateDirection direction)
    {
        ComPtr<IRawElementProviderFragment> fragment;
        REQUIRE(from->QueryInterface(IID_PPV_ARGS(&fragment)) == S_OK);
        ComPtr<IRawElementProviderFragment> next;
        REQUIRE(fragment->Navigate(direction, &next) == S_OK);
        ComPtr<IRawElementProviderSimple> result;
        if (next != nullptr)
            REQUIRE(next.As(&result) == S_OK);
        return result;
    }

    template <typename T>
    ComPtr<T> pattern(IRawElementProviderSimple* provider, PATTERNID id)
    {
        ComPtr<IUnknown> unknown;
        REQUIRE(provider->GetPatternProvider(id, &unknown) == S_OK);
        REQUIRE(unknown != nullptr);
        ComPtr<T> result;
        REQUIRE(unknown.As(&result) == S_OK);
        return result;
    }

    std::wstring property(IRawElementProviderSimple* provider, PROPERTYID id)
    {
        VARIANT value {};
        REQUIRE(provider->GetPropertyValue(id, &value) == S_OK);
        REQUIRE(value.vt == VT_BSTR);
        std::wstring result(value.bstrVal, SysStringLen(value.bstrVal));
        VariantClear(&value);
        return result;
    }
} // namespace

TEST_SUITE("a11y Windows UIA")
{
    TEST_CASE("every public role maps to a native UIA control type")
    {
        Window window;
        uia::Session session(window.handle, "Plugin");
        session.update(tree(), {}, true);
        auto provider = root(session);
        auto child = navigate(provider.Get(), NavigateDirection_FirstChild);
        const std::pair<Role, CONTROLTYPEID> roles[] = {
            { Role::None, UIA_GroupControlTypeId },          { Role::Text, UIA_TextControlTypeId },
            { Role::Image, UIA_ImageControlTypeId },         { Role::Button, UIA_ButtonControlTypeId },
            { Role::Link, UIA_HyperlinkControlTypeId },      { Role::Adjustable, UIA_SliderControlTypeId },
            { Role::CheckBox, UIA_CheckBoxControlTypeId },   { Role::Switch, UIA_ButtonControlTypeId },
            { Role::ToggleButton, UIA_ButtonControlTypeId }, { Role::Radio, UIA_RadioButtonControlTypeId },
            { Role::RadioGroup, UIA_GroupControlTypeId },    { Role::ProgressBar, UIA_ProgressBarControlTypeId },
            { Role::Search, UIA_GroupControlTypeId },        { Role::ComboBox, UIA_ComboBoxControlTypeId },
            { Role::Menu, UIA_MenuControlTypeId },           { Role::MenuBar, UIA_MenuBarControlTypeId },
            { Role::MenuItem, UIA_MenuItemControlTypeId },   { Role::ScrollBar, UIA_ScrollBarControlTypeId },
            { Role::ListBox, UIA_ListControlTypeId },        { Role::Option, UIA_ListItemControlTypeId },
            { Role::SpinButton, UIA_SpinnerControlTypeId },  { Role::Tab, UIA_TabItemControlTypeId },
            { Role::TabList, UIA_TabControlTypeId },         { Role::Header, UIA_TextControlTypeId },
            { Role::Summary, UIA_GroupControlTypeId },       { Role::KeyboardKey, UIA_ButtonControlTypeId },
            { Role::Timer, UIA_PaneControlTypeId },          { Role::Toolbar, UIA_ToolBarControlTypeId },
            { Role::Alert, UIA_TextControlTypeId },          { Role::Dialog, UIA_WindowControlTypeId },
            { Role::Group, UIA_GroupControlTypeId },         { Role::TextInput, UIA_EditControlTypeId },
            { Role::ScrollView, UIA_PaneControlTypeId },     { Role::View, UIA_PaneControlTypeId }
        };
        for (const auto& [role, type] : roles)
        {
            auto update = tree();
            update.nodes[1].role = role;
            session.update(update, {}, true);
            VARIANT value {};
            REQUIRE(child->GetPropertyValue(UIA_ControlTypePropertyId, &value) == S_OK);
            CHECK(value.vt == VT_I4);
            CHECK(value.lVal == type);
            VariantClear(&value);
        }
    }

    TEST_CASE("property events describe semantic changes and suppress passive DSP value churn")
    {
        Node meter;
        meter.role = Role::ProgressBar;
        meter.value = { 0, 1, 0.2, "20%" };
        Node changed = meter;
        changed.value.now = 0.3;
        changed.value.text = "30%";
        CHECK(uia::changedProperties(meter, changed).empty());
        CHECK(uia::changedProperties(meter, meter).empty());
        meter.actions = { { Action::SetValue } };
        changed.actions = meter.actions;
        auto events = uia::changedProperties(meter, changed);
        CHECK(std::ranges::find(events, UIA_RangeValueValuePropertyId) != events.end());
        CHECK(std::ranges::find(events, UIA_ValueValuePropertyId) != events.end());
        changed = meter;
        changed.label = "Meter";
        changed.state.disabled = true;
        changed.state.selected = true;
        changed.state.expanded = false;
        changed.bounds.x = 5;
        events = uia::changedProperties(meter, changed);
        CHECK(std::ranges::find(events, UIA_NamePropertyId) != events.end());
        CHECK(std::ranges::find(events, UIA_IsEnabledPropertyId) != events.end());
        CHECK(std::ranges::find(events, UIA_SelectionItemIsSelectedPropertyId) != events.end());
        CHECK(std::ranges::find(events, UIA_ExpandCollapseExpandCollapseStatePropertyId) != events.end());
        CHECK(std::ranges::find(events, UIA_BoundingRectanglePropertyId) != events.end());
        CHECK(std::ranges::find(events, UIA_RangeValueValuePropertyId) == events.end());
        changed = meter;
        changed.keyShortcuts = "Control+M";
        CHECK(uia::changedProperties(meter, changed) == std::vector<PROPERTYID> { UIA_AcceleratorKeyPropertyId });
    }

    TEST_CASE("read-only transitions report UIA properties without passive value events")
    {
        Node slider;
        slider.role = Role::Adjustable;
        slider.value = { 0, 1, 0.2, "20%" };
        slider.actions = { { Action::SetValue } };
        Node readOnly = slider;
        readOnly.state.readOnly = true;
        readOnly.actions.clear();
        readOnly.value.now = 0.3;
        readOnly.value.text = "30%";

        auto events = uia::changedProperties(slider, readOnly);
        CHECK(std::ranges::find(events, UIA_ValueIsReadOnlyPropertyId) != events.end());
        CHECK(std::ranges::find(events, UIA_RangeValueIsReadOnlyPropertyId) != events.end());
        CHECK(std::ranges::find(events, UIA_ValueValuePropertyId) == events.end());
        CHECK(std::ranges::find(events, UIA_RangeValueValuePropertyId) == events.end());
    }

    TEST_CASE("full value snapshots do not flood structure notifications")
    {
        Tree mirror;
        mirror.apply(tree());
        auto values = tree();
        values.nodes[1].value.now = -2.25;
        values.nodes[1].value.text = "-2.25 dB";
        CHECK_FALSE(uia::structureChanged(mirror, values));
        CHECK_FALSE(uia::structureChanged(mirror, {}));
        auto children = tree();
        std::reverse(children.nodes[0].children.begin(), children.nodes[0].children.end());
        CHECK(uia::structureChanged(mirror, children));
        auto replacement = tree();
        replacement.root = 200;
        CHECK(uia::structureChanged(mirror, replacement));
        auto removed = tree();
        removed.nodes.pop_back();
        CHECK(uia::structureChanged(mirror, removed));
    }

    TEST_CASE("text values preserve Unicode and expansion requests remain queued")
    {
        Window window;
        uia::Session session(window.handle, "Plugin");
        auto update = tree();
        Node& input = update.nodes[1];
        input.role = Role::TextInput;
        input.placeholder = "Preset name";
        input.value = { {}, {}, {}, "é🎛" };
        input.state.expanded = false;
        input.actions = { { Action::SetValue }, { Action::Expand }, { Action::Collapse } };
        session.update(update, {}, true);
        auto provider = root(session);
        auto child = navigate(provider.Get(), NavigateDirection_FirstChild);
        CHECK(property(child.Get(), UIA_HelpTextPropertyId) == L"Preset name");
        auto value = pattern<IValueProvider>(child.Get(), UIA_ValuePatternId);
        BSTR text = nullptr;
        REQUIRE(value->get_Value(&text) == S_OK);
        CHECK(std::wstring(text, SysStringLen(text)) == L"é🎛");
        SysFreeString(text);
        CHECK(value->SetValue(L"日本語🎛") == S_OK);
        auto expansion = pattern<IExpandCollapseProvider>(child.Get(), UIA_ExpandCollapsePatternId);
        ExpandCollapseState state = ExpandCollapseState_LeafNode;
        CHECK(expansion->get_ExpandCollapseState(&state) == S_OK);
        CHECK(state == ExpandCollapseState_Collapsed);
        CHECK(expansion->Expand() == S_OK);
        auto requests = session.takeRequests();
        REQUIRE(requests.size() == 2);
        CHECK(std::get<std::string>(requests[0].value) == "日本語🎛");
        CHECK(requests[1].action == Action::Expand);
        CHECK(property(child.Get(), UIA_ValueValuePropertyId) == L"é🎛");
    }

    TEST_CASE("semantic properties, stable identity, navigation, range, and geometry")
    {
        Window window;
        uia::Session session(window.handle, "Plugin");
        session.update(tree(), { 5, 6, 2, {} }, true);
        auto provider = root(session);
        CHECK(property(provider.Get(), UIA_NamePropertyId) == L"Plugin");
        // UIA's native HWND provider owns window visibility. Logical bounds
        // alone cannot tell whether the host has hidden the editor.
        VARIANT nativeState {};
        CHECK(provider->GetPropertyValue(UIA_IsOffscreenPropertyId, &nativeState) == S_OK);
        CHECK(nativeState.vt == VT_EMPTY);
        ComPtr<IRawElementProviderSimple> nativeHost;
        CHECK(provider->get_HostRawElementProvider(&nativeHost) == S_OK);
        CHECK(nativeHost != nullptr);
        auto gain = navigate(provider.Get(), NavigateDirection_FirstChild);
        ComPtr<IRawElementProviderSimple> noHost;
        CHECK(gain->get_HostRawElementProvider(&noHost) == S_OK);
        CHECK(noHost == nullptr);
        CHECK(property(gain.Get(), UIA_NamePropertyId) == L"Gain");
        CHECK(property(gain.Get(), UIA_FullDescriptionPropertyId) == L"Output level");
        CHECK(property(gain.Get(), UIA_AcceleratorKeyPropertyId) == L"Control+G");
        auto again = navigate(provider.Get(), NavigateDirection_FirstChild);
        CHECK(again.Get() == gain.Get());
        auto parent = navigate(gain.Get(), NavigateDirection_Parent);
        CHECK(parent.Get() == provider.Get());
        ComPtr<IRawElementProviderFragment> fragment;
        REQUIRE(gain.As(&fragment) == S_OK);
        ComPtr<IRawElementProviderFragmentRoot> fragmentRoot;
        REQUIRE(fragment->get_FragmentRoot(&fragmentRoot) == S_OK);
        ComPtr<IUnknown> identity;
        REQUIRE(fragmentRoot.As(&identity) == S_OK);
        CHECK(identity.Get() == static_cast<IUnknown*>(provider.Get()));
        ComPtr<IRawElementProviderFragmentRoot> invalid;
        CHECK(gain.As(&invalid) == E_NOINTERFACE);
        UiaRect bounds {};
        REQUIRE(fragment->get_BoundingRectangle(&bounds) == S_OK);
        POINT origin {};
        ClientToScreen(window.handle, &origin);
        CHECK(bounds.left == origin.x + 25);
        CHECK(bounds.top == origin.y + 46);
        CHECK(bounds.width == 80);
        ComPtr<IRawElementProviderFragment> hit;
        REQUIRE(fragmentRoot->ElementProviderFromPoint(bounds.left + 1, bounds.top + 1, &hit) == S_OK);
        ComPtr<IRawElementProviderSimple> hitSimple;
        REQUIRE(hit.As(&hitSimple) == S_OK);
        CHECK(hitSimple.Get() == gain.Get());
        auto overflow = tree();
        overflow.nodes[1].bounds.x = -1000;
        session.update(overflow, { 5, 6, 2, {} }, true);
        hit.Reset();
        CHECK(fragmentRoot->ElementProviderFromPoint(origin.x - 1900, bounds.top + 1, &hit) == S_OK);
        CHECK(hit == nullptr);
        session.update(tree(), { 5, 6, 2, {} }, true);
        auto range = pattern<IRangeValueProvider>(gain.Get(), UIA_RangeValuePatternId);
        double value = 0;
        CHECK(range->get_Value(&value) == S_OK);
        CHECK(value == -3.5);
        CHECK(range->SetValue(100) == E_INVALIDARG);
        CHECK(range->SetValue(-2.25) == S_OK);
        CHECK(fragment->SetFocus() == S_OK);
        auto requests = session.takeRequests();
        REQUIRE(requests.size() == 2);
        CHECK(requests[0].target == 101);
        CHECK(std::get<double>(requests[0].value) == -2.25);
        CHECK(requests[1].action == Action::Focus);
    }

    TEST_CASE("toggle, selection, focus, disabled actions and unsupported patterns")
    {
        Window window;
        uia::Session session(window.handle, "Plugin");
        auto update = tree();
        session.update(update, {}, true);
        auto provider = root(session);
        auto gain = navigate(provider.Get(), NavigateDirection_FirstChild);
        auto toggle = navigate(gain.Get(), NavigateDirection_NextSibling);
        auto toggler = pattern<IToggleProvider>(toggle.Get(), UIA_TogglePatternId);
        ToggleState state = ToggleState_Off;
        CHECK(toggler->get_ToggleState(&state) == S_OK);
        CHECK(state == ToggleState_Indeterminate);
        CHECK(toggler->Toggle() == S_OK);
        auto tabs = navigate(toggle.Get(), NavigateDirection_NextSibling);
        auto selection = pattern<ISelectionProvider>(tabs.Get(), UIA_SelectionPatternId);
        SAFEARRAY* chosen = nullptr;
        REQUIRE(selection->GetSelection(&chosen) == S_OK);
        REQUIRE(chosen != nullptr);
        LONG count = -1;
        CHECK(SafeArrayGetUBound(chosen, 1, &count) == S_OK);
        CHECK(count == 0);
        SafeArrayDestroy(chosen);
        auto first = navigate(tabs.Get(), NavigateDirection_FirstChild);
        auto second = navigate(first.Get(), NavigateDirection_NextSibling);
        auto item = pattern<ISelectionItemProvider>(second.Get(), UIA_SelectionItemPatternId);
        CHECK(item->Select() == S_OK);
        ComPtr<IRawElementProviderSimple> container;
        CHECK(item->get_SelectionContainer(&container) == S_OK);
        CHECK(container.Get() == tabs.Get());
        auto requests = session.takeRequests();
        REQUIRE(requests.size() == 2);
        CHECK(requests[0].target == 102);
        CHECK(requests[1].target == 105);
        ComPtr<IRawElementProviderFragmentRoot> fragment;
        REQUIRE(provider.As(&fragment) == S_OK);
        ComPtr<IRawElementProviderFragment> focus;
        CHECK(fragment->GetFocus(&focus) == S_OK);
        ComPtr<IRawElementProviderSimple> focusSimple;
        REQUIRE(focus.As(&focusSimple) == S_OK);
        CHECK(focusSimple.Get() == gain.Get());
        // Geometry/native-focus updates can arrive without a semantic diff.
        session.update({}, { 5, 6, 2, {} }, true);
        focus.Reset();
        REQUIRE(fragment->GetFocus(&focus) == S_OK);
        focusSimple.Reset();
        REQUIRE(focus.As(&focusSimple) == S_OK);
        CHECK(focusSimple.Get() == gain.Get());
        session.update({ {}, {}, 100, 102, false }, {}, true);
        focus.Reset();
        REQUIRE(fragment->GetFocus(&focus) == S_OK);
        focusSimple.Reset();
        REQUIRE(focus.As(&focusSimple) == S_OK);
        CHECK(focusSimple.Get() == toggle.Get());
        session.update({ {}, {}, 100, noNode, false }, {}, false);
        focus.Reset();
        CHECK(fragment->GetFocus(&focus) == S_OK);
        CHECK(focus == nullptr);
        update.nodes[2].state.disabled = true;
        session.update(update, {}, false);
        CHECK(toggler->Toggle() == static_cast<HRESULT>(UIA_E_ELEMENTNOTENABLED));
        ComPtr<IUnknown> unsupported;
        CHECK(gain->GetPatternProvider(UIA_TogglePatternId, &unsupported) == S_OK);
        CHECK(unsupported == nullptr);
    }

    TEST_CASE("listbox options expose selection through UI Automation")
    {
        Window window;
        uia::Session session(window.handle, "Plugin");
        auto update = tree();
        update.nodes[3].role = Role::ListBox;
        update.nodes[4].role = Role::Option;
        update.nodes[5].role = Role::Option;
        update.nodes[5].state.selected.reset();
        session.update(update, {}, true);

        auto provider = root(session);
        auto list = navigate(provider.Get(), NavigateDirection_LastChild);
        auto first = navigate(list.Get(), NavigateDirection_FirstChild);
        auto second = navigate(list.Get(), NavigateDirection_LastChild);
        auto selection = pattern<ISelectionProvider>(list.Get(), UIA_SelectionPatternId);
        SAFEARRAY* chosen = nullptr;
        REQUIRE(selection->GetSelection(&chosen) == S_OK);
        REQUIRE(chosen != nullptr);
        CHECK(chosen->rgsabound[0].cElements == 1);
        SafeArrayDestroy(chosen);
        auto selected = pattern<ISelectionItemProvider>(first.Get(), UIA_SelectionItemPatternId);
        auto unselected = pattern<ISelectionItemProvider>(second.Get(), UIA_SelectionItemPatternId);
        BOOL isSelected = FALSE;
        CHECK(selected->get_IsSelected(&isSelected) == S_OK);
        CHECK(isSelected == TRUE);
        CHECK(unselected->get_IsSelected(&isSelected) == S_OK);
        CHECK(isSelected == FALSE);
        ComPtr<IRawElementProviderSimple> container;
        CHECK(unselected->get_SelectionContainer(&container) == S_OK);
        CHECK(container.Get() == list.Get());
        CHECK(unselected->Select() == S_OK);
        const auto requests = session.takeRequests();
        REQUIRE(requests.size() == 1);
        CHECK(requests[0].target == update.nodes[5].id);
        CHECK(requests[0].action == Action::Activate);
    }

    TEST_CASE("retained COM references become unavailable after removal, reload and close")
    {
        Window window;
        uia::Session session(window.handle, "Plugin");
        session.update(tree(), {}, true);
        auto provider = root(session);
        auto gain = navigate(provider.Get(), NavigateDirection_FirstChild);
        auto range = pattern<IRangeValueProvider>(gain.Get(), UIA_RangeValuePatternId);
        auto update = tree();
        update.nodes[0].children = { 102, 103 };
        update.nodes.erase(update.nodes.begin() + 1);
        session.update(update, {}, true);
        double value = 0;
        CHECK(range->get_Value(&value) == static_cast<HRESULT>(UIA_E_ELEMENTNOTAVAILABLE));
        CHECK(range->SetValue(0) == static_cast<HRESULT>(UIA_E_ELEMENTNOTAVAILABLE));
        CHECK(root(session).Get() == provider.Get());
        auto oldToggle = navigate(provider.Get(), NavigateDirection_FirstChild);
        auto toggler = pattern<IToggleProvider>(oldToggle.Get(), UIA_TogglePatternId);
        CHECK(toggler->Toggle() == S_OK);
        auto replacement = tree();
        for (Node& node : replacement.nodes)
        {
            node.id += 1000;
            for (NodeId& child : node.children)
                child += 1000;
        }
        replacement.root += 1000;
        replacement.focus += 1000;
        session.update(replacement, {}, true);
        CHECK(session.takeRequests().empty());
        CHECK(root(session).Get() == provider.Get());
        CHECK(toggler->Toggle() == static_cast<HRESULT>(UIA_E_ELEMENTNOTAVAILABLE));
        auto replacementChild = navigate(provider.Get(), NavigateDirection_FirstChild);
        CHECK(replacementChild.Get() != gain.Get());
        CHECK(property(replacementChild.Get(), UIA_NamePropertyId) == L"Gain");
        session.close();
        CHECK(session.takeRequests().empty());
        VARIANT result {};
        CHECK(provider->GetPropertyValue(UIA_NamePropertyId, &result)
              == static_cast<HRESULT>(UIA_E_ELEMENTNOTAVAILABLE));
        CHECK(session.provider() == nullptr);
        session.close();
    }

    TEST_CASE("independent sessions with overlapping node IDs and concurrent queries survive editor teardown")
    {
        Window a;
        Window b;
        auto first = std::make_unique<uia::Session>(a.handle, "A");
        uia::Session second(b.handle, "B");
        first->update(tree(), {}, true);
        second.update(tree(), {}, true);
        auto aRoot = root(*first);
        auto bRoot = root(second);
        auto aChild = navigate(aRoot.Get(), NavigateDirection_FirstChild);
        auto bChild = navigate(bRoot.Get(), NavigateDirection_FirstChild);
        CHECK(aRoot.Get() != bRoot.Get());
        ComPtr<IRawElementProviderFragment> af;
        ComPtr<IRawElementProviderFragment> bf;
        REQUIRE(aChild.As(&af) == S_OK);
        REQUIRE(bChild.As(&bf) == S_OK);
        SAFEARRAY* aid = nullptr;
        SAFEARRAY* bid = nullptr;
        REQUIRE(af->GetRuntimeId(&aid) == S_OK);
        REQUIRE(bf->GetRuntimeId(&bid) == S_OK);
        bool different = false;
        for (LONG i = 1; i <= 4; ++i)
        {
            int av = 0;
            int bv = 0;
            SafeArrayGetElement(aid, &i, &av);
            SafeArrayGetElement(bid, &i, &bv);
            different = different || av != bv;
        }
        CHECK(different);
        SafeArrayDestroy(aid);
        SafeArrayDestroy(bid);
        std::atomic<bool> stop { false };
        std::atomic<bool> valid { true };
        std::atomic<unsigned> queries { 0 };
        std::thread worker(
            [&]
            {
                while (! stop)
                {
                    VARIANT value {};
                    const HRESULT result = aChild->GetPropertyValue(UIA_NamePropertyId, &value);
                    if (result != S_OK && result != static_cast<HRESULT>(UIA_E_ELEMENTNOTAVAILABLE))
                        valid = false;
                    VariantClear(&value);
                    const HRESULT other = bChild->GetPropertyValue(UIA_NamePropertyId, &value);
                    if (other != S_OK)
                        valid = false;
                    VariantClear(&value);
                    ++queries;
                }
            });
        while (queries < 16)
            std::this_thread::yield();
        first.reset();
        const unsigned afterClose = queries.load() + 16;
        while (queries < afterClose)
            std::this_thread::yield();
        for (int i = 0; i < 20; ++i)
            second.update(tree(), {}, i % 2 == 0);
        stop = true;
        worker.join();
        CHECK(valid.load());
        CHECK(property(bRoot.Get(), UIA_NamePropertyId) == L"B");
        CHECK(pattern<IRangeValueProvider>(bChild.Get(), UIA_RangeValuePatternId)->SetValue(0) == S_OK);
        REQUIRE(second.takeRequests().size() == 1);
    }

    TEST_CASE("dialog patterns preserve modal state without controlling the host window")
    {
        Window window;
        uia::Session session(window.handle, "Plugin");
        auto update = tree();
        update.nodes[1].role = Role::Dialog;
        update.nodes[1].modal = true;
        update.nodes[1].actions = { { Action::Escape } };
        session.update(update, {}, true);
        auto provider = root(session);
        auto dialog = navigate(provider.Get(), NavigateDirection_FirstChild);
        auto patternProvider = pattern<IWindowProvider>(dialog.Get(), UIA_WindowPatternId);
        BOOL modal = FALSE;
        CHECK(patternProvider->get_IsModal(&modal) == S_OK);
        CHECK(modal);
        CHECK(patternProvider->SetVisualState(WindowVisualState_Maximized)
              == static_cast<HRESULT>(UIA_E_INVALIDOPERATION));
        CHECK(patternProvider->Close() == S_OK);
        auto requests = session.takeRequests();
        REQUIRE(requests.size() == 1);
        CHECK(requests[0].action == Action::Escape);
        CHECK(IsWindow(window.handle));
    }

    TEST_CASE("HWND subclass is local and removed on either destruction order")
    {
        CHECK(createPlatformAccessibility({}) == nullptr);
        Window host;
        // A native host provider belongs to Windows, outside Soundor's trees.
        ComPtr<IRawElementProviderSimple> nativeHost;
        REQUIRE(UiaHostProviderFromHwnd(host.handle, &nativeHost) == S_OK);
        REQUIRE(nativeHost != nullptr);
        ProviderOptions hostOptions {};
        REQUIRE(nativeHost->get_ProviderOptions(&hostOptions) == S_OK);
        const LRESULT hostResult = SendMessageW(host.handle, WM_GETOBJECT, 0, UiaRootObjectId);
        for (int i = 0; i < 4; ++i)
        {
            Window editor;
            const auto native = a11y::NativeView { editor.handle, nullptr };
            auto platform = createPlatformAccessibility({ native, "Editor" });
            REQUIRE(platform != nullptr);
            CHECK(SendMessageW(host.handle, WM_GETOBJECT, 0, UiaRootObjectId) == hostResult);
            ProviderOptions options {};
            CHECK(nativeHost->get_ProviderOptions(&options) == S_OK);
            CHECK(options == hostOptions);
            // Other object IDs go through the original window procedure.
            CHECK(SendMessageW(editor.handle, WM_GETOBJECT, 0, OBJID_CURSOR) == 0);
            SendMessageW(editor.handle, WM_GETOBJECT, 0, UiaRootObjectId);
            CHECK(platform->active());
            if (i % 2 == 0)
            {
                DestroyWindow(editor.handle);
                editor.handle = nullptr;
                CHECK_FALSE(platform->active());
            }
            else
            {
                platform.reset();
                CHECK(IsWindow(editor.handle));
            }
        }
        CHECK(SendMessageW(host.handle, WM_GETOBJECT, 0, UiaRootObjectId) == hostResult);
        ProviderOptions options {};
        CHECK(nativeHost->get_ProviderOptions(&options) == S_OK);
        CHECK(options == hostOptions);
    }
}
