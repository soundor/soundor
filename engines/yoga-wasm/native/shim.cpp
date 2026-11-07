// What Yoga's C API cannot offer JavaScript directly: a measure function. A
// wasm table cannot hold a JavaScript closure without Emscripten's glue, so a
// node names its measurement by an integer, and one imported function
// dispatches them all. Nothing in wasm then keeps a JavaScript object alive.
#include <yoga/Yoga.h>

#include <cstdint>

extern "C"
{
    __attribute__((import_module("env"), import_name("measure")))
    void soundorMeasure(std::int32_t id, float width, std::int32_t widthMode, float height, std::int32_t heightMode,
                        float* size);

    static YGSize measure(YGNodeConstRef node, float width, YGMeasureMode widthMode, float height,
                          YGMeasureMode heightMode)
    {
        float size[2] = { 0, 0 };
        const auto id = static_cast<std::int32_t>(reinterpret_cast<std::intptr_t>(YGNodeGetContext(node)));
        soundorMeasure(id, width, static_cast<std::int32_t>(widthMode), height, static_cast<std::int32_t>(heightMode),
                       size);
        return { size[0], size[1] };
    }

    __attribute__((export_name("soundorSetMeasure"))) void soundorSetMeasure(YGNodeRef node, std::int32_t id)
    {
        YGNodeSetContext(node, reinterpret_cast<void*>(static_cast<std::intptr_t>(id)));
        YGNodeSetMeasureFunc(node, measure);
    }
}
