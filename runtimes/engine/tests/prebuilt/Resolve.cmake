# cmake -DENGINE=<engine package> -DGENERATOR=<generator> -DWORK=<scratch directory> -P Resolve.cmake
#
# Prebuilt mode (SoundorEngineResolve.cmake) with a copy of the package whose
# manifest names a small archive by a file:// URL: it is downloaded,
# verified, extracted and cached; reused offline; fetched again when the
# cached copy is corrupt; and refused when the manifest, its checksum or the
# archive disagree. The archive's libraries are empty files: configuring only
# checks that they exist.

cmake_minimum_required(VERSION 3.22)
include("${ENGINE}/cmake/SoundorAbi.cmake")
include("${ENGINE}/cmake/SoundorDependencies.cmake")
file(READ "${ENGINE}/package.json" package)
string(JSON version GET "${package}" version)
soundor_abi_namespace("${version}" namespace)
set(commit "0123456789abcdef0123456789abcdef01234567")

file(REMOVE_RECURSE "${WORK}")
set(package "${WORK}/package")
file(MAKE_DIRECTORY "${package}")
foreach(entry CMakeLists.txt package.json cmake include src)
  file(COPY "${ENGINE}/${entry}" DESTINATION "${package}")
endforeach()

# The host's target, as a release names it.
set(minimum "")
set(runtime "")
if(CMAKE_HOST_APPLE)
  set(target macos-universal)
  set(os macos)
  set(archs "\"arm64\", \"x64\"")
  set(minimum "12.0")
  set(lib "lib")
  set(ext ".a")
elseif(CMAKE_HOST_WIN32)
  set(target windows-x64)
  set(os windows)
  set(archs "\"x64\"")
  set(runtime MultiThreadedDebugDLL)
  set(lib "")
  set(ext ".lib")
else()
  set(target linux-x64)
  set(os linux)
  set(archs "\"x64\"")
  set(lib "lib")
  set(ext ".a")
endif()
set(top "soundor-engine-${version}-${target}-debug")
set(libraries "lib/${lib}soundor_runtime${ext}" "lib/${lib}soundor_ada${ext}" "lib/${lib}soundor_yoga${ext}")
set(hermes "hermes/lib/${lib}hermesvm${ext}")
set(skia "skia/lib/${lib}skia${ext}")
set(hermesc "hermes/bin/hermesc")
if(CMAKE_HOST_WIN32)
  set(hermesc "hermes/bin/hermesc.exe")
endif()

# Writes <name>.tar.gz holding <top>/ with metadata naming <archive commit>.
function(archive name archive_commit)
  set(tree "${WORK}/trees/${name}/${top}")
  file(REMOVE_RECURSE "${WORK}/trees/${name}")
  foreach(file IN LISTS libraries hermes skia hermesc)
    get_filename_component(directory "${tree}/${file}" DIRECTORY)
    file(MAKE_DIRECTORY "${directory}")
    file(TOUCH "${tree}/${file}")
  endforeach()
  file(MAKE_DIRECTORY "${tree}/hermes/include")
  list(JOIN libraries "\", \"" engine)
  file(WRITE "${tree}/soundor-engine.json" "{
  \"format\": 1,
  \"engine\": { \"version\": \"${version}\", \"abiNamespace\": \"${namespace}\", \"sourceCommit\": \"${archive_commit}\" },
  \"variant\": \"debug\",
  \"configuration\": \"Debug\",
  \"target\": { \"name\": \"${target}\", \"os\": \"${os}\", \"architectures\": [${archs}], \"minimumOsVersion\": \"${minimum}\" },
  \"toolchain\": { \"compiler\": \"test\", \"compilerVersion\": \"0\", \"msvcRuntime\": \"${runtime}\" },
  \"features\": { \"devtools\": true, \"jsSource\": true, \"gpu\": false, \"accessKit\": false },
  \"hermes\": { \"revision\": \"${SOUNDOR_HERMES_REVISION}\", \"bytecodeVersion\": \"96\", \"compiler\": \"${hermesc}\" },
  \"link\": { \"engine\": [\"${engine}\"], \"hermes\": [\"${hermes}\"], \"skia\": [\"${skia}\"], \"angle\": [],
              \"accessKit\": [], \"system\": [], \"frameworks\": [] }
}
")
  execute_process(COMMAND ${CMAKE_COMMAND} -E tar czf "${WORK}/${name}.tar.gz" "${top}"
                  WORKING_DIRECTORY "${WORK}/trees/${name}" COMMAND_ERROR_IS_FATAL ANY)
endfunction()

# The package's manifest: <archive> at a file:// URL, with <sha256>.
function(manifest archive sha256 manifest_version manifest_commit)
  set(url "file://${archive}")
  if(CMAKE_HOST_WIN32)
    set(url "file:///${archive}")
  endif()
  file(MAKE_DIRECTORY "${package}/artifacts")
  file(WRITE "${package}/artifacts/manifest.json" "{
  \"format\": 1, \"engineVersion\": \"${manifest_version}\", \"abiNamespace\": \"${namespace}\",
  \"sourceCommit\": \"${manifest_commit}\", \"revision\": 1, \"tag\": \"engine-prebuilts-test\",
  \"artifacts\": [{ \"file\": \"${top}.tar.gz\", \"target\": \"${target}\", \"variant\": \"debug\",
                    \"sha256\": \"${sha256}\", \"url\": \"${url}\" }]
}
")
endfunction()

set(failures 0)
set(run 0)
# Configures the copied package in prebuilt mode; <expected>: "" to succeed,
# else a message the failure must contain.
function(configure what expected)
  math(EXPR next "${run} + 1")
  set(run ${next} PARENT_SCOPE)
  execute_process(
    COMMAND ${CMAKE_COMMAND} -E env "SOUNDOR_CACHE=${WORK}/cache"
            ${CMAKE_COMMAND} -S "${package}" -B "${WORK}/build-${next}" -G "${GENERATOR}"
            -DCMAKE_BUILD_TYPE=Debug -DSOUNDOR_BUILD_TESTS=OFF -DSOUNDOR_ENGINE_MODE=prebuilt
    RESULT_VARIABLE status
    OUTPUT_VARIABLE output
    ERROR_VARIABLE output)
  string(REPLACE "\n" " " flat "${output}")
  string(REGEX REPLACE " +" " " flat "${flat}")
  if(expected STREQUAL "" AND NOT status EQUAL 0)
    message(SEND_ERROR "${what}: the configure failed:\n${output}")
    math(EXPR count "${failures} + 1")
    set(failures ${count} PARENT_SCOPE)
  elseif(NOT expected STREQUAL "" AND status EQUAL 0)
    message(SEND_ERROR "${what}: the configure succeeded")
    math(EXPR count "${failures} + 1")
    set(failures ${count} PARENT_SCOPE)
  elseif(NOT expected STREQUAL "")
    string(FIND "${flat}" "${expected}" found)
    if(found EQUAL -1)
      message(SEND_ERROR "${what}: the configure failed without saying \"${expected}\":\n${output}")
      math(EXPR count "${failures} + 1")
      set(failures ${count} PARENT_SCOPE)
    endif()
  endif()
endfunction()

configure("Without a manifest" "Build the engine from source instead")

archive(good "${commit}")
file(SHA256 "${WORK}/good.tar.gz" good)
set(cached "${WORK}/cache/engine-prebuilts/${good}")

manifest("${WORK}/good.tar.gz" "${good}" "${version}" "${commit}")
configure("The first build" "")
if(NOT EXISTS "${cached}.tar.gz" OR NOT EXISTS "${cached}/.soundor-verified")
  message(SEND_ERROR "The archive was not cached under its SHA-256")
  math(EXPR failures "${failures} + 1")
endif()

# Offline: the archive's URL is gone, the verified cache is used.
file(RENAME "${WORK}/good.tar.gz" "${WORK}/away.tar.gz")
configure("Offline, from the cache" "")

# A corrupt cached archive, not yet extracted: never used, fetched again.
file(REMOVE_RECURSE "${cached}")
file(WRITE "${cached}.tar.gz" "corrupt")
configure("A corrupt cache, offline" "Downloading the debug prebuilt engine failed")
file(RENAME "${WORK}/away.tar.gz" "${WORK}/good.tar.gz")
configure("A corrupt cache, online" "")
file(SHA256 "${cached}.tar.gz" recovered)
if(NOT recovered STREQUAL good)
  message(SEND_ERROR "The corrupt cached archive was not replaced")
  math(EXPR failures "${failures} + 1")
endif()

# A manifest whose checksum the archive does not have: refused.
file(REMOVE_RECURSE "${WORK}/cache")
string(REPEAT "0" 64 zeros)
manifest("${WORK}/good.tar.gz" "${zeros}" "${version}" "${commit}")
configure("A wrong checksum" "Downloading the debug prebuilt engine failed")
if(EXISTS "${WORK}/cache/engine-prebuilts/${zeros}.tar.gz")
  message(SEND_ERROR "An archive that failed its checksum was kept")
  math(EXPR failures "${failures} + 1")
endif()

manifest("${WORK}/good.tar.gz" "${good}" "9.9.9" "${commit}")
configure("Another version's manifest" "is not the manifest of @soundor/engine ${version}")

archive(other "fedcba9876543210fedcba9876543210fedcba98")
file(SHA256 "${WORK}/other.tar.gz" other)
manifest("${WORK}/other.tar.gz" "${other}" "${version}" "${commit}")
configure("An archive of another commit" "was built from fedcba9876543210fedcba9876543210fedcba98")

if(failures EQUAL 0)
  message(STATUS "Prebuilt engines are downloaded, verified, cached and reused (${run} configures)")
endif()
