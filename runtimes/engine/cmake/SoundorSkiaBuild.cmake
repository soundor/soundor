# Builds the Skia that Soundor renders with and installs it into OUT.
#
#   cmake -DOUT=<dir> -DREVISION=<sha> -DREPOSITORY=<url> -DDEPENDENCIES=<a;b>
#         -DTARGET_OS=<linux|mac|win> -DCPUS=<x64;arm64> -DFLAVORS=<name;...>
#         [-DCC=<c compiler> -DCXX=<c++ compiler>] -P SoundorSkiaBuild.cmake
#
# Skia is fetched at REVISION and its third-party code only for DEPENDENCIES,
# each at the commit Skia's own DEPS file pins. The build is CPU-only: no GPU
# backends, no PDF, no ICU or HarfBuzz. SVG uses Expat and primitive shaping. Every file is compiled with
# skia/SoundorSkiaPrefix.h forced in, which renames libjpeg-turbo's, libpng's
# and libwebp's symbols to soundor_*: a plugin can also contain JUCE's copies
# of those libraries (or any other), and the names would otherwise clash. OUT
# gets:
#
#   include/            Skia's public headers (and modules/skcms/, which they use)
#   lib/<flavor>/       the static library, one per FLAVORS entry (Windows
#                       needs one per C runtime: "md" and "mdd")
#   zlib/               the headers of the zlib inside the library, which ANGLE
#                       compiles against and links instead of its own copy
#   defines.txt         the defines Skia's public headers expect
#
# OUT appears only once the build succeeded (built aside, then renamed).

cmake_minimum_required(VERSION 3.22)

foreach(required OUT REVISION REPOSITORY DEPENDENCIES TARGET_OS CPUS FLAVORS)
  if(NOT DEFINED ${required} OR "${${required}}" STREQUAL "")
    message(FATAL_ERROR "SoundorSkiaBuild.cmake: ${required} is required")
  endif()
endforeach()

find_package(Git REQUIRED)
find_package(Python3 REQUIRED COMPONENTS Interpreter)
find_program(NINJA_EXE NAMES ninja REQUIRED)

set(prefix_header "${CMAKE_CURRENT_LIST_DIR}/skia/SoundorSkiaPrefix.h")
set(work "${OUT}.partial")
set(source "${work}/skia")
file(REMOVE_RECURSE "${work}")
file(MAKE_DIRECTORY "${source}")

function(run)
  execute_process(COMMAND ${ARGN} WORKING_DIRECTORY "${cwd}" RESULT_VARIABLE status)
  if(NOT status EQUAL 0)
    list(JOIN ARGN " " command)
    message(FATAL_ERROR "Building Skia failed: ${command}")
  endif()
endfunction()

# A shallow checkout of one commit.
function(checkout directory url revision)
  file(MAKE_DIRECTORY "${directory}")
  set(cwd "${directory}")
  run(${GIT_EXECUTABLE} init --quiet)
  run(${GIT_EXECUTABLE} fetch --quiet --depth 1 "${url}" "${revision}")
  run(${GIT_EXECUTABLE} -c advice.detachedHead=false checkout --quiet FETCH_HEAD)
endfunction()

message(STATUS "Skia: fetching ${REVISION}")
checkout("${source}" "${REPOSITORY}" "${REVISION}")

file(READ "${source}/DEPS" deps)
foreach(dependency IN LISTS DEPENDENCIES)
  string(REGEX MATCH "\"third_party/externals/${dependency}\"[ \t]*:[ \t]*\"([^\"@]+)@([0-9a-f]+)\"" found "${deps}")
  if(NOT found)
    message(FATAL_ERROR "Skia's DEPS does not pin third_party/externals/${dependency}")
  endif()
  message(STATUS "Skia: fetching ${dependency} ${CMAKE_MATCH_2}")
  checkout("${source}/third_party/externals/${dependency}" "${CMAKE_MATCH_1}" "${CMAKE_MATCH_2}")
endforeach()

# libwebp defines VP8GetValue and VP8GetSignedValue as function-like macros of
# the same names (they drop the bit-trace label), which replace the prefix
# header's renames: they expand to the prefixed names instead. Fails when
# libwebp's code no longer matches, so a Skia update revisits it.
set(bit_reader "${source}/third_party/externals/libwebp/src/utils/bit_reader_utils.h")
file(READ "${bit_reader}" content)
foreach(name VP8GetValue VP8GetSignedValue)
  set(macro "#define ${name}(BR, N, L) ${name}(BR, N)")
  string(FIND "${content}" "${macro}" found)
  if(found EQUAL -1)
    message(FATAL_ERROR "Building Skia failed: libwebp's ${bit_reader} no longer has '${macro}'")
  endif()
  string(REPLACE "${macro}" "#define ${name}(BR, N, L) soundor_${name}(BR, N)" content "${content}")
endforeach()
file(WRITE "${bit_reader}" "${content}")

# Skia components default to complete archives, which form collection
# boundaries: a parent complete_static_lib would contain no objects. Collect
# the full dependency closure at our single root instead.
set(gn_config "${source}/gn/BUILDCONFIG.gn")
file(READ "${gn_config}" content)
set(complete "    complete_static_lib = true")
string(FIND "${content}" "${complete}" found)
if(found EQUAL -1)
  message(FATAL_ERROR "Skia's component archive configuration changed")
endif()
string(REPLACE "${complete}" "    complete_static_lib = false" content "${content}")
file(WRITE "${gn_config}" "${content}")

# One complete archive preserves the source/prebuilt link contract. GN selects
# SVG's actual dependencies; skunicode stays empty without a Unicode backend.
file(APPEND "${source}/BUILD.gn" [=[
static_library("soundor_skia") {
  complete_static_lib = true
  deps = [ ":skia", "modules/svg" ]
}
]=])

set(cwd "${source}")
run(${Python3_EXECUTABLE} bin/fetch-gn)
if(TARGET_OS STREQUAL "win")
  set(gn "${source}/bin/gn.exe")
else()
  set(gn "${source}/bin/gn")
endif()

set(common_args [=[
is_official_build = true
is_debug = false
skia_enable_ganesh = false
skia_enable_graphite = false
skia_use_gl = false
skia_use_vulkan = false
skia_use_metal = false
skia_use_dawn = false
skia_use_direct3d = false
skia_enable_pdf = false
skia_enable_svg = true
skia_enable_skottie = false
skia_enable_skshaper = true
skia_enable_skparagraph = false
skia_enable_skunicode = false
skia_use_icu = false
skia_use_harfbuzz = false
skia_use_expat = true
skia_use_system_expat = false
skia_use_wuffs = false
skia_use_xps = false
skia_use_dng_sdk = false
skia_use_piex = false
skia_use_libavif = false
skia_use_jpeg_gainmaps = false
skia_use_perfetto = false
skia_use_libjpeg_turbo_encode = false
skia_use_libwebp_encode = false
skia_use_system_libpng = false
skia_use_system_libjpeg_turbo = false
skia_use_system_libwebp = false
skia_use_system_zlib = false
skia_enable_fontmgr_custom_directory = false
skia_enable_fontmgr_custom_embedded = false
skia_enable_fontmgr_android = false
]=])
if(TARGET_OS STREQUAL "linux")
  # fontconfig finds fonts, FreeType reads them; the (tiny) empty custom font
  # manager is what pulls Skia's FreeType typeface into the library.
  string(APPEND common_args "skia_use_system_freetype2 = true\nskia_enable_fontmgr_custom_empty = true\n")
else()
  string(APPEND common_args "skia_enable_fontmgr_custom_empty = false\n")
endif()

set(built_libraries "")
foreach(flavor IN LISTS FLAVORS)
  set(per_cpu "")
  foreach(cpu IN LISTS CPUS)
    set(name "${flavor}-${cpu}")
    set(args "${common_args}target_os = \"${TARGET_OS}\"\ntarget_cpu = \"${cpu}\"\n")
    if(TARGET_OS STREQUAL "win")
      # The C runtime has to match the plugin's: /MD, or /MDd in Debug.
      if(flavor STREQUAL "mdd")
        string(APPEND args "extra_cflags = [ \"/MDd\", \"/FI${prefix_header}\" ]\n")
      else()
        string(APPEND args "extra_cflags = [ \"/MD\", \"/FI${prefix_header}\" ]\n")
      endif()
      # RTTI like the rest of the plugin (and UBSan's vptr checks) expect.
      string(APPEND args "extra_cflags_cc = [ \"/GR\" ]\n")
    else()
      # libwebp exports its API (visibility "default") unless told otherwise;
      # a plugin exports nothing of Skia's.
      string(APPEND args "extra_cflags = [ \"-DWEBP_EXTERN=extern\", \"-include\", \"${prefix_header}\" ]\n")
      string(APPEND args "extra_cflags_cc = [ \"-frtti\" ]\n")
      if(DEFINED CC AND NOT CC STREQUAL "")
        string(APPEND args "cc = \"${CC}\"\ncxx = \"${CXX}\"\n")
      endif()
    endif()
    file(WRITE "${source}/out/${name}/args.gn" "${args}")
    message(STATUS "Skia: building ${name}")
    run("${gn}" gen "out/${name}")
    run(${NINJA_EXE} -C "out/${name}" soundor_skia)
    if(TARGET_OS STREQUAL "win")
      list(APPEND per_cpu "${source}/out/${name}/soundor_skia.lib")
    else()
      list(APPEND per_cpu "${source}/out/${name}/libsoundor_skia.a")
    endif()
  endforeach()

  file(MAKE_DIRECTORY "${work}/install/lib/${flavor}")
  list(LENGTH per_cpu cpu_count)
  if(cpu_count GREATER 1)
    # macOS universal: one archive for every architecture.
    run(lipo -create ${per_cpu} -output "${work}/install/lib/${flavor}/libsoundor_skia.a")
  else()
    file(COPY ${per_cpu} DESTINATION "${work}/install/lib/${flavor}")
  endif()
  # Keep the installed archive's established name.
  if(TARGET_OS STREQUAL "win")
    file(RENAME "${work}/install/lib/${flavor}/soundor_skia.lib" "${work}/install/lib/${flavor}/skia.lib")
  else()
    file(RENAME "${work}/install/lib/${flavor}/libsoundor_skia.a" "${work}/install/lib/${flavor}/libskia.a")
  endif()
endforeach()

list(GET FLAVORS 0 first_flavor)
list(GET CPUS 0 first_cpu)
execute_process(
  COMMAND "${gn}" desc "out/${first_flavor}-${first_cpu}" //:skia_public defines
  WORKING_DIRECTORY "${source}"
  OUTPUT_VARIABLE public_defines
  RESULT_VARIABLE status)
if(NOT status EQUAL 0)
  message(FATAL_ERROR "Could not read Skia's public defines")
endif()
file(WRITE "${work}/install/defines.txt" "${public_defines}")
file(COPY "${source}/include" DESTINATION "${work}/install")
# SVG's public headers include module and internal template headers. These
# remain private to the engine (the prebuilt archive stages no Skia headers).
foreach(module skcms svg skresources skshaper skunicode)
  file(COPY "${source}/modules/${module}" DESTINATION "${work}/install/modules" FILES_MATCHING PATTERN "*.h")
endforeach()
file(COPY "${source}/src" DESTINATION "${work}/install" FILES_MATCHING PATTERN "*.h")
foreach(header expat.h expat_external.h)
  file(COPY "${source}/third_party/externals/expat/expat/lib/${header}" DESTINATION "${work}/install/expat")
endforeach()
# Chromium's zlib API (Cr_z_ names) as the library defines it.
foreach(header zlib.h zconf.h chromeconf.h)
  file(COPY "${source}/third_party/externals/zlib/${header}" DESTINATION "${work}/install/zlib")
endforeach()
file(COPY "${source}/LICENSE" DESTINATION "${work}/install")

file(REMOVE_RECURSE "${OUT}")
file(RENAME "${work}/install" "${OUT}")
file(REMOVE_RECURSE "${work}")
message(STATUS "Skia: installed into ${OUT}")
