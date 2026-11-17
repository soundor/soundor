// Negative control: an Objective-C category compiled into a binary, which the
// symbol check must refuse (it would add methods to a class every binary in
// the process shares).

#import <Foundation/Foundation.h>

@interface NSObject (UnprefixedProbeCategory)
- (int)unprefixedProbeMethod;
@end

@implementation NSObject (UnprefixedProbeCategory)
- (int)unprefixedProbeMethod
{
    return 1;
}
@end

extern "C" __attribute__((visibility("default"))) int soundor_probe_entry()
{
    return [[[NSObject alloc] init] unprefixedProbeMethod];
}
