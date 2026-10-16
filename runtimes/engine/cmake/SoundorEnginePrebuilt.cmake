# A prebuilt engine (README.md, "Prebuilt engines"): the targets a source
# build defines (SoundorEngineSource.cmake), imported from the extracted
# archives of an engine prebuilt release instead of compiled. One archive per
# configuration:
#
#   SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR    Debug (DevTools, Hermes with its compiler)
#   SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR  Release, RelWithDebInfo, MinSizeRel (bytecode only)
#
# A single-configuration build needs the one its CMAKE_BUILD_TYPE uses; a
# multi-configuration build fails to build a configuration whose archive is
# missing. Every archive is checked against this package (version, ABI
# namespace, Hermes) and the build's target (platform, architectures, C
# runtime) before anything links it. Included by CMakeLists.txt.

include_guard(GLOBAL)

include(SoundorDependencies)

set(SOUNDOR_ENGINE_PREBUILT ON)

# The target this build compiles for, in the archives' terms.
if(APPLE)
  set(soundor_prebuilt_os macos)
  if(CMAKE_OSX_ARCHITECTURES)
    set(soundor_prebuilt_archs ${CMAKE_OSX_ARCHITECTURES})
  else()
    set(soundor_prebuilt_archs ${CMAKE_HOST_SYSTEM_PROCESSOR})
  endif()
elseif(WIN32)
  set(soundor_prebuilt_os windows)
  set(soundor_prebuilt_archs ${CMAKE_SYSTEM_PROCESSOR})
  if(CMAKE_VS_PLATFORM_NAME)
    set(soundor_prebuilt_archs ${CMAKE_VS_PLATFORM_NAME})
  endif()
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  set(soundor_prebuilt_os linux)
  set(soundor_prebuilt_archs ${CMAKE_SYSTEM_PROCESSOR})
else()
  message(FATAL_ERROR "There is no prebuilt engine for ${CMAKE_SYSTEM_NAME}; build it from source "
                      "(juceRuntime({ engine: { mode: 'source' } }))")
endif()
function(soundor_prebuilt_cpus out)
  set(cpus "")
  foreach(arch IN LISTS ARGN)
    string(TOLOWER "${arch}" arch)
    if(arch MATCHES "^(x86_64|amd64|x64)$")
      list(APPEND cpus x64)
    elseif(arch MATCHES "^(arm64|aarch64)$")
      list(APPEND cpus arm64)
    else()
      list(APPEND cpus "${arch}")
    endif()
  endforeach()
  list(REMOVE_DUPLICATES cpus)
  set(${out} ${cpus} PARENT_SCOPE)
endfunction()
soundor_prebuilt_cpus(soundor_prebuilt_cpus ${soundor_prebuilt_archs})
soundor_prebuilt_cpus(soundor_prebuilt_host_cpus ${CMAKE_HOST_SYSTEM_PROCESSOR})

# Which archives this build uses.
set(soundor_prebuilt_variants "")
if(CMAKE_CONFIGURATION_TYPES)
  if(SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR)
    list(APPEND soundor_prebuilt_variants debug)
  endif()
  if(SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR)
    list(APPEND soundor_prebuilt_variants release)
  endif()
else()
  if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(needed debug)
  else()
    set(needed release)
  endif()
  string(TOUPPER "${needed}" upper)
  if(NOT SOUNDOR_ENGINE_PREBUILT_${upper}_DIR)
    message(FATAL_ERROR "A ${CMAKE_BUILD_TYPE} build links the ${needed} prebuilt engine, and "
                        "SOUNDOR_ENGINE_PREBUILT_${upper}_DIR is not set")
  endif()
  set(soundor_prebuilt_variants ${needed})
endif()

# Reads and checks one archive; sets soundor_prebuilt_<variant>_* in the
# caller's scope.
function(soundor_prebuilt_read variant)
  string(TOUPPER "${variant}" upper)
  file(REAL_PATH "${SOUNDOR_ENGINE_PREBUILT_${upper}_DIR}" dir)
  set(where "the ${variant} prebuilt engine in ${dir}")
  if(NOT EXISTS "${dir}/soundor-engine.json")
    message(FATAL_ERROR "${where} is not an extracted engine prebuilt (no soundor-engine.json)")
  endif()
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${dir}/soundor-engine.json")
  file(READ "${dir}/soundor-engine.json" json)
  macro(soundor_prebuilt_get out)
    string(JSON ${out} ERROR_VARIABLE error GET "${json}" ${ARGN})
    if(error)
      message(FATAL_ERROR "${where} has an invalid soundor-engine.json: ${error}")
    endif()
  endmacro()
  macro(soundor_prebuilt_expect what actual wanted)
    if(NOT "${actual}" STREQUAL "${wanted}")
      message(FATAL_ERROR "${where} is for ${what} ${actual}, not ${wanted}. ${ARGN}")
    endif()
  endmacro()
  soundor_prebuilt_get(format format)
  soundor_prebuilt_expect("format" "${format}" "1" "This @soundor/engine reads format 1.")
  soundor_prebuilt_get(version engine version)
  soundor_prebuilt_expect("@soundor/engine" "${version}" "${SOUNDOR_ENGINE_VERSION}"
         "Use the prebuilt release of the installed engine version.")
  soundor_prebuilt_get(abi engine abiNamespace)
  soundor_prebuilt_expect("ABI namespace" "${abi}" "${SOUNDOR_ABI_NAMESPACE}")
  soundor_prebuilt_get(actual variant)
  soundor_prebuilt_expect("the variant" "${actual}" "${variant}")
  soundor_prebuilt_get(revision hermes revision)
  soundor_prebuilt_expect("Hermes" "${revision}" "${SOUNDOR_HERMES_REVISION}")
  soundor_prebuilt_get(os target os)
  soundor_prebuilt_expect("the platform" "${os}" "${soundor_prebuilt_os}"
         "Prebuilt engines are selected by the platform a build targets, not the one it runs on.")
  string(JSON count LENGTH "${json}" target architectures)
  set(available "")
  if(count GREATER 0)
    math(EXPR last "${count} - 1")
    foreach(index RANGE ${last})
      soundor_prebuilt_get(arch target architectures ${index})
      list(APPEND available "${arch}")
    endforeach()
  endif()
  foreach(cpu IN LISTS soundor_prebuilt_cpus)
    if(NOT cpu IN_LIST available)
      message(FATAL_ERROR "${where} has no ${cpu} code (it has: ${available}); this build targets "
                          "${soundor_prebuilt_cpus}")
    endif()
  endforeach()
  if(APPLE)
    soundor_prebuilt_get(minimum target minimumOsVersion)
    if(CMAKE_OSX_DEPLOYMENT_TARGET AND CMAKE_OSX_DEPLOYMENT_TARGET VERSION_LESS minimum)
      message(FATAL_ERROR "${where} needs macOS ${minimum} or later; this build targets macOS "
                          "${CMAKE_OSX_DEPLOYMENT_TARGET} (CMAKE_OSX_DEPLOYMENT_TARGET)")
    endif()
  endif()
  if(WIN32)
    soundor_prebuilt_get(runtime toolchain msvcRuntime)
    if(NOT MSVC)
      message(FATAL_ERROR "${where} is built with MSVC; build with MSVC too")
    endif()
    # CMake's default is MultiThreaded$<$<CONFIG:Debug>:Debug>DLL: /MDd for
    # Debug, /MD otherwise, as the archives are. A static C runtime cannot
    # link them.
    if(CMAKE_MSVC_RUNTIME_LIBRARY AND NOT CMAKE_MSVC_RUNTIME_LIBRARY MATCHES "DLL")
      message(FATAL_ERROR "${where} uses the ${runtime} C runtime; this build sets CMAKE_MSVC_RUNTIME_LIBRARY to "
                          "${CMAKE_MSVC_RUNTIME_LIBRARY}")
    endif()
  endif()

  # Paths, as linked: each list of soundor-engine.json's "link".
  foreach(group engine hermes skia angle accessKit system frameworks)
    string(JSON count LENGTH "${json}" link ${group})
    set(items "")
    if(count GREATER 0)
      math(EXPR last "${count} - 1")
      foreach(index RANGE ${last})
        soundor_prebuilt_get(item link ${group} ${index})
        if(NOT group MATCHES "^(system|frameworks)$")
          set(item "${dir}/${item}")
          if(NOT EXISTS "${item}")
            message(FATAL_ERROR "${where} is incomplete: ${item} is missing")
          endif()
        endif()
        list(APPEND items "${item}")
      endforeach()
    endif()
    set(soundor_prebuilt_${variant}_${group} ${items} PARENT_SCOPE)
  endforeach()
  foreach(feature devtools jsSource gpu accessKit)
    soundor_prebuilt_get(value features ${feature})
    if(value STREQUAL "ON" OR value STREQUAL "true")
      set(value ON)
    else()
      set(value OFF)
    endif()
    set(soundor_prebuilt_${variant}_has_${feature} ${value} PARENT_SCOPE)
  endforeach()
  soundor_prebuilt_get(compiler hermes compiler)
  soundor_prebuilt_get(bytecode hermes bytecodeVersion)
  set(soundor_prebuilt_${variant}_dir "${dir}" PARENT_SCOPE)
  set(soundor_prebuilt_${variant}_hermesc "${dir}/${compiler}" PARENT_SCOPE)
  set(soundor_prebuilt_${variant}_bytecode "${bytecode}" PARENT_SCOPE)
  set(soundor_prebuilt_${variant}_available ${available} PARENT_SCOPE)
endfunction()

foreach(variant IN LISTS soundor_prebuilt_variants)
  soundor_prebuilt_read(${variant})
endforeach()
list(GET soundor_prebuilt_variants 0 soundor_prebuilt_first)

# Both archives of one build come from one release: the same features.
foreach(feature gpu accessKit)
  foreach(variant IN LISTS soundor_prebuilt_variants)
    if(NOT soundor_prebuilt_${variant}_has_${feature} STREQUAL soundor_prebuilt_${soundor_prebuilt_first}_has_${feature})
      message(FATAL_ERROR "The debug and release prebuilt engines differ in ${feature}")
    endif()
  endforeach()
endforeach()

# What a source build would set: the build's features come from the archives.
set(SOUNDOR_HAS_GPU ${soundor_prebuilt_${soundor_prebuilt_first}_has_gpu})
set(SOUNDOR_HAS_ACCESSKIT ${soundor_prebuilt_${soundor_prebuilt_first}_has_accessKit})
set(SOUNDOR_ENABLE_DEVTOOLS ${soundor_prebuilt_${soundor_prebuilt_first}_has_devtools})
set(SOUNDOR_JS_SOURCE ${soundor_prebuilt_${soundor_prebuilt_first}_has_jsSource})
set(SOUNDOR_HERMES_BYTECODE_VERSION ${soundor_prebuilt_${soundor_prebuilt_first}_bytecode})
set_property(GLOBAL PROPERTY SOUNDOR_HERMES_REVISION "${SOUNDOR_HERMES_REVISION}")
foreach(variant IN LISTS soundor_prebuilt_variants)
  message(STATUS "Soundor engine: the ${variant} prebuilt (${soundor_prebuilt_${variant}_dir})")
endforeach()

# Wraps each path of <group> in the condition of the configurations its
# archive serves (none in a single-configuration build: it has one archive).
function(soundor_prebuilt_paths out group)
  set(paths "")
  foreach(variant IN LISTS soundor_prebuilt_variants)
    set(items ${soundor_prebuilt_${variant}_${group}})
    if(group STREQUAL "hermes" AND CMAKE_SYSTEM_NAME STREQUAL "Linux" AND CMAKE_VERSION VERSION_GREATER_EQUAL 3.24
       AND items)
      # Single-pass linkers (GNU ld) see Hermes's archives as one group.
      list(JOIN items "," joined)
      set(items "$<LINK_GROUP:RESCAN,${joined}>")
    endif()
    foreach(item IN LISTS items)
      if(NOT CMAKE_CONFIGURATION_TYPES)
        list(APPEND paths "${item}")
      elseif(variant STREQUAL "debug")
        list(APPEND paths "$<$<CONFIG:Debug>:${item}>")
      else()
        list(APPEND paths "$<$<NOT:$<CONFIG:Debug>>:${item}>")
      endif()
    endforeach()
  endforeach()
  set(${out} ${paths} PARENT_SCOPE)
endfunction()

# A multi-configuration build may lack one archive: its configurations then
# fail to build, rather than link the other's C runtime.
add_library(soundor_prebuilt_link INTERFACE)
if(CMAKE_CONFIGURATION_TYPES AND NOT (SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR AND SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR))
  if(SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR)
    set(available "$<CONFIG:Debug>")
    set(missing RELEASE)
  else()
    set(available "$<NOT:$<CONFIG:Debug>>")
    set(missing DEBUG)
  endif()
  add_custom_target(soundor_engine_prebuilt_check
    COMMAND ${CMAKE_COMMAND} -E echo "$<IF:${available},,Set SOUNDOR_ENGINE_PREBUILT_${missing}_DIR to build $<CONFIG>>"
    COMMAND ${CMAKE_COMMAND} -E $<IF:${available},true,false>
    VERBATIM)
  add_dependencies(soundor_prebuilt_link soundor_engine_prebuilt_check)
endif()

# The runtime library itself: an imported archive, so that $<TARGET_FILE>
# names it as it does a built one.
add_library(soundor_runtime STATIC IMPORTED GLOBAL)
if(CMAKE_CONFIGURATION_TYPES)
  set(configurations "")
  foreach(variant IN LISTS soundor_prebuilt_variants)
    string(TOUPPER "${variant}" upper)
    list(GET soundor_prebuilt_${variant}_engine 0 library)
    list(APPEND configurations ${upper})
    set_target_properties(soundor_runtime PROPERTIES IMPORTED_LOCATION_${upper} "${library}")
  endforeach()
  set_target_properties(soundor_runtime PROPERTIES IMPORTED_CONFIGURATIONS "${configurations}")
  # Debug takes the debug archive; every other configuration the release one.
  # A missing archive maps to the other, never built (soundor_engine_prebuilt_check).
  if(SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR)
    set(soundor_prebuilt_others RELEASE)
  else()
    set(soundor_prebuilt_others DEBUG)
  endif()
  if(SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR)
    set(soundor_prebuilt_debug DEBUG)
  else()
    set(soundor_prebuilt_debug RELEASE)
  endif()
  set_target_properties(soundor_runtime PROPERTIES
    MAP_IMPORTED_CONFIG_DEBUG ${soundor_prebuilt_debug}
    MAP_IMPORTED_CONFIG_RELEASE ${soundor_prebuilt_others}
    MAP_IMPORTED_CONFIG_RELWITHDEBINFO ${soundor_prebuilt_others}
    MAP_IMPORTED_CONFIG_MINSIZEREL ${soundor_prebuilt_others})
  set(devtools "$<IF:$<CONFIG:Debug>,$<BOOL:${soundor_prebuilt_debug_has_devtools}>,$<BOOL:${soundor_prebuilt_release_has_devtools}>>")
else()
  list(GET soundor_prebuilt_${soundor_prebuilt_first}_engine 0 library)
  set_target_properties(soundor_runtime PROPERTIES IMPORTED_LOCATION "${library}")
  set(devtools "$<BOOL:${SOUNDOR_ENABLE_DEVTOOLS}>")
endif()
foreach(variant IN LISTS soundor_prebuilt_variants)
  list(REMOVE_AT soundor_prebuilt_${variant}_engine 0)
endforeach()
soundor_prebuilt_paths(soundor_prebuilt_engine_paths engine)
soundor_prebuilt_paths(soundor_prebuilt_hermes_paths hermes)
soundor_prebuilt_paths(soundor_prebuilt_skia_paths skia)
soundor_prebuilt_paths(soundor_prebuilt_angle_paths angle)
soundor_prebuilt_paths(soundor_prebuilt_accesskit_paths accessKit)
soundor_prebuilt_paths(soundor_prebuilt_system system)
set(soundor_prebuilt_frameworks "")
foreach(framework IN LISTS soundor_prebuilt_${soundor_prebuilt_first}_frameworks)
  string(REGEX REPLACE "\\.framework$" "" framework "${framework}")
  list(APPEND soundor_prebuilt_frameworks "-framework ${framework}")
endforeach()

# Hermes: its headers (JSI, for generated bindings and the runtime's own
# adapters) and the variant's VM.
add_library(soundor_hermes INTERFACE)
target_include_directories(soundor_hermes SYSTEM INTERFACE
  "${soundor_prebuilt_${soundor_prebuilt_first}_dir}/hermes/include")
# As Hermes was built (cmake/hermes/CMakeLists.txt): nothing exported.
target_compile_definitions(soundor_hermes INTERFACE JSI_EXPORT= HERMES_EXPORT=)
target_link_libraries(soundor_hermes INTERFACE ${soundor_prebuilt_hermes_paths} ${SOUNDOR_HERMES_SYSTEM_LIBRARIES})

# hermesc compiles a plugin's UI to bytecode while it builds, so it has to run
# here: the archive's own build of it, where this machine can run it (its
# platform, one of its architectures). Elsewhere a build embeds source, which
# only a debug engine can run.
set(soundor_hermesc_variant "")
if("${CMAKE_HOST_SYSTEM_NAME}" STREQUAL "${CMAKE_SYSTEM_NAME}" AND NOT CMAKE_CROSSCOMPILING)
  foreach(variant IN LISTS soundor_prebuilt_variants)
    if(soundor_prebuilt_host_cpus IN_LIST soundor_prebuilt_${variant}_available)
      set(soundor_hermesc_variant ${variant})
    endif()
  endforeach()
endif()
if(soundor_hermesc_variant)
  set(soundor_hermesc_path "${soundor_prebuilt_${soundor_hermesc_variant}_hermesc}")
  if(NOT TARGET soundor_hermesc)
    add_executable(soundor_hermesc IMPORTED GLOBAL)
    set_target_properties(soundor_hermesc PROPERTIES IMPORTED_LOCATION "${soundor_hermesc_path}")
  endif()
else()
  set(soundor_hermesc_path "")
  if(NOT SOUNDOR_JS_SOURCE)
    message(FATAL_ERROR "This machine cannot run the prebuilt engine's hermesc, and the release engine runs "
                        "bytecode only: build the engine from source")
  endif()
endif()

if(SOUNDOR_HAS_GPU)
  add_library(soundor_angle INTERFACE)
  target_include_directories(soundor_angle SYSTEM INTERFACE "${soundor_prebuilt_${soundor_prebuilt_first}_dir}/angle/include")
  target_compile_definitions(soundor_angle INTERFACE ${SOUNDOR_ANGLE_DEFINITIONS})
  target_link_libraries(soundor_angle INTERFACE ${soundor_prebuilt_angle_paths} ${soundor_prebuilt_system}
                                                ${soundor_prebuilt_frameworks})
endif()
if(SOUNDOR_HAS_ACCESSKIT)
  add_library(soundor_accesskit INTERFACE)
  target_include_directories(soundor_accesskit SYSTEM INTERFACE
    "${soundor_prebuilt_${soundor_prebuilt_first}_dir}/accesskit/include")
  target_link_libraries(soundor_accesskit INTERFACE ${soundor_prebuilt_accesskit_paths}
                                                    ${SOUNDOR_ACCESSKIT_SYSTEM_LIBRARIES})
endif()

# Everything the runtime links, in the order a source build links it.
target_link_libraries(soundor_prebuilt_link INTERFACE
  ${soundor_prebuilt_engine_paths}
  ${soundor_prebuilt_hermes_paths} ${SOUNDOR_HERMES_SYSTEM_LIBRARIES}
  ${soundor_prebuilt_skia_paths} ${SOUNDOR_SKIA_SYSTEM_LIBRARIES})
if(SOUNDOR_HAS_GPU)
  target_link_libraries(soundor_prebuilt_link INTERFACE soundor_angle)
endif()
if(SOUNDOR_HAS_ACCESSKIT)
  target_link_libraries(soundor_prebuilt_link INTERFACE soundor_accesskit)
endif()
target_link_libraries(soundor_prebuilt_link INTERFACE ${soundor_prebuilt_system} ${soundor_prebuilt_frameworks}
                                                      ${SOUNDOR_RUNTIME_SYSTEM_LIBRARIES})

set_target_properties(soundor_runtime PROPERTIES
  INTERFACE_INCLUDE_DIRECTORIES "${SoundorEngine_SOURCE_DIR}/include;${CMAKE_CURRENT_BINARY_DIR}/generated"
  INTERFACE_COMPILE_FEATURES cxx_std_20
  INTERFACE_COMPILE_DEFINITIONS "SOUNDOR_DEVTOOLS=${devtools}"
  INTERFACE_LINK_LIBRARIES soundor_prebuilt_link)
