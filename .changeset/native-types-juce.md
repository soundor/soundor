---
'@soundor/juce-runtime': minor
---

**Breaking:** the generated `soundor::native::NativeApi` uses the native API's exact types: `std::int8_t` … `std::uint64_t`, `float` and `double` for sized numbers, `std::optional<T>` for `T?`, `std::vector<T>` for `T[]`, and for `buffer<T>` a `std::span<const T>` argument (borrowed for the call) or a `std::vector<T>` elsewhere (results move into JavaScript without a copy). Handles, and their `std::shared_ptr<T>` base classes, are gone: a struct is a value.
