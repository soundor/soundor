#include "EventLoop.h"

#include <fcntl.h>
#include <poll.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <deque>
#include <mutex>
#include <vector>

namespace soundor::vst3host
{
    namespace
    {
        class LinuxEventLoop final : public EventLoop
        {
        public:
            LinuxEventLoop()
            {
                if (pipe2(wake_, O_CLOEXEC | O_NONBLOCK) != 0)
                    wake_[0] = wake_[1] = -1;
            }

            ~LinuxEventLoop() override
            {
                for (const int fd : wake_)
                    if (fd >= 0)
                        close(fd);
            }

            void run() override
            {
                running_ = true;
                while (running_)
                {
                    runTasks();
                    if (! running_)
                        break;

                    std::vector<pollfd> fds;
                    std::vector<Id> ids;
                    fds.push_back({ wake_[0], POLLIN, 0 });
                    ids.push_back(0);
                    for (const auto& handler : fds_)
                    {
                        fds.push_back({ handler.fd, POLLIN, 0 });
                        ids.push_back(handler.id);
                    }

                    const int ready = poll(fds.data(), fds.size(), timeoutMs());
                    if (ready < 0 && errno != EINTR)
                        break;
                    if (ready > 0)
                    {
                        if ((fds[0].revents & POLLIN) != 0)
                        {
                            char buffer[64];
                            while (read(wake_[0], buffer, sizeof buffer) > 0)
                            {
                            }
                        }
                        for (size_t i = 1; i < fds.size(); ++i)
                            if ((fds[i].revents & (POLLIN | POLLHUP | POLLERR)) != 0)
                                fireFd(ids[i]);
                    }
                    fireTimers();
                }
            }

            void quit() override
            {
                running_ = false;
                wake();
            }

            void post(std::function<void()> task) override
            {
                {
                    const std::scoped_lock lock(mutex_);
                    tasks_.push_back(std::move(task));
                }
                wake();
            }

            Id addFd(int fd, std::function<void()> readable) override
            {
                const Id id = ++nextId_;
                fds_.push_back({ id, fd, std::move(readable) });
                return id;
            }

            void removeFd(Id id) override
            {
                std::erase_if(fds_, [id](const FdHandler& handler) { return handler.id == id; });
            }

            Id addTimer(unsigned milliseconds, std::function<void()> fire) override
            {
                const Id id = ++nextId_;
                const auto interval = std::chrono::milliseconds(std::max(1U, milliseconds));
                timers_.push_back({ id, interval, Clock::now() + interval, std::move(fire) });
                return id;
            }

            void removeTimer(Id id) override
            {
                std::erase_if(timers_, [id](const Timer& timer) { return timer.id == id; });
            }

        private:
            using Clock = std::chrono::steady_clock;
            struct FdHandler
            {
                Id id;
                int fd;
                std::function<void()> readable;
            };
            struct Timer
            {
                Id id;
                Clock::duration interval;
                Clock::time_point due;
                std::function<void()> fire;
            };

            void wake()
            {
                if (wake_[1] >= 0)
                {
                    const char byte = 1;
                    [[maybe_unused]] const auto written = write(wake_[1], &byte, 1);
                }
            }

            void runTasks()
            {
                std::deque<std::function<void()>> tasks;
                {
                    const std::scoped_lock lock(mutex_);
                    tasks.swap(tasks_);
                }
                for (auto& task : tasks)
                    task();
            }

            [[nodiscard]] int timeoutMs() const
            {
                if (timers_.empty())
                    return -1;
                const auto now = Clock::now();
                auto next = timers_.front().due;
                for (const auto& timer : timers_)
                    next = std::min(next, timer.due);
                if (next <= now)
                    return 0;
                return static_cast<int>(std::chrono::ceil<std::chrono::milliseconds>(next - now).count());
            }

            // Handlers may add or remove handlers; each is looked up again.
            void fireFd(Id id)
            {
                const auto it = std::ranges::find(fds_, id, &FdHandler::id);
                if (it == fds_.end())
                    return;
                const auto callback = it->readable;
                callback();
            }

            void fireTimers()
            {
                const auto now = Clock::now();
                std::vector<Id> due;
                for (const auto& timer : timers_)
                    if (timer.due <= now)
                        due.push_back(timer.id);
                for (const Id id : due)
                {
                    const auto it = std::ranges::find(timers_, id, &Timer::id);
                    if (it == timers_.end())
                        continue;
                    it->due = now + it->interval;
                    const auto callback = it->fire;
                    callback();
                }
            }

            int wake_[2] = { -1, -1 };
            bool running_ = false;
            std::mutex mutex_;
            std::deque<std::function<void()>> tasks_;
            std::vector<FdHandler> fds_;
            std::vector<Timer> timers_;
            Id nextId_ = 0;
        };
    } // namespace

    std::unique_ptr<EventLoop> EventLoop::create(bool /*ui*/)
    {
        return std::make_unique<LinuxEventLoop>();
    }
} // namespace soundor::vst3host
