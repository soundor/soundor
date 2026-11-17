#include <soundor/debug/Inspector.h>

#if SOUNDOR_DEVTOOLS
    #include <soundor/render/Compositor.h>

    #include <cmath>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
{
    namespace
    {
        using Object = Value::Object;
        using Array = Value::Array;
        constexpr std::array<const char*, 9> propertyNames { "opacity", "translateX",      "translateY",
                                                             "scale",   "scaleX",          "scaleY",
                                                             "rotate",  "backgroundColor", "borderColor" };
        constexpr std::array<const char*, 4> stateNames { "running", "paused", "finished", "cancelled" };
        constexpr std::array<const char*, 5> easingNames { "linear", "ease", "ease-in", "ease-out", "ease-in-out" };
        double milliseconds(std::chrono::steady_clock::duration duration)
        {
            return std::chrono::duration<double, std::milli>(duration).count();
        }
        Value finite(double number)
        {
            return std::isfinite(number) ? Value(number) : Value(nullptr);
        }
    } // namespace

    Value Inspector::animations(RuntimeHost& host, ui::NodeId filter) const
    {
        if (filter != ui::noNode)
            (void)node(host, filter, false);
        Array result;
        std::size_t bytes = 0;
        bool truncated = false;
        for (const auto& animation : host.surface().animations().inspect(filter, &truncated))
        {
            Array targets;
            for (const auto& target : animation.targets)
            {
                Array properties;
                Object presented;
                for (std::size_t index = 0; index < propertyNames.size(); ++index)
                    if ((target.properties & (ui::PropertyMask { 1 } << index)) != 0)
                    {
                        properties.emplace_back(propertyNames[index]);
                        if (index < 7)
                            presented[propertyNames[index]] = target.presentation.values[index];
                        else
                        {
                            const auto& color = target.presentation.colors[index - 7];
                            presented[propertyNames[index]] = Array { color[0], color[1], color[2], color[3] };
                        }
                    }
                targets.emplace_back(Object {
                    { "node", Object { { "generation", currentGeneration }, { "id", std::to_string(target.node) } } },
                    { "properties", properties },
                    { "presentation", presented } });
            }
            Object item { { "id", std::to_string(animation.id) },
                          { "playbackGeneration", animation.playbackGeneration },
                          { "state", stateNames[static_cast<std::size_t>(animation.state)] },
                          { "kind", animation.program     ? "composition"
                                    : animation.spring    ? "spring"
                                    : animation.keyframes ? "keyframes"
                                                          : "timing" },
                          { "elapsedMs", animation.elapsed },
                          { "durationMs", finite(animation.timing.duration) },
                          { "durationScope", animation.program ? "program" : "iteration" },
                          { "delayMs", animation.delay },
                          { "iterations", finite(animation.timing.iterations) },
                          { "targets", targets },
                          { "targetsTruncated", animation.targetsTruncated } };
            if (! animation.program)
                item["easing"] = easingNames[static_cast<std::size_t>(animation.timing.easing)];
            if (animation.keyframes)
                item["keyframeCount"] = animation.keyframes;
            if (animation.spring)
            {
                const auto& spring = *animation.spring;
                item["spring"] = Object { { "stiffness", spring.stiffness },
                                          { "damping", spring.damping },
                                          { "mass", spring.mass },
                                          { "initialVelocity", spring.initialVelocity },
                                          { "restDisplacement", spring.restDisplacement },
                                          { "restVelocity", spring.restVelocity } };
            }
            Value value(std::move(item));
            bytes += value.json().size();
            if (bytes > 900000)
            {
                truncated = true;
                break;
            }
            result.push_back(std::move(value));
        }
        if (truncated && ! result.empty())
            std::get<Object>(result.back().data)["snapshotTruncated"] = true;
        return result;
    }
    Value Inspector::metrics(bool history) const
    {
        Array samples;
        if (history)
            samples.assign(frames.begin(), frames.end());
        else if (! frames.empty())
            samples.push_back(frames.back());
        return Object { { "generation", currentGeneration },
                        { "recording", profiling },
                        { "elapsedMs", elapsedMs },
                        { "frameCount", frameCount },
                        { "delayedTicks", delayedTicks },
                        { "tickDelayThresholdMs", 25 },
                        { "tickIntervalMs", tickIntervalMs },
                        { "phases", phases },
                        { "frames", samples } };
    }
    void Inspector::profileTick(RuntimeHost& host)
    {
        if (! profiling)
            return;
        const auto now = clock();
        elapsedMs = milliseconds(now - recordingStarted);
        tickIntervalMs = milliseconds(now - previousTick);
        if (tickIntervalMs > 25)
            ++delayedTicks;
        previousTick = now;
        if (milliseconds(now - previousSample) < 100)
            return;
        const auto current = host.statistics();
        const auto& before = previousStatistics.tick;
        const auto& after = current.tick;
        const auto delta = [](std::uint64_t latest, std::uint64_t earlier)
        { return static_cast<double>(latest >= earlier ? latest - earlier : 0) / 1e6; };
        phases = Object { { "windowMs", milliseconds(now - previousSample) },
                          { "ticks", after.ticks - before.ticks },
                          { "webMs", delta(after.web, before.web) },
                          { "parameterDispatchMs", delta(after.parameters, before.parameters) },
                          { "promiseJobsMs", delta(after.jobs, before.jobs) },
                          { "animationCallbacksMs", delta(after.animationFrames, before.animationFrames) },
                          { "nativeAnimationMs", delta(after.nativeAnimations, before.nativeAnimations) },
                          { "presentWebGLMs", delta(after.presentWebGL, before.presentWebGL) },
                          { "layoutPasses", current.surface.layoutPasses - previousStatistics.surface.layoutPasses },
                          { "layoutMs",
                            delta(current.surface.layoutNanoseconds, previousStatistics.surface.layoutNanoseconds) },
                          { "styleChanges", current.surface.styleChanges - previousStatistics.surface.styleChanges },
                          { "invalidations", current.surface.invalidations - previousStatistics.surface.invalidations },
                          { "uiCalls", current.runtime.ui.calls - previousStatistics.runtime.ui.calls },
                          { "canvasCalls", current.runtime.canvas.calls - previousStatistics.runtime.canvas.calls },
                          { "webglCalls", current.runtime.webgl.calls - previousStatistics.runtime.webgl.calls } };
        previousStatistics = current;
        previousSample = now;
        event("Diagnostics.metrics", metrics(false));
    }
    void Inspector::renderFrame(RuntimeHost& host, render::Compositor& compositor,
                                const render::Capabilities& capabilities)
    {
        if (! profiling)
        {
            compositor.composite(host.frame(capabilities));
            return;
        }
        const auto before = host.surface().statistics();
        const auto rasterBefore = host.surface().debugRasterTime();
        const auto begin = std::chrono::steady_clock::now();
        const auto& frame = host.frame(capabilities);
        const auto produced = std::chrono::steady_clock::now();
        compositor.composite(frame);
        const auto composed = std::chrono::steady_clock::now();
        ++frameCount;
        const auto now = clock();
        if (! frames.empty() && milliseconds(now - previousFrameSample) < 100)
            return;
        previousFrameSample = now;
        const auto& work = compositor.statistics();
        const auto& raster = frame.statistics;
        frames.emplace_back(Object {
            { "timestampMs", milliseconds(now - recordingStarted) },
            { "frameMs", milliseconds(composed - begin) },
            { "productionMs", milliseconds(produced - begin) },
            { "compositionMs", milliseconds(composed - produced) },
            { "rasterMs", static_cast<double>(host.surface().debugRasterTime() - rasterBefore) / 1e6 },
            { "layoutMs",
              static_cast<double>(host.surface().statistics().layoutNanoseconds - before.layoutNanoseconds) / 1e6 },
            { "mode", capabilities.gpu ? "gpu" : "cpu" },
            { "backend", capabilities.backend },
            { "layerCount", frame.layers.size() },
            { "layersRasterized", raster.layersRasterized },
            { "pixelsRasterized", raster.pixelsRasterized },
            { "gpuLayers", raster.gpuLayers },
            { "gpuReadbacks", raster.gpuReadbacks },
            { "cachedRasterBytes", raster.cachedRasterBytes },
            { "layersComposited", work.layersComposited },
            { "pixelsComposited", work.pixelsComposited },
            { "bytesUploaded", work.bytesUploaded },
            { "textureAllocations", work.textureAllocations },
            { "drawCalls", work.drawCalls },
            { "compositorReadbacks", work.readbacks } });
        if (frames.size() > 300)
            frames.pop_front();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
#endif
