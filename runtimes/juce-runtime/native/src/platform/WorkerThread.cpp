#include "WorkerThread.h"

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    WorkerThread::WorkerThread() : thread([this] { run(); }) {}

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

    void WorkerThread::run()
    {
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
            catch (...)
            {
            }
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
