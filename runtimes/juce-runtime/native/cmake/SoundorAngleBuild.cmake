# Builds the ANGLE that Soundor renders WebGL and composites with, and
# installs it into OUT.
#
#   cmake -DOUT=<dir> -DREVISION=<sha> -DREPOSITORY=<url> -DDEPENDENCIES=<a;b=sparse,dirs>
#         -DTARGET_OS=<linux|mac|win> -DCPUS=<x64;arm64> -DFLAVORS=<release|md;mdd>
#         -DGN_URL=<url> -DGN_SHA256=<sha> [-DCC=<c compiler> -DCXX=<c++ compiler>]
#         -P SoundorAngleBuild.cmake
#
# ANGLE is fetched at REVISION and its third-party code only for DEPENDENCIES,
# each at the commit ANGLE's own DEPS file pins. gn (pinned, SHA-256 verified)
# works out what to compile for the platform; Soundor compiles it with the
# given compilers into one static library (cmake/angle). The backends are the
# platform's own: Metal on macOS, Direct3D 11 on Windows, Vulkan and OpenGL
# (through EGL) on Linux. Nothing of ANGLE is exported. OUT gets:
#
#   include/            ANGLE's public headers (EGL, GLES2, GLES3, KHR)
#   lib/<flavor>/       the static library, one per FLAVORS entry
#   libs.txt            the system libraries it links against
#   frameworks.txt      ... and on macOS, the frameworks
#   licenses/           ANGLE's and its third-party code's licenses
#
# OUT appears only once the build succeeded (built aside, then renamed).

cmake_minimum_required(VERSION 3.22)

foreach(required OUT REVISION REPOSITORY DEPENDENCIES TARGET_OS CPUS FLAVORS GN_URL GN_SHA256)
  if(NOT DEFINED ${required} OR "${${required}}" STREQUAL "")
    message(FATAL_ERROR "SoundorAngleBuild.cmake: ${required} is required")
  endif()
endforeach()

find_package(Git REQUIRED)
find_package(Python3 REQUIRED COMPONENTS Interpreter)
find_program(NINJA_EXE NAMES ninja REQUIRED)

set(scripts "${CMAKE_CURRENT_LIST_DIR}/angle")
set(work "${OUT}.partial")
set(source "${work}/angle")
file(REMOVE_RECURSE "${work}")
file(MAKE_DIRECTORY "${source}")

function(run)
  execute_process(COMMAND ${ARGN} WORKING_DIRECTORY "${cwd}" RESULT_VARIABLE status)
  if(NOT status EQUAL 0)
    list(JOIN ARGN " " command)
    message(FATAL_ERROR "Building ANGLE failed: ${command}")
  endif()
endfunction()

message(STATUS "ANGLE: fetching ${REVISION}")
set(cwd "${source}")
run(${GIT_EXECUTABLE} init --quiet)
run(${GIT_EXECUTABLE} fetch --quiet --depth 1 "${REPOSITORY}" "${REVISION}")
run(${GIT_EXECUTABLE} -c advice.detachedHead=false checkout --quiet FETCH_HEAD)
run(${Python3_EXECUTABLE} "${scripts}/deps.py" "${source}" ${DEPENDENCIES})

# gn, at the version ANGLE's DEPS pins (a CIPD package).
message(STATUS "ANGLE: fetching gn")
file(DOWNLOAD "${GN_URL}" "${work}/gn.zip" EXPECTED_HASH SHA256=${GN_SHA256} STATUS download)
list(GET download 0 download_status)
if(NOT download_status EQUAL 0)
  message(FATAL_ERROR "Downloading gn failed: ${download}")
endif()
file(ARCHIVE_EXTRACT INPUT "${work}/gn.zip" DESTINATION "${work}/gn")
if(TARGET_OS STREQUAL "win")
  set(gn "${work}/gn/gn.exe")
else()
  set(gn "${work}/gn/gn")
  file(CHMOD "${gn}" PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE)
endif()

set(common_args [=[
is_debug = false
is_component_build = false
is_official_build = false
treat_warnings_as_errors = false
use_custom_libcxx = false
clang_use_chrome_plugins = false
enable_rust = false
angle_build_tests = false
angle_has_frame_capture = false
angle_enable_null = false
angle_enable_swiftshader = false
angle_enable_wgpu = false
angle_enable_cl = false
angle_enable_d3d9 = false
angle_enable_vulkan_validation_layers = false
angle_use_custom_libvulkan = false
]=])
if(TARGET_OS STREQUAL "linux")
  # Vulkan, and OpenGL through the system's EGL (both loaded at run time).
  # No window system or GLib is linked, nor looked for with pkg-config.
  string(APPEND common_args [=[
is_clang = true
use_sysroot = false
angle_enable_vulkan = true
angle_enable_gl = true
angle_use_x11 = false
angle_use_wayland = false
use_libpci = false
use_glib = false
]=])
elseif(TARGET_OS STREQUAL "mac")
  # Metal only: ANGLE's OpenGL backend there defines an Objective-C class,
  # which plugins must not.
  string(APPEND common_args [=[
is_clang = true
use_system_xcode = true
angle_enable_metal = true
angle_enable_vulkan = false
angle_enable_gl = false
]=])
elseif(TARGET_OS STREQUAL "win")
  string(APPEND common_args [=[
is_clang = false
angle_enable_d3d11 = true
angle_enable_vulkan = false
angle_enable_gl = false
]=])
else()
  message(FATAL_ERROR "Soundor cannot build ANGLE for '${TARGET_OS}'")
endif()

if(TARGET_OS STREQUAL "win")
  # gn finds Visual Studio itself; it must not look for Chromium's toolchain.
  set(ENV{DEPOT_TOOLS_WIN_TOOLCHAIN} 0)
endif()

# targets.py's output is read here only for its lists.
function(angle_target)
endfunction()

# gn never compiles here, but it reads what Chromium's own Clang would be
# unless told where a Clang is: the one that does compile, when known.
if(NOT TARGET_OS STREQUAL "win")
  set(clang_prefix "/usr")
  if(DEFINED CXX AND NOT CXX STREQUAL "")
    get_filename_component(clang_prefix "${CXX}" DIRECTORY)
    get_filename_component(clang_prefix "${clang_prefix}" DIRECTORY)
  endif()
  string(APPEND common_args "clang_base_path = \"${clang_prefix}\"\n")
endif()

set(roots "//:libGLESv2_static" "//:libEGL_static")
foreach(cpu IN LISTS CPUS)
  set(gn_out "${source}/out/${cpu}")
  file(WRITE "${gn_out}/args.gn" "${common_args}target_os = \"${TARGET_OS}\"\ntarget_cpu = \"${cpu}\"\n")
  message(STATUS "ANGLE: configuring ${cpu}")
  set(cwd "${source}")
  run("${gn}" gen "out/${cpu}" --ide=json)
  run(${Python3_EXECUTABLE} "${scripts}/targets.py" "${gn_out}/project.json" "${source}" "${work}/targets-${cpu}.cmake"
      ${roots})
  # Headers ANGLE generates (version, tables): gn's own actions, run by ninja.
  include("${work}/targets-${cpu}.cmake")
  if(ANGLE_GENERATED)
    run(${NINJA_EXE} -C "${gn_out}" ${ANGLE_GENERATED})
  endif()

  foreach(flavor IN LISTS FLAVORS)
    set(build "${work}/build/${flavor}-${cpu}")
    set(options
      -G Ninja
      -DCMAKE_BUILD_TYPE=Release
      "-DANGLE_TARGETS=${work}/targets-${cpu}.cmake"
      "-DCMAKE_INSTALL_PREFIX=${build}/install")
    if(TARGET_OS STREQUAL "win")
      # The C runtime has to match the plugin's: /MD, or /MDd in Debug.
      if(flavor STREQUAL "mdd")
        list(APPEND options -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDebugDLL)
      else()
        list(APPEND options -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL)
      endif()
      list(APPEND options -DCMAKE_POLICY_DEFAULT_CMP0091=NEW)
    elseif(TARGET_OS STREQUAL "mac")
      if(cpu STREQUAL "x64")
        list(APPEND options -DCMAKE_OSX_ARCHITECTURES=x86_64)
      else()
        list(APPEND options -DCMAKE_OSX_ARCHITECTURES=arm64)
      endif()
    endif()
    if(DEFINED CC AND NOT CC STREQUAL "")
      list(APPEND options "-DCMAKE_C_COMPILER=${CC}" "-DCMAKE_CXX_COMPILER=${CXX}")
      if(TARGET_OS STREQUAL "mac")
        list(APPEND options "-DCMAKE_OBJC_COMPILER=${CC}" "-DCMAKE_OBJCXX_COMPILER=${CXX}")
      endif()
    endif()
    message(STATUS "ANGLE: building ${flavor}-${cpu}")
    set(cwd "${work}")
    run(${CMAKE_COMMAND} -S "${scripts}" -B "${build}" ${options})
    run(${CMAKE_COMMAND} --build "${build}")
    run(${CMAKE_COMMAND} --install "${build}")
  endforeach()
endforeach()

foreach(flavor IN LISTS FLAVORS)
  set(per_cpu "")
  foreach(cpu IN LISTS CPUS)
    file(GLOB built "${work}/build/${flavor}-${cpu}/install/lib/*")
    list(APPEND per_cpu ${built})
  endforeach()
  file(MAKE_DIRECTORY "${work}/install/lib/${flavor}")
  list(LENGTH per_cpu cpu_count)
  if(cpu_count GREATER 1)
    # macOS universal: one archive for every architecture.
    set(cwd "${work}")
    run(lipo -create ${per_cpu} -output "${work}/install/lib/${flavor}/libangle.a")
  else()
    file(COPY ${per_cpu} DESTINATION "${work}/install/lib/${flavor}")
  endif()
endforeach()

# What it links against (the same for every CPU).
list(GET CPUS 0 first_cpu)
include("${work}/targets-${first_cpu}.cmake")
string(REPLACE ";" "\n" libs "${ANGLE_LIBS}")
string(REPLACE ";" "\n" frameworks "${ANGLE_FRAMEWORKS}")
file(WRITE "${work}/install/libs.txt" "${libs}\n")
file(WRITE "${work}/install/frameworks.txt" "${frameworks}\n")

file(COPY "${source}/include/" DESTINATION "${work}/install/include"
     FILES_MATCHING PATTERN "*.h" PATTERN "*.inc")
file(COPY "${source}/LICENSE" DESTINATION "${work}/install/licenses/angle")
file(GLOB vendored LIST_DIRECTORIES true "${source}/src/common/third_party/*")
foreach(directory IN LISTS vendored)
  file(GLOB licenses "${directory}/LICENSE*")
  if(licenses)
    get_filename_component(name "${directory}" NAME)
    file(COPY ${licenses} DESTINATION "${work}/install/licenses/angle_${name}")
  endif()
endforeach()
foreach(dependency IN LISTS DEPENDENCIES)
  string(REGEX REPLACE "=.*" "" path "${dependency}")
  file(GLOB licenses "${source}/${path}/LICENSE*" "${source}/${path}/COPYING*" "${source}/${path}/src/LICENSE*")
  if(licenses)
    string(REPLACE "/" "_" name "${path}")
    file(COPY ${licenses} DESTINATION "${work}/install/licenses/${name}")
  endif()
endforeach()

file(REMOVE_RECURSE "${OUT}")
file(RENAME "${work}/install" "${OUT}")
file(REMOVE_RECURSE "${work}")
message(STATUS "ANGLE: installed into ${OUT}")
