# Prebuilt mode (SOUNDOR_ENGINE_MODE=prebuilt, what juceRuntime() uses by
# default): finds the archives this build needs in the prebuilt release this
# package names (artifacts/manifest.json, written when the package is
# published), downloads them into the Soundor cache, verifies them and points
# SoundorEnginePrebuilt.cmake at them. Never falls back to building the engine
# from source.
#
#   SOUNDOR_CACHE (env)  where archives are kept (README.md, "Prebuilt engines")
#
# The cache is content-addressed: <cache>/engine-prebuilts/<sha256>.tar.gz and
# its extraction <sha256>/. An archive is used only once its SHA-256 matched
# the manifest, and an extraction only once complete, so an interrupted or
# corrupted download is fetched again, and builds work offline once cached.
# Parallel configures wait for each other.

include_guard(GLOBAL)

include(SoundorDependencies)

set(soundor_resolve_manifest "${SoundorEngine_SOURCE_DIR}/artifacts/manifest.json")
set(soundor_resolve_source_hint
    "Build the engine from source instead: juceRuntime({ engine: { mode: 'source' } }) "
    "(-DSOUNDOR_ENGINE_MODE=source).")
string(CONCAT soundor_resolve_source_hint ${soundor_resolve_source_hint})
if(NOT EXISTS "${soundor_resolve_manifest}")
  message(FATAL_ERROR "This @soundor/engine (${SoundorEngine_SOURCE_DIR}) has no prebuilt engine: only its published "
                      "npm package names one (artifacts/manifest.json), not a workspace or an unpublished copy. "
                      "${soundor_resolve_source_hint}")
endif()
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${soundor_resolve_manifest}")
file(READ "${soundor_resolve_manifest}" soundor_resolve_json)
string(JSON soundor_resolve_version ERROR_VARIABLE error GET "${soundor_resolve_json}" engineVersion)
if(error OR NOT soundor_resolve_version STREQUAL SOUNDOR_ENGINE_VERSION)
  message(FATAL_ERROR "${soundor_resolve_manifest} is not the manifest of @soundor/engine ${SOUNDOR_ENGINE_VERSION}")
endif()
string(JSON soundor_resolve_commit GET "${soundor_resolve_json}" sourceCommit)
string(JSON soundor_resolve_tag GET "${soundor_resolve_json}" tag)

# The target this build compiles for (not the machine it runs on).
if(APPLE AND NOT IOS)
  set(soundor_resolve_target macos-universal)
elseif(WIN32)
  set(soundor_resolve_arch "${CMAKE_SYSTEM_PROCESSOR}")
  if(CMAKE_VS_PLATFORM_NAME)
    set(soundor_resolve_arch "${CMAKE_VS_PLATFORM_NAME}")
  endif()
  string(TOLOWER "${soundor_resolve_arch}" soundor_resolve_arch)
  if(soundor_resolve_arch MATCHES "^(x64|amd64|x86_64)$")
    set(soundor_resolve_target windows-x64)
  endif()
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  string(TOLOWER "${CMAKE_SYSTEM_PROCESSOR}" soundor_resolve_arch)
  if(soundor_resolve_arch MATCHES "^(x86_64|amd64)$")
    set(soundor_resolve_target linux-x64)
  endif()
endif()
if(NOT soundor_resolve_target)
  message(FATAL_ERROR "There is no prebuilt engine for ${CMAKE_SYSTEM_NAME} ${CMAKE_SYSTEM_PROCESSOR} "
                      "(prebuilts: macOS universal, Linux x64, Windows x64). ${soundor_resolve_source_hint}")
endif()

# The variants it needs: the Debug archive for Debug, the Release one for any
# other configuration. A multi-configuration generator builds what the CLI
# asked for (CMAKE_BUILD_TYPE), else every configuration.
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
  set(soundor_resolve_variants debug)
elseif(CMAKE_BUILD_TYPE OR NOT CMAKE_CONFIGURATION_TYPES)
  set(soundor_resolve_variants release)
else()
  set(soundor_resolve_variants debug release)
endif()

soundor_cache_root(soundor_resolve_cache)
set(soundor_resolve_cache "${soundor_resolve_cache}/engine-prebuilts")
file(MAKE_DIRECTORY "${soundor_resolve_cache}")

string(JSON soundor_resolve_count LENGTH "${soundor_resolve_json}" artifacts)
foreach(soundor_resolve_variant IN LISTS soundor_resolve_variants)
  set(url "")
  set(sha256 "")
  math(EXPR last "${soundor_resolve_count} - 1")
  foreach(index RANGE ${last})
    string(JSON target GET "${soundor_resolve_json}" artifacts ${index} target)
    string(JSON variant GET "${soundor_resolve_json}" artifacts ${index} variant)
    if(target STREQUAL soundor_resolve_target AND variant STREQUAL soundor_resolve_variant)
      string(JSON url GET "${soundor_resolve_json}" artifacts ${index} url)
      string(JSON sha256 GET "${soundor_resolve_json}" artifacts ${index} sha256)
      string(JSON file GET "${soundor_resolve_json}" artifacts ${index} file)
    endif()
  endforeach()
  if(NOT sha256 MATCHES "^[0-9a-f]+$" OR NOT url)
    message(FATAL_ERROR "The prebuilt release ${soundor_resolve_tag} has no ${soundor_resolve_variant} engine for "
                        "${soundor_resolve_target}. ${soundor_resolve_source_hint}")
  endif()

  set(archive "${soundor_resolve_cache}/${sha256}.tar.gz")
  set(extracted "${soundor_resolve_cache}/${sha256}")
  file(LOCK "${extracted}.lock" GUARD PROCESS TIMEOUT 1800)
  if(NOT EXISTS "${extracted}/.soundor-verified")
    # An archive already here is used only if it is the one the manifest names.
    if(EXISTS "${archive}")
      file(SHA256 "${archive}" actual)
      if(NOT actual STREQUAL sha256)
        message(STATUS "Soundor engine: ${archive} is not the expected archive; downloading it again")
        file(REMOVE "${archive}")
      endif()
    endif()
    if(NOT EXISTS "${archive}")
      message(STATUS "Soundor engine: downloading ${file} (${soundor_resolve_tag})")
      string(RANDOM LENGTH 8 suffix)
      set(partial "${archive}.${suffix}.part")
      file(DOWNLOAD "${url}" "${partial}" EXPECTED_HASH SHA256=${sha256} STATUS status TLS_VERIFY ON)
      list(GET status 0 code)
      if(NOT code EQUAL 0)
        list(GET status 1 reason)
        file(REMOVE "${partial}")
        message(FATAL_ERROR "Downloading the ${soundor_resolve_variant} prebuilt engine failed (${reason}): ${url}\n"
                            "It is not in the cache (${soundor_resolve_cache}) either, so this build needs the "
                            "network once. ${soundor_resolve_source_hint}")
      endif()
      file(RENAME "${partial}" "${archive}")
    endif()
    file(REMOVE_RECURSE "${extracted}" "${extracted}.partial")
    file(ARCHIVE_EXTRACT INPUT "${archive}" DESTINATION "${extracted}.partial")
    file(RENAME "${extracted}.partial" "${extracted}")
    file(WRITE "${extracted}/.soundor-verified" "${sha256}\n")
  endif()
  file(LOCK "${extracted}.lock" RELEASE)

  string(REGEX REPLACE "\\.tar\\.gz$" "" top "${file}")
  set(dir "${extracted}/${top}")
  if(NOT EXISTS "${dir}/soundor-engine.json")
    message(FATAL_ERROR "${archive} does not hold ${top}/; delete ${extracted} and configure again")
  endif()
  file(READ "${dir}/soundor-engine.json" metadata)
  string(JSON commit GET "${metadata}" engine sourceCommit)
  if(NOT commit STREQUAL soundor_resolve_commit)
    message(FATAL_ERROR "${dir} was built from ${commit}, not ${soundor_resolve_commit} (${soundor_resolve_tag})")
  endif()
  string(TOUPPER "${soundor_resolve_variant}" upper)
  # What SoundorEnginePrebuilt.cmake imports, after checking it again.
  set(SOUNDOR_ENGINE_PREBUILT_${upper}_DIR "${dir}")
endforeach()
