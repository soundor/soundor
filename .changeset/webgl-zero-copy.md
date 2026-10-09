---
'@soundor/juce-runtime': minor
---

WebGL is composited without copies. The generated JUCE editor makes one GPU device for the compositor and the runtime, so a canvas's WebGL image (a texture all the device's contexts share) is drawn by the GPU compositor directly, as a layer of its own. The UI is split into CPU layers below and above it, so a canvas animating every frame re-rasterizes and re-uploads none of the UI. Where the compositor cannot draw it (a CPU compositor, another device, a clip a layer cannot have), the image is read back, and frame statistics count those read-backs. `RuntimeHost::frame()` takes the compositor's capabilities.
