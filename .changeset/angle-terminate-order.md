---
'@soundor/juce-runtime': patch
---

Releasing the GPU no longer crashes on Linux with Vulkan drivers that clean up when a thread exits, such as Mesa's Venus (virtual machines). ANGLE now stops its worker threads before it destroys the Vulkan instance, not after the Vulkan loader has unloaded the driver.
