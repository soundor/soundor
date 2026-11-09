---
'@soundor/engine': minor
---

**Breaking:** native handles are gone: `bind::HandleType`, `readHandle()`, `writeHandle()` and the release queue behind them. The bindings convert every sized number exactly: `read()`/`write()` of `std::int8_t` … `std::uint64_t` and `float` (integers of up to 32 bits from integral numbers in range, 64-bit ones from bigints through JSI's `BigInt`, floats rounded to nearest), a `TypeError` for the wrong kind of value and a `RangeError` (`256 is out of range for uint8 (0 to 255)`) beyond the range. Typed arrays of every element type read as spans and write from vectors (`Int8Array` … `BigUint64Array`), `readBuffer()`/`writeBuffer()` copy one into a struct field and back, and `readNullable()`/`writeNullable()` map `null` to `std::optional`.
