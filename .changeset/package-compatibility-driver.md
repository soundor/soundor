---
'@soundor/driver': patch
---

`isDriverError()` recognizes a `DriverError` of any copy of the Driver (such as `@soundor/vitest-e2e`'s), by the brand `Symbol.for('soundor.driver-error.v1')` and its `code`, not by `instanceof`.
