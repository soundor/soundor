#include "a11y/windows/Uia.h"

#include <doctest/doctest.h>
#include <wrl/client.h>

#include <atomic>
#include <thread>

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
        VARIANT value;
        REQUIRE(provider->GetPropertyValue(id, &value) == S_OK);
        REQUIRE(value.vt == VT_BSTR);
        std::wstring result(value.bstrVal, SysStringLen(value.bstrVal));
        VariantClear(&value);
        return result;
    }
} // namespace

TEST_SUITE("a11y Windows UIA")
{
    TEST_CASE("semantic properties, stable identity, navigation, range, and geometry")
    {
        Window window;
        uia::Session session(window.handle, "Plugin");
        session.update(tree(), { 5, 6, 2, {} }, true);
        auto provider = root(session);
        CHECK(property(provider.Get(), UIA_NamePropertyId) == L"Plugin");
        auto gain = navigate(provider.Get(), NavigateDirection_FirstChild);
        CHECK(property(gain.Get(), UIA_NamePropertyId) == L"Gain");
        CHECK(property(gain.Get(), UIA_HelpTextPropertyId) == L"Output level");
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
        session.update({ {}, {}, 100, noNode, false }, {}, false);
        focus.Reset();
        CHECK(fragment->GetFocus(&focus) == S_OK);
        CHECK(focus == nullptr);
        update.nodes[2].state.disabled = true;
        session.update(update, {}, false);
        CHECK(toggler->Toggle() == UIA_E_ELEMENTNOTENABLED);
        ComPtr<IUnknown> unsupported;
        CHECK(gain->GetPatternProvider(UIA_TogglePatternId, &unsupported) == S_OK);
        CHECK(unsupported == nullptr);
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
        CHECK(range->get_Value(&value) == UIA_E_ELEMENTNOTAVAILABLE);
        CHECK(range->SetValue(0) == UIA_E_ELEMENTNOTAVAILABLE);
        CHECK(root(session).Get() == provider.Get());
        session.close();
        VARIANT result;
        CHECK(provider->GetPropertyValue(UIA_NamePropertyId, &result) == UIA_E_ELEMENTNOTAVAILABLE);
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
        std::thread worker(
            [&]
            {
                while (! stop)
                {
                    VARIANT value;
                    const HRESULT result = aChild->GetPropertyValue(UIA_NamePropertyId, &value);
                    if (result != S_OK && result != UIA_E_ELEMENTNOTAVAILABLE)
                        valid = false;
                    VariantClear(&value);
                    const HRESULT other = bChild->GetPropertyValue(UIA_NamePropertyId, &value);
                    if (other != S_OK)
                        valid = false;
                    VariantClear(&value);
                }
            });
        first.reset();
        for (int i = 0; i < 20; ++i)
            second.update(tree(), {}, i % 2 == 0);
        stop = true;
        worker.join();
        CHECK(valid.load());
        CHECK(property(bRoot.Get(), UIA_NamePropertyId) == L"B");
        CHECK(pattern<IRangeValueProvider>(bChild.Get(), UIA_RangeValuePatternId)->SetValue(0) == S_OK);
        REQUIRE(second.takeRequests().size() == 1);
    }

    TEST_CASE("HWND subclass is local and removed on either destruction order")
    {
        CHECK(createPlatformAccessibility({}) == nullptr);
        Window host;
        const LRESULT hostResult = SendMessageW(host.handle, WM_GETOBJECT, 0, UiaRootObjectId);
        for (int i = 0; i < 4; ++i)
        {
            Window editor;
            const auto native = a11y::NativeView { editor.handle, nullptr };
            auto platform = createPlatformAccessibility({ native, "Editor" });
            REQUIRE(platform != nullptr);
            CHECK(SendMessageW(host.handle, WM_GETOBJECT, 0, UiaRootObjectId) == hostResult);
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
    }
}
