// soundor-vst3-host: a VST3 host controlled over stdin/stdout (README,
// "Protocol"). Usage:
//
//   soundor-vst3-host [--ui] [--max-payload <bytes>]   run, speaking the protocol
//   soundor-vst3-host --version                       print its identity as JSON
//
// Protocol frames use the process's original stdin and stdout; plugins that
// write to stdout (fd 1) write to stderr instead, which carries diagnostics.
#include "EventLoop.h"
#include "Ipc.h"
#include "Session.h"
#include "Version.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <thread>

#if defined(_WIN32)
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #include <fcntl.h>
    #include <io.h>
    #include <ole2.h>
    #include <windows.h>
#else
    #include <fcntl.h>
    #include <unistd.h>
#endif
#if defined(__linux__)
    #include <sys/prctl.h>

    #include <csignal>
#endif

namespace
{
    using namespace soundor::vst3host;

    struct Channels
    {
        NativeHandle in = 0;
        NativeHandle out = 0;
    };

    // Moves the protocol's streams to private handles, and points the
    // standard ones somewhere harmless: stdout to stderr, stdin to nothing.
    Channels takeStdio()
    {
        Channels channels;
#if defined(_WIN32)
        const HANDLE process = GetCurrentProcess();
        HANDLE in = nullptr;
        HANDLE out = nullptr;
        DuplicateHandle(process, GetStdHandle(STD_INPUT_HANDLE), process, &in, 0, FALSE, DUPLICATE_SAME_ACCESS);
        DuplicateHandle(process, GetStdHandle(STD_OUTPUT_HANDLE), process, &out, 0, FALSE, DUPLICATE_SAME_ACCESS);
        channels.in = reinterpret_cast<NativeHandle>(in);
        channels.out = reinterpret_cast<NativeHandle>(out);
        std::fflush(stdout);
        _dup2(_fileno(stderr), _fileno(stdout));
        SetStdHandle(STD_OUTPUT_HANDLE, GetStdHandle(STD_ERROR_HANDLE));
        const int nul = _open("NUL", _O_RDONLY);
        if (nul >= 0)
        {
            _dup2(nul, _fileno(stdin));
            _close(nul);
        }
        SetStdHandle(STD_INPUT_HANDLE, reinterpret_cast<HANDLE>(_get_osfhandle(_fileno(stdin))));
#else
        channels.in = fcntl(0, F_DUPFD_CLOEXEC, 3);
        channels.out = fcntl(1, F_DUPFD_CLOEXEC, 3);
        std::fflush(stdout);
        dup2(2, 1);
        const int null = open("/dev/null", O_RDONLY | O_CLOEXEC);
        if (null >= 0)
        {
            dup2(null, 0);
            close(null);
        }
#endif
        return channels;
    }

    int printVersion()
    {
        std::printf("{\"name\":\"@soundor/vst3-host\",\"version\":\"%s\",\"protocol\":%d,\"sdkVersion\":\"%s\"}\n",
                    hostVersion, protocolVersion, sdkVersion);
        return 0;
    }

    int usage(const char* problem)
    {
        std::fprintf(stderr,
                     "soundor-vst3-host: %s\n"
                     "usage: soundor-vst3-host [--ui] [--max-payload <bytes>] | --version\n"
                     "It speaks a framed protocol on stdin/stdout; launch it with @soundor/vst3-host's launchHost().\n",
                     problem);
        return 64;
    }
} // namespace

int main(int argc, char** argv)
{
    bool ui = false;
    unsigned long long maxPayload = defaultMaxPayload;
    for (int i = 1; i < argc; ++i)
    {
        const std::string arg = argv[i];
        if (arg == "--version")
            return printVersion();
        if (arg == "--ui")
            ui = true;
        else if (arg == "--headless")
            ui = false;
        else if (arg == "--max-payload" && i + 1 < argc)
        {
            char* end = nullptr;
            maxPayload = std::strtoull(argv[++i], &end, 10);
            if (end == nullptr || *end != '\0' || maxPayload == 0 || maxPayload > 0xFFFFFFFFULL)
                return usage("--max-payload takes a byte count up to 4294967295");
        }
        else
            return usage(("unknown argument " + arg).c_str());
    }

#if defined(__linux__)
    // Never outlive the client, even if it is killed without closing stdin.
    prctl(PR_SET_PDEATHSIG, SIGKILL);
#endif
#if defined(_WIN32)
    if (ui)
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    // Plugins expect a single-threaded COM apartment on their UI thread.
    OleInitialize(nullptr);
#endif

    const Channels channels = takeStdio();
    auto loop = EventLoop::create(ui);
    FrameWriter writer(channels.out);
    auto session = std::make_unique<Session>(*loop, writer, ui);
    session->hello(static_cast<size_t>(maxPayload));

    // Requests are read on their own thread and handled on the main thread.
    std::thread reader(
        [&loop, &session, in = channels.in, maxPayload]
        {
            FrameReader frames(in, static_cast<size_t>(maxHeader), static_cast<size_t>(maxPayload));
            while (true)
            {
                auto frame = std::make_shared<Frame>();
                std::string error;
                switch (frames.read(*frame, error))
                {
                    case FrameReader::Status::Frame:
                        loop->post([&session, frame] { session->onFrame(std::move(*frame)); });
                        continue;
                    case FrameReader::Status::End:
                        loop->post([&session] { session->onInputClosed(); });
                        return;
                    case FrameReader::Status::Error:
                        loop->post([&session, error] { session->onProtocolError(error); });
                        return;
                }
            }
        });
    reader.detach();

    loop->run();
    const int code = session->exitCode();
    session.reset();
    std::fflush(stderr);
    // The reader may still be blocked on stdin: leave without running static
    // destructors under it.
    std::_Exit(code);
}
