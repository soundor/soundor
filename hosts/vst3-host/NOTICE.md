# Notices

`@soundor/vst3-host` is MIT-licensed (LICENSE). Its executable is built with
the following third-party code, under its own license:

| Component                                                                                          | Version        | License | Notice                                                  |
| -------------------------------------------------------------------------------------------------- | -------------- | ------- | ------------------------------------------------------- |
| [VST3 SDK](https://github.com/steinbergmedia/vst3sdk) (pluginterfaces, public.sdk hosting helpers) | 3.8.1 build 84 | MIT     | `licenses/vst3sdk/LICENSE.txt` in each platform package |

VST is a registered trademark of Steinberg Media Technologies GmbH.

The test fixtures (`native/tests/fixtures`) additionally use the SDK's `base`
library (MIT); they are never shipped as binaries.
