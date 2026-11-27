#include "WorkerThread.h"

#include <future>

#if defined(__linux__)
    #include <pthread.h>
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    WorkerThread::WorkerThread(const char* name) : thread([this, name] { run(name); }) {}

    WorkerThread::~WorkerThread()
    {
        {
            const std::lock_guard lock(mutex);
            stopping = true;
        }
        wake.notify_one();
        thread.join();
    }

    void WorkerThread::post(std::function<void()> job)
    {
        {
            const std::lock_guard lock(mutex);
            jobs.push_back(std::move(job));
        }
        wake.notify_one();
    }

    void WorkerThread::finish()
    {
        std::promise<void> done;
        std::future<void> finished = done.get_future();
        post([&done] { done.set_value(); });
        finished.wait();
    }

    void WorkerThread::run(const char* name)
    {
#if defined(__linux__)
        if (name != nullptr)
            pthread_setname_np(pthread_self(), name);
#else
        static_cast<void>(name);
#endif
        for (;;)
        {
            std::function<void()> job;
            {
                std::unique_lock lock(mutex);
                wake.wait(lock, [this] { return stopping || ! jobs.empty(); });
                if (jobs.empty())
                    return; // stopping, and everything posted has run
                job = std::move(jobs.front());
                jobs.pop_front();
            }
            // Jobs report failures through their own completions; anything that
            // still escapes must not take the host process down.
            try
            {
                job();
            }
            catch (...) // NOLINT(bugprone-empty-catch): nothing to report to; see above
            {
            }
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
