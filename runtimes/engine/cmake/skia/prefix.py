"""Writes SoundorSkiaPrefix.h: the C symbols of the image libraries bundled in
Skia (libjpeg-turbo, libpng, libwebp), each renamed to soundor_<name>.

  prefix.py [--nm=<nm>] [--fresh] <libskia archive>...

Skia's build force-includes the header in every file it compiles (see
SoundorSkiaBuild.cmake), so the libraries define the prefixed names and Skia
calls them. A plugin can then also contain another copy of these libraries
(JUCE bundles its own) without two definitions of one name.

Give it Skia's archive from every platform and architecture: some names exist
on one only (libjpeg-turbo's NEON code on arm64, a table on Windows). The
release workflow's prebuilt engines have them all, under skia/lib/. ELF and
Mach-O archives are read with nm (on macOS, the system's reads universal
archives); Windows archives are read here, since no nm shows which
definitions are select-any. Names already in the header are kept unless
--fresh; renaming a name that no longer exists does nothing. An archive
already built with the header lists the prefixed names, which count as the
unprefixed ones.

The soundor_skia_prefixes_bundled_libraries test fails when Skia defines one of
these libraries' names unprefixed, which a Skia update can bring.
"""

import os
import re
import struct
import subprocess
import sys

PREFIX = 'soundor_'
# Archive members (gn names objects <target>.<source>.o) of the libraries.
MEMBER = re.compile(r'^lib(jpeg|jpeg12|jpeg16|png|webp)(_[a-z0-9]+)?\.')
# A C name; C++ ones (_Z..., MSVC's ?...) and compiler internals are not.
C_NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
HEADER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'SoundorSkiaPrefix.h')
# libwebp defines these as function-like macros of the same name (dropping the
# bit-trace label), which a #define here could not survive: SoundorSkiaBuild
# patches those macros to the prefixed names instead.
PATCHED = {'VP8GetValue', 'VP8GetSignedValue'}
DEFINE = re.compile(r'^#define (\w+) ' + PREFIX + r'\1$')


def library_member(member):
    return MEMBER.match(member.replace('\\', '/').split('/')[-1]) is not None


def nm_names(nm, archive):
    """Strong C definitions of the libraries' members, as {name: members}."""
    output = subprocess.run([nm, '-g', '--defined-only', archive], check=True,
                            capture_output=True, text=True).stdout
    # Mach-O nm output names members as archive(member.o):, and its names carry
    # one extra leading underscore.
    macho = re.search(r'^.*\([^()]+\.o\):$', output, re.MULTILINE) is not None
    member, found = None, {}
    for line in output.splitlines():
        # "member.o:" (ELF) or "archive(member.o):" (Mach-O).
        header = re.match(r'^(?:.*\()?([^()]+?)\)?:$', line)
        if header:
            member = header.group(1)
            continue
        parts = line.split()
        if len(parts) != 3 or member is None or not library_member(member):
            continue
        # Strong definitions only: weak and common ones are merged, not clashes.
        if parts[1] not in ('T', 'D', 'B', 'R', 'S'):
            continue
        symbol = parts[2][1:] if macho and parts[2].startswith('_') else parts[2]
        found.setdefault(symbol, set()).add(member)
    return found


def coff_names(data):
    """Like nm_names, for a Windows archive: external definitions outside
    select-any COMDATs (inline functions the CRT headers define in every
    object that calls them: fprintf, snprintf, sscanf_s...)."""
    found, longnames, pos = {}, b'', 8
    while pos + 60 <= len(data):
        name = data[pos:pos + 16].decode('latin1').strip()
        size = int(data[pos + 48:pos + 58].decode().strip())
        body = data[pos + 60:pos + 60 + size]
        pos += 60 + size + (size & 1)
        if name == '//':
            longnames = body
            continue
        if name.startswith('/') and name[1:].isdigit():
            member = longnames[int(name[1:]):].split(b'\0')[0].split(b'/\n')[0].decode('latin1')
        else:
            member = name.rstrip('/')
        if not library_member(member) or len(body) < 56:
            continue
        if body[:4] == b'\0\0\xff\xff':  # /bigobj: 56-byte header, 20-byte symbols
            sections, table, count = struct.unpack('<III', body[44:56])
            section_table, record, layout = 56, 20, '<8sIiHBB'
        else:
            sections, _, table, count, optional = struct.unpack('<HIIIH', body[2:18])
            section_table, record, layout = 20 + optional, 18, '<8sIhHBB'
        if not table:
            continue
        comdat = [struct.unpack('<I', body[section_table + 40 * i + 36:section_table + 40 * i + 40])[0] & 0x1000
                  for i in range(sections)]
        strings = table + record * count
        selection, defined, i = {}, [], 0
        while i < count:
            raw, value, section, _, storage, aux = struct.unpack(layout, body[table + record * i:table + record * (i + 1)])
            if raw[:4] == b'\0\0\0\0':
                start = strings + struct.unpack('<I', raw[4:])[0]
                symbol = body[start:body.index(b'\0', start)].decode('latin1')
            else:
                symbol = raw.rstrip(b'\0').decode('latin1')
            # A COMDAT section's first static symbol has the selection in its aux record.
            if storage == 3 and aux and section > 0 and comdat[section - 1] and section not in selection:
                selection[section] = body[table + record * (i + 1) + 14]
            if storage == 2 and section > 0:
                defined.append((symbol, section))
            i += 1 + aux
        for symbol, section in defined:
            # 1: no duplicates allowed; anything else is merged by the linker.
            if not comdat[section - 1] or selection.get(section) == 1:
                found.setdefault(symbol, set()).add(member)
    return found


def is_coff(data):
    """Whether an archive's first object is COFF (ELF ones also start with a
    "/" symbol-table member)."""
    pos = 8
    while data.startswith(b'!<arch>\n') and pos + 60 <= len(data):
        name = data[pos:pos + 16].strip()
        size = int(data[pos + 48:pos + 58].decode().strip())
        if name not in (b'/', b'//'):
            head = data[pos + 60:pos + 64]
            return head == b'\0\0\xff\xff' or head[:2] in (b'\x64\x86', b'\x64\xaa', b'\x4c\x01')
        pos += 60 + size + (size & 1)
    return False


def names(nm, archive):
    data = open(archive, 'rb').read()
    found = coff_names(data) if is_coff(data) else nm_names(nm, archive)
    result = set()
    for symbol, members in found.items():
        if symbol.startswith(PREFIX):
            symbol = symbol[len(PREFIX):]
        # A library defines each of its names in one object.
        if C_NAME.match(symbol) and len(members) == 1 and symbol not in PATCHED:
            result.add(symbol)
    return result


def main():
    nm = 'nm'
    fresh = False
    archives = []
    for argument in sys.argv[1:]:
        if argument.startswith('--nm='):
            nm = argument[len('--nm='):]
        elif argument == '--fresh':
            fresh = True
        elif argument.startswith('-'):
            sys.exit(__doc__)
        else:
            archives.append(argument)
    if not archives:
        sys.exit(__doc__)

    symbols = set()
    if not fresh and os.path.exists(HEADER):
        for line in open(HEADER, encoding='utf-8'):
            match = DEFINE.match(line.strip())
            if match:
                symbols.add(match.group(1))
    for archive in archives:
        symbols |= names(nm, archive)
    symbols -= PATCHED

    with open(HEADER, 'w', encoding='utf-8', newline='\n') as file:
        file.write('/* Generated by prefix.py: the C symbols of libjpeg-turbo, libpng and\n'
                   ' * libwebp as Skia bundles them, renamed so a plugin can contain another copy\n'
                   ' * of each. Force-included in every file of Skia\'s build. */\n\n'
                   '#ifndef SOUNDOR_SKIA_PREFIX_H\n#define SOUNDOR_SKIA_PREFIX_H\n\n'
                   '/* libpng would define png_get_uint_32() and its siblings as function-like\n'
                   ' * macros of the same name, over the renames below; the functions are\n'
                   ' * built either way. */\n'
                   '#define PNG_NO_USE_READ_MACROS\n\n')
        for symbol in sorted(symbols):
            file.write(f'#define {symbol} {PREFIX}{symbol}\n')
        file.write('\n#endif\n')
    print(f'{HEADER}: {len(symbols)} names')


if __name__ == '__main__':
    main()
