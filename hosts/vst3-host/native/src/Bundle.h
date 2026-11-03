// Checks a VST3 bundle before the SDK loads it, so that a missing binary or a
// binary for another CPU is reported as such rather than as the loader's
// generic failure (dlopen, LoadLibrary, CFBundle).
#pragma once

#include <string>
#include <vector>

namespace soundor::vst3host
{
    /** "x64" or "arm64": the architecture this host process runs as. */
    std::string hostArchitecture();

    /** The CPU architectures a Mach-O, ELF or PE file contains ("x64",
        "arm64", "x86", "arm"; empty when the format is unknown). */
    std::vector<std::string> binaryArchitectures(const std::string& path);

    struct BundleCheck
    {
        /** Empty when the bundle can be loaded by this host. Otherwise a
            protocol error code: plugin-not-found, invalid-bundle or
            incompatible-architecture. */
        std::string code;
        std::string message;
        /** The binary the loader will open. */
        std::string binary;
        /** Every architecture the bundle provides a binary for. */
        std::vector<std::string> architectures;
    };

    BundleCheck checkBundle(const std::string& path);
} // namespace soundor::vst3host
