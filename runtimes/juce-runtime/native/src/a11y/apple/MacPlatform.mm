// Soundor's macOS accessibility bridge: the semantic tree as virtual
// NSAccessibilityElements, shown to VoiceOver in the plugin's NSView. No view
// per node, nothing of AccessKit, nothing of JUCE.
//
// Plugin safety (see apple/README.md for the whole lifecycle):
// - The element class is created at runtime (objc_allocateClassPair) under a
//   random name that also carries the ABI namespace: no fixed name, so two
//   Soundor plugins (or two copies of one) never collide. It is the only
//   class Soundor adds; it subclasses NSAccessibilityElement and changes no
//   existing class. Nothing is swizzled.
// - The class is never disposed, and the binary is pinned when it is created:
//   AppKit and VoiceOver may hold elements (and so the class's methods, in
//   this binary) for as long as they like, which nothing tells us.
// - Elements know their bridge only by token. A message to an element whose
//   bridge is gone finds nothing and does nothing.
// - Requests are queued and performed by tick(), like every platform's.

#include "a11y/apple/MacPlatform.h"

#include "a11y/PlatformSupport.h"

#include <soundor/runtime/RuntimeHost.h>

#import <AppKit/AppKit.h>
#include <objc/message.h>
#include <objc/runtime.h>

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#if ! __has_feature(objc_arc)
    #error "MacPlatform.mm is built with ARC (-fobjc-arc)"
#endif

#define SOUNDOR_STRINGIFY_(x) #x
#define SOUNDOR_STRINGIFY(x) SOUNDOR_STRINGIFY_(x)

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
{
    namespace
    {
        // What elements share with their bridge.
        struct Channel
        {
            std::mutex mutex;
            std::vector<ActionRequest> requests;
        };
        using Channels = Registry<Channel>;

        std::atomic<bool> forced { false };

        // Associated-object keys: an element's bridge token, node id and the
        // actions it offers (a bit per Action).
        const char tokenKey = 0;
        const char nodeKey = 0;
        const char offersKey = 0;

        std::uint32_t bit(Action action)
        {
            return std::uint32_t { 1 } << static_cast<unsigned>(action);
        }

        std::uint64_t number(id object, const void* key)
        {
            id value = objc_getAssociatedObject(object, key);
            return [value isKindOfClass:[NSNumber class]] ? [static_cast<NSNumber*>(value) unsignedLongLongValue] : 0;
        }

        // A request from an element, for its bridge; whether it was taken.
        bool ask(id element, Action action, std::string name = {},
                 std::variant<std::monostate, double, std::string> value = {})
        {
            const auto channel = Channels::instance().find(static_cast<std::uintptr_t>(number(element, &tokenKey)));
            if (channel == nullptr)
                return false;
            if (action != Action::Custom && (number(element, &offersKey) & bit(action)) == 0)
                return false;
            const std::scoped_lock lock(channel->mutex);
            channel->requests.push_back({ number(element, &nodeKey), action, std::move(name), std::move(value) });
            return true;
        }

        // ── The element class ───────────────────────────────────────────────

        BOOL performPress(id self, SEL)
        {
            return ask(self, Action::Activate) ? YES : NO;
        }

        BOOL performIncrement(id self, SEL)
        {
            return ask(self, Action::Increment) ? YES : NO;
        }

        BOOL performDecrement(id self, SEL)
        {
            return ask(self, Action::Decrement) ? YES : NO;
        }

        BOOL performCancel(id self, SEL)
        {
            return ask(self, Action::Escape) ? YES : NO;
        }

        // Assistive technology setting a value or focus asks for it; the
        // bridge sets what is shown through NSAccessibilityElement's own
        // setters (superSet below).
        void setValue(id self, SEL, id value)
        {
            if ([value isKindOfClass:[NSString class]])
                ask(self, Action::SetValue, {}, std::string([static_cast<NSString*>(value) UTF8String]));
            else if ([value isKindOfClass:[NSNumber class]])
                ask(self, Action::SetValue, {}, [static_cast<NSNumber*>(value) doubleValue]);
        }

        void setFocused(id self, SEL, BOOL focused)
        {
            if (focused == YES)
                ask(self, Action::Focus);
        }

        // NSAccessibilityElement's own implementation of `selector`.
        IMP baseImplementation(SEL selector)
        {
            return class_getMethodImplementation([NSAccessibilityElement class], selector);
        }

        BOOL selectorAllowed(id self, SEL command, SEL selector)
        {
            std::optional<Action> action;
            if (selector == @selector(accessibilityPerformPress))
                action = Action::Activate;
            else if (selector == @selector(accessibilityPerformIncrement))
                action = Action::Increment;
            else if (selector == @selector(accessibilityPerformDecrement))
                action = Action::Decrement;
            else if (selector == @selector(accessibilityPerformCancel))
                action = Action::Escape;
            else if (selector == @selector(setAccessibilityValue:))
                action = Action::SetValue;
            else if (selector == @selector(setAccessibilityFocused:))
                action = Action::Focus;
            if (action)
                return (number(self, &offersKey) & bit(*action)) != 0 ? YES : NO;
            using Allowed = BOOL (*)(id, SEL, SEL);
            return reinterpret_cast<Allowed>(baseImplementation(command))(self, command, selector);
        }

        void addMethod(Class cls, SEL selector, IMP implementation)
        {
            Method base = class_getInstanceMethod([NSAccessibilityElement class], selector);
            class_addMethod(cls, selector, implementation, method_getTypeEncoding(base));
        }

        Class elementClass()
        {
            static Class cls = []
            {
                // From here on the runtime holds methods in this binary.
                pinModule();
                std::string name;
                do
                {
                    std::uint64_t random[2] {};
                    arc4random_buf(random, sizeof random);
                    char suffix[40];
                    std::snprintf(suffix, sizeof suffix, "%016llx%016llx", static_cast<unsigned long long>(random[0]),
                                  static_cast<unsigned long long>(random[1]));
                    name = std::string("SoundorAXElement_") + SOUNDOR_STRINGIFY(SOUNDOR_ABI_NAMESPACE) + "_" + suffix;
                } while (objc_getClass(name.c_str()) != nil);
                Class created = objc_allocateClassPair([NSAccessibilityElement class], name.c_str(), 0);
                addMethod(created, @selector(accessibilityPerformPress), reinterpret_cast<IMP>(performPress));
                addMethod(created, @selector(accessibilityPerformIncrement), reinterpret_cast<IMP>(performIncrement));
                addMethod(created, @selector(accessibilityPerformDecrement), reinterpret_cast<IMP>(performDecrement));
                addMethod(created, @selector(accessibilityPerformCancel), reinterpret_cast<IMP>(performCancel));
                addMethod(created, @selector(setAccessibilityValue:), reinterpret_cast<IMP>(setValue));
                addMethod(created, @selector(setAccessibilityFocused:), reinterpret_cast<IMP>(setFocused));
                addMethod(created, @selector(isAccessibilitySelectorAllowed:), reinterpret_cast<IMP>(selectorAllowed));
                objc_registerClassPair(created);
                return created;
            }();
            return cls;
        }

        void superSetValue(id element, id value)
        {
            using Set = void (*)(id, SEL, id);
            reinterpret_cast<Set>(baseImplementation(@selector(setAccessibilityValue:)))(
                element, @selector(setAccessibilityValue:), value);
        }

        void superSetFocused(id element, BOOL focused)
        {
            using Set = void (*)(id, SEL, BOOL);
            reinterpret_cast<Set>(baseImplementation(@selector(setAccessibilityFocused:)))(
                element, @selector(setAccessibilityFocused:), focused);
        }

        // ── Semantics in AppKit's terms ─────────────────────────────────────

        NSString* string(const std::string& text)
        {
            return [NSString stringWithUTF8String:text.c_str()];
        }

        struct AppKitRole
        {
            NSAccessibilityRole role;
            NSAccessibilitySubrole subrole;
        };

        AppKitRole appKitRole(Role role)
        {
            switch (role)
            {
                case Role::Text:
                    return { NSAccessibilityStaticTextRole, nil };
                case Role::Image:
                    return { NSAccessibilityImageRole, nil };
                case Role::Button:
                case Role::KeyboardKey:
                    return { NSAccessibilityButtonRole, nil };
                case Role::ToggleButton:
                    return { NSAccessibilityCheckBoxRole, NSAccessibilityToggleSubrole };
                case Role::Link:
                    return { NSAccessibilityLinkRole, nil };
                case Role::Adjustable:
                    return { NSAccessibilitySliderRole, nil };
                case Role::CheckBox:
                    return { NSAccessibilityCheckBoxRole, nil };
                case Role::Switch:
                    return { NSAccessibilityCheckBoxRole, NSAccessibilitySwitchSubrole };
                case Role::Radio:
                    return { NSAccessibilityRadioButtonRole, nil };
                case Role::RadioGroup:
                    return { NSAccessibilityRadioGroupRole, nil };
                case Role::ProgressBar:
                    return { NSAccessibilityProgressIndicatorRole, nil };
                case Role::ComboBox:
                    return { NSAccessibilityPopUpButtonRole, nil };
                case Role::Menu:
                    return { NSAccessibilityMenuRole, nil };
                case Role::MenuBar:
                    return { NSAccessibilityMenuBarRole, nil };
                case Role::MenuItem:
                    return { NSAccessibilityMenuItemRole, nil };
                case Role::ScrollBar:
                    return { NSAccessibilityScrollBarRole, nil };
                case Role::SpinButton:
                    return { NSAccessibilityIncrementorRole, nil };
                case Role::Tab:
                    return { NSAccessibilityRadioButtonRole, NSAccessibilityTabButtonSubrole };
                case Role::TabList:
                    return { NSAccessibilityTabGroupRole, nil };
                case Role::Header:
                    return { @"AXHeading", nil };
                case Role::Toolbar:
                    return { NSAccessibilityToolbarRole, nil };
                case Role::Dialog:
                    return { NSAccessibilityGroupRole, NSAccessibilityDialogSubrole };
                case Role::TextInput:
                    return { NSAccessibilityTextFieldRole, nil };
                case Role::ScrollView:
                    return { NSAccessibilityScrollAreaRole, nil };
                case Role::Alert:
                case Role::Search:
                case Role::Summary:
                case Role::Timer:
                case Role::Group:
                case Role::None:
                case Role::View:
                    return { NSAccessibilityGroupRole, nil };
            }
            return { NSAccessibilityGroupRole, nil };
        }

        bool isRange(Role role)
        {
            return role == Role::Adjustable || role == Role::ProgressBar || role == Role::ScrollBar
                   || role == Role::SpinButton;
        }

        std::uint32_t offers(const Node& node)
        {
            std::uint32_t bits = 0;
            for (const ActionDescriptor& action : node.actions)
                bits |= bit(action.action);
            return bits;
        }

        // The actions VoiceOver lists by name: custom ones, and those AppKit
        // has no standard action for.
        NSArray<NSAccessibilityCustomAction*>* customActions(const Node& node, std::uintptr_t token)
        {
            NSMutableArray<NSAccessibilityCustomAction*>* out = [NSMutableArray array];
            for (const ActionDescriptor& action : node.actions)
            {
                NSString* name = nil;
                switch (action.action)
                {
                    case Action::Custom:
                        name = string(action.label.empty() ? action.name : action.label);
                        break;
                    case Action::LongPress:
                        name = action.label.empty() ? @"Long press" : string(action.label);
                        break;
                    case Action::Expand:
                        name = action.label.empty() ? @"Expand" : string(action.label);
                        break;
                    case Action::Collapse:
                        name = action.label.empty() ? @"Collapse" : string(action.label);
                        break;
                    default:
                        continue;
                }
                const ActionRequest request {
                    node.id, action.action, action.action == Action::Custom ? action.name : std::string(), {}
                };
                [out addObject:[[NSAccessibilityCustomAction alloc] initWithName:name
                                                                         handler:^BOOL {
                                                                           const auto channel =
                                                                               Channels::instance().find(token);
                                                                           if (channel == nullptr)
                                                                               return NO;
                                                                           const std::scoped_lock lock(channel->mutex);
                                                                           channel->requests.push_back(request);
                                                                           return YES;
                                                                         }]];
            }
            return out;
        }

        void configure(NSAccessibilityElement* element, const Node& node, std::uintptr_t token)
        {
            const AppKitRole role = appKitRole(node.role);
            [element setAccessibilityElement:YES];
            [element setAccessibilityRole:role.role];
            [element setAccessibilitySubrole:role.subrole];
            if (node.role == Role::Text)
            {
                [element setAccessibilityLabel:nil];
                superSetValue(element, string(node.label));
            }
            else
                [element setAccessibilityLabel:node.label.empty() ? nil : string(node.label)];
            [element setAccessibilityHelp:node.hint.empty() ? nil : string(node.hint)];
            [element setAccessibilityEnabled:node.state.disabled ? NO : YES];
            [element setAccessibilitySelected:node.state.selected.value_or(false) ? YES : NO];
            [element setAccessibilityExpanded:node.state.expanded.value_or(false) ? YES : NO];
            [element setAccessibilityModal:node.modal ? YES : NO];

            if (node.role == Role::TextInput)
            {
                superSetValue(element, string(node.value.text));
                [element setAccessibilityPlaceholderValue:node.placeholder.empty() ? nil : string(node.placeholder)];
            }
            else if (node.state.checked != Checked::Unset)
                superSetValue(element, @(node.state.checked == Checked::True    ? 1
                                         : node.state.checked == Checked::Mixed ? 2
                                                                                : 0));
            else if (isRange(node.role) && node.value.now)
                superSetValue(element, @(*node.value.now));
            else if (node.role != Role::Text)
                superSetValue(element, node.value.text.empty() ? nil : string(node.value.text));
            [element setAccessibilityMinValue:node.value.min ? @(*node.value.min) : nil];
            [element setAccessibilityMaxValue:node.value.max ? @(*node.value.max) : nil];
            [element setAccessibilityValueDescription:isRange(node.role) && ! node.value.text.empty()
                                                          ? string(node.value.text)
                                                          : nil];

            objc_setAssociatedObject(element, &tokenKey, @(static_cast<unsigned long long>(token)),
                                     OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            objc_setAssociatedObject(element, &nodeKey, @(static_cast<unsigned long long>(node.id)),
                                     OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            objc_setAssociatedObject(element, &offersKey, @(offers(node)), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            [element setAccessibilityCustomActions:customActions(node, token)];
        }

        // ── The bridge ──────────────────────────────────────────────────────

        class MacPlatform final : public PlatformAccessibility
        {
        public:
            MacPlatform(NSView* hostView, id parentElement)
                : view(hostView),
                  parent(parentElement != nil ? parentElement : hostView),
                  channel(std::make_shared<Channel>()),
                  token(Channels::instance().enroll(channel)),
                  container([[NSAccessibilityElement alloc] init]),
                  elements([NSMutableDictionary dictionary])
            {
                // Holds the elements for the framework; not one itself.
                [container setAccessibilityElement:NO];
                [container setAccessibilityRole:NSAccessibilityGroupRole];
                [container setAccessibilityParent:parent];
            }

            ~MacPlatform() override
            {
                clear();
                Channels::instance().withdraw(token);
            }

            MacPlatform(const MacPlatform&) = delete;
            MacPlatform& operator=(const MacPlatform&) = delete;

            void tick(RuntimeHost& host) override
            {
                std::vector<ActionRequest> requests;
                {
                    const std::scoped_lock lock(channel->mutex);
                    requests.swap(channel->requests);
                }
                const bool sameHost = &host == lastHost;
                for (const ActionRequest& request : requests)
                    if (sameHost)
                        host.performAccessibilityAction(request);

                const bool on = active();
                if (! on)
                {
                    if (wasActive)
                        clear();
                    wasActive = false;
                    return;
                }
                const bool full = ! wasActive || ! sameHost;
                wasActive = true;
                lastHost = &host;
                apply(host.accessibility().update(full));
                refreshFrames(false);
            }

            void setGeometry(const ViewGeometry& next) override
            {
                if (next == geometry)
                    return;
                geometry = next;
                refreshFrames(true);
            }

            void setFocused(bool) override {}

            [[nodiscard]] bool active() const override
            {
                if (forced)
                    return true;
                NSWorkspace* workspace = [NSWorkspace sharedWorkspace];
                return [workspace isVoiceOverEnabled] || [workspace isSwitchControlEnabled];
            }

            [[nodiscard]] void* accessibilityContainer() const override { return (__bridge void*)container; }

        private:
            NSAccessibilityElement* element(NodeId id) const
            {
                return elements[@(static_cast<unsigned long long>(id))];
            }

            NSArray* elementsOf(const std::vector<NodeId>& ids) const
            {
                NSMutableArray* out = [NSMutableArray arrayWithCapacity:ids.size()];
                for (const NodeId id : ids)
                    if (NSAccessibilityElement* found = element(id))
                        [out addObject:found];
                return out;
            }

            // Everything gone: VoiceOver is told, and keeps nothing usable.
            void clear()
            {
                for (NSAccessibilityElement* gone in [elements allValues])
                    NSAccessibilityPostNotification(gone, NSAccessibilityUIElementDestroyedNotification);
                [elements removeAllObjects];
                [container setAccessibilityChildren:@[]];
                mirror = {};
                focused = noNode;
                NSAccessibilityPostNotification(parent, NSAccessibilityLayoutChangedNotification);
            }

            void apply(const TreeUpdate& changes)
            {
                if (changes.empty())
                    return;
                if (changes.full)
                    clear();
                bool layout = changes.full;
                for (const NodeId id : changes.removed)
                    if (NSAccessibilityElement* gone = element(id))
                    {
                        NSAccessibilityPostNotification(gone, NSAccessibilityUIElementDestroyedNotification);
                        [elements removeObjectForKey:@(static_cast<unsigned long long>(id))];
                        layout = true;
                    }

                // Create and describe them all first, then link them.
                std::vector<NSAccessibilityElement*> valueChanged;
                std::vector<NSAccessibilityElement*> titleChanged;
                const NodeId root = changes.root;
                for (const Node& node : changes.nodes)
                {
                    if (node.id == root)
                        continue;
                    NSAccessibilityElement* target = element(node.id);
                    const Node* before = mirror.find(node.id);
                    if (target == nil)
                    {
                        target = [[elementClass() alloc] init];
                        elements[@(static_cast<unsigned long long>(node.id))] = target;
                        layout = true;
                    }
                    configure(target, node, token);
                    if (before != nullptr)
                    {
                        if (before->value != node.value || before->state.checked != node.state.checked)
                            valueChanged.push_back(target);
                        if (before->label != node.label)
                            titleChanged.push_back(target);
                    }
                }
                for (const Node& node : changes.nodes)
                {
                    const Node* before = mirror.find(node.id);
                    if (before != nullptr && before->children == node.children && ! changes.full)
                        continue;
                    layout = true;
                    NSArray* children = elementsOf(node.children);
                    id owner = node.id == root ? parent : element(node.id);
                    for (NSAccessibilityElement* child in children)
                        [child setAccessibilityParent:owner];
                    if (node.id == root)
                        [container setAccessibilityChildren:children];
                    else
                        [element(node.id) setAccessibilityChildren:children];
                }
                mirror.apply(changes);
                for (const Node& node : changes.nodes)
                    frame(node);

                for (NSAccessibilityElement* changed : valueChanged)
                    NSAccessibilityPostNotification(changed, NSAccessibilityValueChangedNotification);
                for (NSAccessibilityElement* changed : titleChanged)
                    NSAccessibilityPostNotification(changed, NSAccessibilityTitleChangedNotification);
                if (layout)
                    NSAccessibilityPostNotification(parent, NSAccessibilityLayoutChangedNotification);
                if (changes.focus != focused)
                {
                    if (NSAccessibilityElement* was = element(focused))
                        superSetFocused(was, NO);
                    focused = changes.focus;
                    if (NSAccessibilityElement* now = element(focused))
                    {
                        superSetFocused(now, YES);
                        NSAccessibilityPostNotification(now, NSAccessibilityFocusedUIElementChangedNotification);
                    }
                }
            }

            // Logical surface pixels to screen coordinates (y up), through
            // the view and its window, wherever they are now.
            NSRect screenRect(const Rect& bounds) const
            {
                NSView* shown = view;
                NSWindow* window = [shown window];
                if (window == nil)
                    return NSZeroRect;
                const CGFloat scale = geometry.scale;
                NSRect rect = NSMakeRect(geometry.x + bounds.x * scale, geometry.y + bounds.y * scale,
                                         bounds.width * scale, bounds.height * scale);
                if (! [shown isFlipped])
                    rect.origin.y = NSHeight([shown bounds]) - rect.origin.y - rect.size.height;
                return [window convertRectToScreen:[shown convertRect:rect toView:nil]];
            }

            void frame(const Node& node)
            {
                if (NSAccessibilityElement* target = element(node.id))
                    [target setAccessibilityFrame:screenRect(node.bounds)];
            }

            // Frames are screen coordinates: when the view or its window moved,
            // every element's is out of date.
            void refreshFrames(bool force)
            {
                const NSRect where = screenRect({ 0, 0, 1, 1 });
                if (! force && NSEqualRects(where, placed))
                    return;
                placed = where;
                for (NSNumber* key in [elements allKeys])
                    if (const Node* node = mirror.find([key unsignedLongLongValue]))
                        frame(*node);
            }

            // Weak: the framework owns both.
            __weak NSView* view;
            __weak id parent;
            std::shared_ptr<Channel> channel;
            std::uintptr_t token;
            NSAccessibilityElement* container;
            NSMutableDictionary<NSNumber*, NSAccessibilityElement*>* elements;
            Tree mirror;
            ViewGeometry geometry;
            NSRect placed = NSZeroRect;
            NodeId focused = noNode;
            const RuntimeHost* lastHost = nullptr;
            bool wasActive = false;
        };
    } // namespace

    std::unique_ptr<PlatformAccessibility> createMacPlatform(const PlatformOptions& options)
    {
        if (options.view.handle == nullptr)
            return nullptr;
        return std::make_unique<MacPlatform>((__bridge NSView*)options.view.handle,
                                             (__bridge id)options.view.accessibilityParent);
    }

    void forceMacAccessibility(bool on)
    {
        forced = on;
    }

    std::string macElementClassName()
    {
        return class_getName(elementClass());
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
