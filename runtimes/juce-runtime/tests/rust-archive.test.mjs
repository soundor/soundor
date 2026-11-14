import assert from 'node:assert/strict';
// Run on Windows CI, or with SOUNDOR_TEST_COFF=1 and LLVM cross tools locally.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test(
  'isolates Rust personality symbols while preserving COFF import records',
  { skip: process.platform !== 'win32' && !process.env.SOUNDOR_TEST_COFF },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'soundor-coff-'));
    const tool = (name) =>
      process.env[`SOUNDOR_TEST_${name.replaceAll('-', '_').toUpperCase()}`] ??
      (process.platform === 'win32'
        ? join(process.env.ProgramFiles, 'LLVM', 'bin', `${name}.exe`)
        : name);
    const run = (command, args, ok = true) => {
      const result = spawnSync(command, args, { cwd: root });
      if (ok)
        assert.equal(
          result.status,
          0,
          `${command}: ${result.error ?? result.stderr.toString()}`,
        );
      else assert.notEqual(result.status, 0);
      return result.stdout;
    };
    try {
      const sources = {
        processor:
          'void rust_eh_personality(void) {}\nvoid processor(void) { rust_eh_personality(); }',
        accesskit:
          'void rust_eh_personality(void) {}\nvoid accesskit(void) { rust_eh_personality(); }',
        main: 'void processor(void); void accesskit(void);\nvoid mainCRTStartup(void) { processor(); accesskit(); }',
      };
      for (const [name, source] of Object.entries(sources)) {
        writeFileSync(join(root, `${name}.c`), source);
        run(tool('clang'), [
          '--target=x86_64-pc-windows-msvc',
          '-c',
          `${name}.c`,
          '-o',
          `${name}.obj`,
        ]);
      }
      // Windows short import header (not an ordinary COFF object).
      const payload = Buffer.from('GetLastError\0KERNEL32.dll\0');
      const header = Buffer.alloc(20);
      header.writeUInt16LE(0xffff, 2);
      header.writeUInt16LE(0x8664, 6);
      header.writeUInt32LE(payload.length, 12);
      header.writeUInt16LE(4, 18);
      const imported = Buffer.concat([header, payload]);
      writeFileSync(join(root, 'import.obj'), imported);
      run(tool('llvm-ar'), [
        'rcs',
        'processor.lib',
        'processor.obj',
        'import.obj',
      ]);
      // The previous whole-archive objcopy fails on this import record.
      const rename =
        '--redefine-sym=rust_eh_personality=soundor_processor_rust_eh_personality';
      run(tool('llvm-objcopy'), [rename, 'processor.lib', 'broken.lib'], false);
      const link = [
        '/entry:mainCRTStartup',
        '/subsystem:console',
        '/nodefaultlib',
        '/out:linked.exe',
        'main.obj',
        'accesskit.obj',
      ];
      run(tool('lld-link'), [...link, 'processor.lib'], false);
      run('cmake', [
        `-DINPUT=${join(root, 'processor.lib')}`,
        `-DOUTPUT=${join(root, 'isolated.lib')}`,
        `-DAR=${tool('llvm-ar')}`,
        `-DOBJCOPY=${tool('llvm-objcopy')}`,
        '-P',
        fileURLToPath(
          new URL('../native/SoundorRustWindows.cmake', import.meta.url),
        ),
      ]);
      run(tool('lld-link'), [...link, 'isolated.lib']);
      assert.deepEqual(
        run(tool('llvm-ar'), ['p', 'isolated.lib', 'import.obj']),
        imported,
      );
      assert.ok(readFileSync(join(root, 'linked.exe')).length > 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
