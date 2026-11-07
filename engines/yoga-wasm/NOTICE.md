# Third-party notices

The WebAssembly module in `dist/` compiles in the following code. Their license
texts are in `licenses/`, taken verbatim from the exact revisions compiled.

| Component                | License                                           | Revision                                          | Text                 |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------- | -------------------- |
| Yoga                     | MIT                                               | pinned by `@soundor/engine`, in `dist/build.json` | `licenses/yoga`      |
| libc++, libc++abi        | Apache-2.0 WITH LLVM-exception                    | LLVM `895aa2c896ad` (wasi-sdk 34)                 | `licenses/llvm`      |
| compiler-rt              | Apache-2.0 WITH LLVM-exception                    | LLVM `895aa2c896ad` (wasi-sdk 34)                 | `licenses/llvm`      |
| wasi-libc                | Apache-2.0 WITH LLVM-exception, Apache-2.0 or MIT | `2e6fb9d8ee0c` (wasi-sdk 34)                      | `licenses/wasi-libc` |
| musl (in wasi-libc)      | MIT                                               | as wasi-libc                                      | `licenses/wasi-libc` |
| cloudlibc (in wasi-libc) | BSD-2-Clause                                      | as wasi-libc                                      | `licenses/wasi-libc` |
| dlmalloc (in wasi-libc)  | CC0                                               | as wasi-libc                                      | `licenses/wasi-libc` |

When the wasi-sdk in `scripts/compile.mjs` changes, update these: its `VERSION`
file names the revisions. The wasi-sdk's own archive carries no license texts.
