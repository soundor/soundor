---
'@soundor/web-runtime': minor
---

Add microphone input and named custom audio inputs to the web host's Audio settings. `startSoundorWebHost` accepts `audioInputs` with typed source factories and `defaultAudioInput` for a custom default. Inputs use the host's AudioContext and feed the plugin's normal DSP input. Capture and custom resources are released on pause, source changes, or disposal, including late asynchronous results. The panel reports permission/startup errors and supports retrying an input.
