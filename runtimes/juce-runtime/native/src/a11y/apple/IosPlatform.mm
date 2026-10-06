// Soundor's iOS accessibility bridge: the semantic tree as virtual
// UIAccessibilityElements in the UIView the surface is drawn in. Same rules as
// the macOS bridge (see README.md): one runtime-made element class per
// binary, no swizzling, elements reach the bridge by token only, the binary
// pinned once the class exists, requests performed by tick().
//
// iOS differs in how a tree is made: an element that is an accessibility
// element hides what it holds from VoiceOver, so containers (a dialog, a
// toolbar) are not elements themselves but hold their children in
// accessibilityElements, labelled as a semantic group.

#include "a11y/apple/IosPlatform.h"

#include "a11y/apple/AppleShared.h"

#include <soundor/runtime/RuntimeHost.h>

#import <UIKit/UIKit.h>
#include <objc/runtime.h>

#include <atomic>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

#if ! __has_feature(objc_arc)
    #error "IosPlatform.mm is built with ARC (-fobjc-arc)"
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
{
    namespace
    {
        using namespace apple;

        std::atomic<bool> forced { false };

        // ── The element class ───────────────────────────────────────────────

        // Double tap. Not offered: VoiceOver taps the element's centre
        // instead, which reaches the view as any touch does.
        BOOL activate(id self, SEL)
        {
            return ask(self, Action::Activate) ? YES : NO;
        }

        // Swipe up and down on an adjustable element.
        void increment(id self, SEL)
        {
            ask(self, Action::Increment);
        }

        void decrement(id self, SEL)
        {
            ask(self, Action::Decrement);
        }

        // The two-finger scrub.
        BOOL escape(id self, SEL)
        {
            return ask(self, Action::Escape) ? YES : NO;
        }

        Class elementClass()
        {
            static Class cls =
                makeElementClass([UIAccessibilityElement class],
                                 {
                                     {
                                         @selector(accessibilityActivate), reinterpret_cast<IMP>(activate)
                                     }
                                     ,
                                     {
                                         @selector(accessibilityIncrement), reinterpret_cast<IMP>(increment)
                                     }
                                     ,
                                     {
                                         @selector(accessibilityDecrement), reinterpret_cast<IMP>(decrement)
                                     }
                                     ,
                                     {
                                         @selector(accessibilityPerformEscape), reinterpret_cast<IMP>(escape)
                                     }
                                     ,
                                 });
            return cls;
        }

        // ── Semantics in UIKit's terms ──────────────────────────────────────

        bool isRange(Role role)
        {
            return role == Role::Adjustable || role == Role::ProgressBar || role == Role::ScrollBar
                   || role == Role::SpinButton;
        }

        // Read as one element; anything else is a container of its children.
        bool isLeaf(const Node& node)
        {
            return node.children.empty() || isLeafRole(node.role);
        }

        UIAccessibilityTraits traitsOf(const Node& node)
        {
            UIAccessibilityTraits traits = UIAccessibilityTraitNone;
            switch (node.role)
            {
                case Role::Button:
                case Role::ToggleButton:
                case Role::CheckBox:
                case Role::Switch:
                case Role::Radio:
                case Role::Tab:
                case Role::MenuItem:
                case Role::ComboBox:
                    traits |= UIAccessibilityTraitButton;
                    break;
                case Role::KeyboardKey:
                    traits |= UIAccessibilityTraitKeyboardKey;
                    break;
                case Role::Link:
                    traits |= UIAccessibilityTraitLink;
                    break;
                case Role::Image:
                    traits |= UIAccessibilityTraitImage;
                    break;
                case Role::Text:
                    traits |= UIAccessibilityTraitStaticText;
                    break;
                case Role::Header:
                    traits |= UIAccessibilityTraitHeader;
                    break;
                case Role::Adjustable:
                case Role::SpinButton:
                    traits |= UIAccessibilityTraitAdjustable;
                    break;
                case Role::ProgressBar:
                case Role::Timer:
                    traits |= UIAccessibilityTraitUpdatesFrequently;
                    break;
                case Role::Search:
                    traits |= UIAccessibilityTraitSearchField;
                    break;
                case Role::TabList:
                    traits |= UIAccessibilityTraitTabBar;
                    break;
                default:
                    break;
            }
            if (@available(iOS 17.0, *))
                if (node.role == Role::Switch || node.role == Role::CheckBox || node.role == Role::ToggleButton)
                    traits |= UIAccessibilityTraitToggleButton;
            if (node.state.disabled)
                traits |= UIAccessibilityTraitNotEnabled;
            if (node.state.selected.value_or(false) || (node.role == Role::Tab && node.state.checked == Checked::True))
                traits |= UIAccessibilityTraitSelected;
            return traits;
        }

        NSString* valueOf(const Node& node)
        {
            if (node.role == Role::TextInput)
                return string(node.value.text);
            if (node.state.checked != Checked::Unset)
                return node.state.checked == Checked::True    ? @"1"
                       : node.state.checked == Checked::Mixed ? @"mixed"
                                                              : @"0";
            if (! node.value.text.empty())
                return string(node.value.text);
            if (isRange(node.role) && node.value.now)
                return [NSNumberFormatter localizedStringFromNumber:@(*node.value.now)
                                                        numberStyle:NSNumberFormatterDecimalStyle];
            return nil;
        }

        NSArray<UIAccessibilityCustomAction*>* customActions(const Node& node, std::uintptr_t token)
        {
            NSMutableArray<UIAccessibilityCustomAction*>* out = [NSMutableArray array];
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
                [out addObject:[[UIAccessibilityCustomAction alloc] initWithName:name
                                                                   actionHandler:^BOOL(UIAccessibilityCustomAction*) {
                                                                     return ask(token, request) ? YES : NO;
                                                                   }]];
            }
            return out;
        }

        void configure(UIAccessibilityElement* element, const Node& node, std::uintptr_t token)
        {
            const bool leaf = isLeaf(node);
            element.isAccessibilityElement = leaf ? YES : NO;
            element.accessibilityLabel = node.label.empty() ? nil : string(node.label);
            element.accessibilityHint = node.hint.empty() ? nil : string(node.hint);
            element.accessibilityValue = valueOf(node);
            element.accessibilityTraits = traitsOf(node);
            element.accessibilityViewIsModal = node.modal ? YES : NO;
            if (! leaf)
                element.accessibilityContainerType = UIAccessibilityContainerTypeSemanticGroup;
            element.accessibilityCustomActions = customActions(node, token);
            tag(element, token, node);
        }

        // ── The bridge ──────────────────────────────────────────────────────

        class IosPlatform final : public PlatformAccessibility
        {
        public:
            explicit IosPlatform(UIView* hostView)
                : view(hostView),
                  channel(std::make_shared<Channel>()),
                  token(Channels::instance().enroll(channel)),
                  container([[UIAccessibilityElement alloc] initWithAccessibilityContainer:hostView]),
                  elements([NSMutableDictionary dictionary])
            {
                // Holds the elements for the framework; not one itself.
                container.isAccessibilityElement = NO;
                container.accessibilityElements = @[];
            }

            ~IosPlatform() override
            {
                clear();
                Channels::instance().withdraw(token);
            }

            IosPlatform(const IosPlatform&) = delete;
            IosPlatform& operator=(const IosPlatform&) = delete;

            void tick(RuntimeHost& host) override
            {
                const bool sameHost = &host == lastHost;
                for (const ActionRequest& request : take(*channel))
                    if (sameHost)
                    {
                        if (request.action == Action::Increment || request.action == Action::Decrement)
                            adjusted.insert(request.target);
                        host.performAccessibilityAction(request);
                    }

                if (! active())
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
                return forced || UIAccessibilityIsVoiceOverRunning() || UIAccessibilityIsSwitchControlRunning();
            }

            [[nodiscard]] void* accessibilityContainer() const override { return (__bridge void*)container; }

        private:
            UIAccessibilityElement* element(NodeId id) const
            {
                return elements[@(static_cast<unsigned long long>(id))];
            }

            NSArray* elementsOf(const std::vector<NodeId>& ids) const
            {
                NSMutableArray* out = [NSMutableArray arrayWithCapacity:ids.size()];
                for (const NodeId id : ids)
                    if (UIAccessibilityElement* found = element(id))
                        [out addObject:found];
                return out;
            }

            void clear()
            {
                [elements removeAllObjects];
                container.accessibilityElements = @[];
                mirror = {};
                modal = noNode;
                adjusted.clear();
                UIAccessibilityPostNotification(UIAccessibilityLayoutChangedNotification, nil);
            }

            void apply(const TreeUpdate& changes)
            {
                if (changes.empty())
                    return;
                if (changes.full)
                    clear();
                bool layout = changes.full;
                for (const NodeId id : changes.removed)
                    if (element(id) != nil)
                    {
                        [elements removeObjectForKey:@(static_cast<unsigned long long>(id))];
                        layout = true;
                    }

                std::vector<UIAccessibilityElement*> announce;
                const NodeId root = changes.root;
                // A node's element is made inside its parent, so parents first:
                // the update lists the root first, then reading order.
                for (const Node& node : changes.nodes)
                {
                    if (node.id == root)
                        continue;
                    UIAccessibilityElement* target = element(node.id);
                    const Node* before = mirror.find(node.id);
                    if (target == nil)
                    {
                        target = [[elementClass() alloc] initWithAccessibilityContainer:container];
                        elements[@(static_cast<unsigned long long>(node.id))] = target;
                        layout = true;
                    }
                    configure(target, node, token);
                    // VoiceOver reads the value right after an increment, before
                    // plugin code answered: say the new one when it arrives.
                    if (before != nullptr && before->value != node.value && adjusted.contains(node.id))
                        announce.push_back(target);
                }
                adjusted.clear();
                for (const Node& node : changes.nodes)
                {
                    const Node* before = mirror.find(node.id);
                    if (before != nullptr && before->children == node.children && ! changes.full)
                        continue;
                    layout = true;
                    NSArray* children = elementsOf(node.children);
                    id owner = node.id == root ? static_cast<id>(container) : element(node.id);
                    for (UIAccessibilityElement* child in children)
                        child.accessibilityContainer = owner;
                    if (node.id == root)
                        container.accessibilityElements = children;
                    else
                        element(node.id).accessibilityElements = children;
                }
                mirror.apply(changes);
                for (const Node& node : changes.nodes)
                    frame(node);

                // A modal opening or closing is a new screen to VoiceOver.
                const NodeId nextModal = activeModal();
                if (nextModal != modal)
                {
                    modal = nextModal;
                    UIAccessibilityPostNotification(UIAccessibilityScreenChangedNotification, element(modal));
                }
                else if (layout)
                    UIAccessibilityPostNotification(UIAccessibilityLayoutChangedNotification, nil);
                for (UIAccessibilityElement* changed : announce)
                    if (changed.accessibilityValue != nil)
                        UIAccessibilityPostNotification(UIAccessibilityAnnouncementNotification,
                                                        changed.accessibilityValue);
            }

            NodeId activeModal() const
            {
                const Node* root = mirror.find(mirror.root());
                if (root == nullptr || root->children.size() != 1)
                    return noNode;
                const Node* only = mirror.find(root->children.front());
                return only != nullptr && only->modal ? only->id : noNode;
            }

            CGRect screenRect(const Rect& bounds) const
            {
                UIView* shown = view;
                if (shown == nil || shown.window == nil)
                    return CGRectZero;
                const CGFloat scale = geometry.scale;
                const CGRect rect = CGRectMake(geometry.x + bounds.x * scale, geometry.y + bounds.y * scale,
                                               bounds.width * scale, bounds.height * scale);
                return UIAccessibilityConvertFrameToScreenCoordinates(rect, shown);
            }

            void frame(const Node& node)
            {
                if (UIAccessibilityElement* target = element(node.id))
                    target.accessibilityFrame = screenRect(node.bounds);
            }

            void refreshFrames(bool force)
            {
                const CGRect where = screenRect({ 0, 0, 1, 1 });
                if (! force && CGRectEqualToRect(where, placed))
                    return;
                placed = where;
                for (NSNumber* key in [elements allKeys])
                    if (const Node* node = mirror.find([key unsignedLongLongValue]))
                        frame(*node);
            }

            // Weak: the framework owns it.
            __weak UIView* view;
            std::shared_ptr<Channel> channel;
            std::uintptr_t token;
            UIAccessibilityElement* container;
            NSMutableDictionary<NSNumber*, UIAccessibilityElement*>* elements;
            Tree mirror;
            ViewGeometry geometry;
            CGRect placed = CGRectZero;
            NodeId modal = noNode;
            std::unordered_set<NodeId> adjusted;
            const RuntimeHost* lastHost = nullptr;
            bool wasActive = false;
        };
    } // namespace

    std::unique_ptr<PlatformAccessibility> createIosPlatform(const PlatformOptions& options)
    {
        if (options.view.handle == nullptr)
            return nullptr;
        return std::make_unique<IosPlatform>((__bridge UIView*)options.view.handle);
    }

    void forceIosAccessibility(bool on)
    {
        forced = on;
    }

    std::string iosElementClassName()
    {
        return class_getName(elementClass());
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
