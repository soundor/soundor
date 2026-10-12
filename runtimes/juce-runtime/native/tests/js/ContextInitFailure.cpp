// Context.cpp in this executable expects another revision, so the runtime's
// own language module fails during construction. The error must survive
// destroying that partially initialized engine without retaining JSI values.
#include <soundor/js/Context.h>

#include <cstdio>
#include <stdexcept>
#include <string_view>

int main()
{
    soundor::js::Runtime runtime;
    for (int attempt = 0; attempt < 3; ++attempt)
    {
        try
        {
            soundor::js::Context context(runtime);
            std::fprintf(stderr, "Expected context initialization to refuse the mismatched bytecode.\n");
            return 1;
        }
        catch (const std::runtime_error& error)
        {
            const std::string_view message = error.what();
            if (message.find("Soundor could not create a JavaScript context") == std::string_view::npos
                || message.find("compiled for another Hermes") == std::string_view::npos)
            {
                std::fprintf(stderr, "Unexpected initialization error: %s\n", error.what());
                return 1;
            }
        }
        if (runtime.hasPendingJobs() || runtime.memoryUsage().objectCount != 0)
        {
            std::fprintf(stderr, "A failed context left an engine registered.\n");
            return 1;
        }
    }
    std::printf("Failed contexts release their error values before destroying Hermes.\n");
    return 0;
}
