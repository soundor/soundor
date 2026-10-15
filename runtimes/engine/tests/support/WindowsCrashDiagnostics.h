#pragma once

// Test-process diagnostics only. A first-chance handler prints the faulting
// symbol before doctest's unhandled-exception filter exits the process.
#if defined(_WIN32)
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #ifndef WIN32_LEAN_AND_MEAN
        #define WIN32_LEAN_AND_MEAN
    #endif
    // DbgHelp requires the Windows declarations first.
    // clang-format off
    #include <windows.h>
    #include <dbghelp.h>
// clang-format on

    #include <array>
    #include <atomic>
    #include <cstddef>
    #include <cstdio>
#endif

namespace soundor::test
{
    class WindowsCrashDiagnostics
    {
    public:
#if defined(_WIN32)
        WindowsCrashDiagnostics()
        {
            std::array<wchar_t, 2> enabled {};
            if (GetEnvironmentVariableW(L"SOUNDOR_WINDOWS_CRASH_DIAGNOSTICS", enabled.data(),
                                        static_cast<DWORD>(enabled.size()))
                    != 1
                || enabled[0] != L'1')
                return;
            SymSetOptions(SYMOPT_DEFERRED_LOADS | SYMOPT_UNDNAME | SYMOPT_LOAD_LINES | SYMOPT_FAIL_CRITICAL_ERRORS
                          | SYMOPT_NO_PROMPTS);
            symbols = SymInitialize(GetCurrentProcess(), ".", TRUE) != FALSE;
            handler = AddVectoredExceptionHandler(1, report);
        }

        ~WindowsCrashDiagnostics()
        {
            if (handler != nullptr)
                RemoveVectoredExceptionHandler(handler);
            if (symbols)
                SymCleanup(GetCurrentProcess());
        }

        WindowsCrashDiagnostics(const WindowsCrashDiagnostics&) = delete;
        WindowsCrashDiagnostics& operator=(const WindowsCrashDiagnostics&) = delete;

    private:
        static void describe(void* address)
        {
            alignas(SYMBOL_INFO) std::array<std::byte, sizeof(SYMBOL_INFO) + MAX_SYM_NAME> storage {};
            auto* symbol = reinterpret_cast<SYMBOL_INFO*>(storage.data());
            symbol->SizeOfStruct = static_cast<ULONG>(sizeof(SYMBOL_INFO));
            symbol->MaxNameLen = MAX_SYM_NAME;
            const auto pc = reinterpret_cast<DWORD64>(address);
            DWORD64 displacement = 0;
            if (SymFromAddr(GetCurrentProcess(), pc, &displacement, symbol))
                std::fprintf(stderr, "  %p %s + 0x%llx", address, symbol->Name,
                             static_cast<unsigned long long>(displacement));
            else
                std::fprintf(stderr, "  %p (symbol unavailable)", address);

            IMAGEHLP_LINE64 line {};
            line.SizeOfStruct = static_cast<DWORD>(sizeof(line));
            DWORD lineDisplacement = 0;
            if (SymGetLineFromAddr64(GetCurrentProcess(), pc, &lineDisplacement, &line))
                std::fprintf(stderr, " (%s:%lu)", line.FileName, static_cast<unsigned long>(line.LineNumber));
            std::fputc('\n', stderr);
        }

        static LONG CALLBACK report(EXCEPTION_POINTERS* exception)
        {
            if (exception->ExceptionRecord->ExceptionCode != EXCEPTION_ACCESS_VIOLATION)
                return EXCEPTION_CONTINUE_SEARCH;
            static std::atomic_flag reporting = ATOMIC_FLAG_INIT;
            if (reporting.test_and_set())
                return EXCEPTION_CONTINUE_SEARCH;
            std::fprintf(stderr, "Windows access violation: faulting instruction\n");
            describe(exception->ExceptionRecord->ExceptionAddress);
            std::array<void*, 32> frames {};
            const USHORT count = CaptureStackBackTrace(0, static_cast<DWORD>(frames.size()), frames.data(), nullptr);
            std::fprintf(stderr, "Windows exception stack:\n");
            for (USHORT index = 0; index < count; ++index)
                describe(frames[index]);
            std::fflush(stderr);
            reporting.clear();
            return EXCEPTION_CONTINUE_SEARCH;
        }

        void* handler = nullptr;
        bool symbols = false;
#endif
    };
} // namespace soundor::test
