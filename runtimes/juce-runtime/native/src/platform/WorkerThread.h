#pragma once

// Private to soundor_runtime: background execution for blocking work (file
// I/O, storage) that must never run on the UI thread.

#include <soundor/Config.h>

#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    // One background thread running posted jobs in order. Destruction finishes
    // every job already posted (so a write is never cut short) and joins.
    class WorkerThread
    {
    public:
        WorkerThread();
        ~WorkerThread();

        WorkerThread(const WorkerThread&) = delete;
        WorkerThread& operator=(const WorkerThread&) = delete;

        void post(std::function<void()> job);

    private:
        void run();

        std::mutex mutex;
        std::condition_variable wake;
        std::deque<std::function<void()>> jobs;
        bool stopping = false;
        std::thread thread;
    };

    // Work handed back to the UI thread. Any thread may post; only the UI
    // thread takes. Items must capture plain data only (never engine values),
    // because an item that is never taken is destroyed on whatever thread
    // drops the last reference to the queue.
    template <typename Item>
    class HandoffQueue
    {
    public:
        void post(Item item)
        {
            const std::lock_guard lock(mutex);
            items.push_back(std::move(item));
        }

        [[nodiscard]] std::vector<Item> take()
        {
            const std::lock_guard lock(mutex);
            std::vector<Item> taken(std::make_move_iterator(items.begin()), std::make_move_iterator(items.end()));
            items.clear();
            return taken;
        }

    private:
        std::mutex mutex;
        std::deque<Item> items;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
