#!/usr/bin/env bash
# linux-plugin-check.sh <plugin.so>: fails unless a Linux VST3 uses only the
# libraries a user's system has, needs no glibc above the baseline, and exports
# nothing but its entry points. The weak symbols it still exports are the C++
# headers' own template instantiations, in every C++ shared library; what must
# not appear are the standard library's strong ones, from a static one not hidden.
set -euo pipefail
binary=$1
baseline=2.39
status=0

for library in $(readelf -d "$binary" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p'); do
  case $library in
    libc.so.6 | libm.so.6 | ld-linux-x86-64.so.2 | libfontconfig.so.1 | libfreetype.so.6) ;;
    *)
      echo "::error::$binary needs $library"
      status=1
      ;;
  esac
done

glibc=$(objdump -T "$binary" | grep -oE 'GLIBC_[0-9]+\.[0-9.]*[0-9]' | sed 's/GLIBC_//' | sort -Vu | tail -1)
if [ "$(printf '%s\n%s\n' "$glibc" "$baseline" | sort -V | tail -1)" != "$baseline" ]; then
  echo "::error::$binary needs glibc $glibc, above the baseline $baseline"
  status=1
fi

strong=$(nm -D --defined-only "$binary" | sed -nE 's/^[0-9a-f]+ [TDBR] //p' |
  grep -vxE 'GetPluginFactory|ModuleEntry|ModuleExit|_init|_fini|_edata|_end|__bss_start' || true)
if [ -n "$strong" ]; then
  echo "::error::$binary exports more than its entry points:"
  echo "$strong" | head -20
  status=1
fi

debug=$(readelf -SW "$binary" | grep -c '\.debug_' || true)
if [ "$debug" -ne 0 ]; then
  echo "::error::$binary has debug sections: a library it links is not stripped of them"
  status=1
fi

[ "$status" -eq 0 ] && echo "$binary: glibc $glibc, its own C++ runtime, only its entry points"
exit "$status"
