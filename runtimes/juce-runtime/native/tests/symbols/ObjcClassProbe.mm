// Negative control: an Objective-C class compiled into a binary, which the
// symbol check must refuse.

#import <Foundation/Foundation.h>

@interface UnprefixedProbeClass : NSObject
@end

@implementation UnprefixedProbeClass
@end

extern "C" __attribute__((visibility("default"))) int soundor_probe_entry()
{
    return [[UnprefixedProbeClass alloc] init] != nil ? 1 : 0;
}
