# Notices

`@soundor/vst3-runtime` is MIT-licensed (LICENSE). Its prebuilt adapter
(`prebuilt/linux-x64-*/lib/libsoundor_vst3.a`), which every plugin it builds
contains, is compiled with the following third-party code, under its own
license:

| Component                                                                                | Version        | License | Notice                                              |
| ---------------------------------------------------------------------------------------- | -------------- | ------- | --------------------------------------------------- |
| [VST3 SDK](https://github.com/steinbergmedia/vst3sdk) (pluginterfaces, base, public.sdk) | 3.8.1 build 84 | MIT     | `prebuilt/linux-x64-*/licenses/vst3sdk/LICENSE.txt` |

A plugin also contains the Soundor engine and its dependencies (from
`@soundor/engine`'s prebuilt archive): `soundor build vst3` copies every
notice into the bundle's `Contents/Resources/licenses/`.

VST is a registered trademark of Steinberg Media Technologies GmbH.
