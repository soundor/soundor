# Native dependency attribution

The engine's Soundor-owned code is MIT licensed; see LICENSE. Native dependency
revisions and archive hashes are pinned in cmake/SoundorDependencies.cmake.
Source mode fetches dependencies into the build/cache directories, outside this
npm package. JUCE is a separate, consumer-supplied dependency of the JUCE adapter
and is never part of the engine.

| Dependency            | License                                         | Use                                      |
| --------------------- | ----------------------------------------------- | ---------------------------------------- |
| Hermes                | MIT                                             | JavaScript VM and host bytecode compiler |
| QuickJS-NG libunicode | MIT                                             | Linux Hermes Unicode tables              |
| Ada                   | MIT / Apache-2.0                                | URL parsing                              |
| Yoga                  | MIT                                             | Layout                                   |
| Skia                  | BSD-3-Clause, plus compiled third-party notices | Rasterization                            |
| ANGLE                 | BSD-3-Clause, plus compiled third-party notices | Graphics                                 |
| AccessKit             | MIT / Apache-2.0, plus transitive notices       | Accessibility                            |

Distributors must include applicable dependency license texts and attribution
notices from the exact fetched revisions, including compiled transitive code.
`licenses/` holds the notices the dependencies' own builds and archives leave
out (README.md there); prebuilt engine archives carry all of them, assembled
in their `licenses/` directory.
The dependency and redistribution sections of README.md describe the current
build graph. Building from source does not waive those redistribution duties.
Doctest and Three.js are test-only dependencies and are not shipped in this
source package. No compiled native libraries are included in this npm
package; they are published separately as prebuilt engine releases
(README.md, "Prebuilt engines").
