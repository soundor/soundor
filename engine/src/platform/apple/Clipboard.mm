#include <soundor/platform/Clipboard.h>

#include <TargetConditionals.h>
#if TARGET_OS_IPHONE
    #import <UIKit/UIKit.h>
#else
    #import <AppKit/AppKit.h>
#endif

#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    namespace
    {
        class AppleClipboard final : public ui::Clipboard
        {
        public:
            std::string readText() override
            {
                @autoreleasepool
                {
#if TARGET_OS_IPHONE
                    NSString* value = UIPasteboard.generalPasteboard.string;
#else
                    NSString* value = [NSPasteboard.generalPasteboard stringForType:NSPasteboardTypeString];
#endif
                    const char* bytes = value.UTF8String;
                    return bytes == nullptr
                               ? std::string {}
                               : std::string(bytes, [value lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
                }
            }

            void writeText(std::string text) override
            {
                @autoreleasepool
                {
                    NSString* value = [[NSString alloc] initWithBytes:text.data()
                                                               length:text.size()
                                                             encoding:NSUTF8StringEncoding];
                    if (value == nil)
                        return;
#if TARGET_OS_IPHONE
                    UIPasteboard.generalPasteboard.string = value;
#else
                    NSPasteboard* clipboard = NSPasteboard.generalPasteboard;
                    [clipboard clearContents];
                    [clipboard setString:value forType:NSPasteboardTypeString];
#endif
                }
            }
        };
    } // namespace

    std::shared_ptr<ui::Clipboard> systemClipboard()
    {
        return std::make_shared<AppleClipboard>();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
