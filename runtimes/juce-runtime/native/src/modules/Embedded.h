#pragma once

// The JavaScript of the runtime-provided modules, embedded at build time (see
// soundor_embed_module() in cmake/SoundorEmbed.cmake): each module's Hermes
// bytecode when the build could compile it (hermesc), else its source, in
// the runtime's module form (src/generated/, made from the modules here by
// scripts/native-modules.mjs).

#include <soundor/Config.h>

#include <cstdint>
#include <span>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
{
    // One of them is set. The source is pointed to, not copied: a long one
    // is joined when the program starts, after constants like this are made.
    struct ModuleCode
    {
        const std::string_view* source = nullptr;
        std::span<const std::uint8_t> bytecode;

        [[nodiscard]] std::string_view text() const noexcept
        {
            return source == nullptr ? std::string_view() : *source;
        }
    };

    extern const ModuleCode languageModule;         // js/language.js
    extern const ModuleCode parametersModule;       // modules/parameters/parameters.js
    extern const ModuleCode fsModule;               // modules/fs/fs.js
    extern const ModuleCode hostModule;             // modules/host/host.js
    extern const ModuleCode storageModule;          // modules/storage/storage.js
    extern const ModuleCode uiModule;               // modules/ui/ui.js
    extern const ModuleCode uiFramesModule;         // modules/ui/frames.js
    extern const ModuleCode uiCanvasModule;         // modules/ui/canvas.js
    extern const ModuleCode uiWebGLModule;          // gpu/webgl/webgl.js
    extern const ModuleCode uiWebGLGeneratedModule; // gpu/webgl/generated/webgl-generated.js

    // web/js/*.js
    extern const ModuleCode abortModule;
    extern const ModuleCode base64Module;
    extern const ModuleCode blobModule;
    extern const ModuleCode cloneModule;
    extern const ModuleCode consoleModule;
    extern const ModuleCode cryptoModule;
    extern const ModuleCode domExceptionModule;
    extern const ModuleCode encodingModule;
    extern const ModuleCode eventsModule;
    extern const ModuleCode fetchModule;
    extern const ModuleCode formDataModule;
    extern const ModuleCode inspectModule;
    extern const ModuleCode timersModule;
    extern const ModuleCode urlModule;
    extern const ModuleCode webModule;
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
