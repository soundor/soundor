// Requests, one at a time and in order, on the main thread. A process request
// runs on the audio worker while the main thread keeps running its loop (and
// an open editor); the next request waits until it is done.
#pragma once

#include "EventLoop.h"
#include "HostInterface.h"
#include "Ipc.h"
#include "LiveAudio.h"
#include "Plugin.h"
#include "Settings.h"

#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>
#include <thread>

namespace soundor::vst3host
{
    /** The thread process() runs on. */
    class AudioWorker
    {
    public:
        AudioWorker();
        ~AudioWorker();
        AudioWorker(const AudioWorker&) = delete;
        AudioWorker& operator=(const AudioWorker&) = delete;
        /** Runs `work` on the worker thread; one job at a time. */
        void run(std::function<void()> work);

    private:
        std::mutex mutex_;
        std::condition_variable wake_;
        std::function<void()> job_;
        bool stop_ = false;
        std::thread thread_;
    };

    class Session
    {
    public:
        Session(EventLoop& loop, FrameWriter& writer, bool ui);
        ~Session();

        /** The handshake: the first frame the client sees. */
        void hello(size_t maxPayload);
        void onFrame(Frame frame);
        /** The client closed the request stream. */
        void onInputClosed();
        /** The request stream is corrupt and cannot continue. */
        void onProtocolError(const std::string& message);
        int exitCode() const { return exitCode_; }

    private:
        void pump();
        void handle(Frame& frame);
        void respond(const Json& id, Json result, std::span<const uint8_t> payload = {});
        void respondError(const Json& id, const std::string& code, const std::string& message,
                          const Json& details = {});
        void emit(const std::string& event, Json params);
        void finish(int code);
        std::unique_ptr<EditorWindow> createWindow(const std::string& title, int width, int height,
                                                   EditorWindow::Callbacks callbacks, std::string& error);
        Json openEditor(const Json& params, const std::string& where);
        void applyAudio(const Json& params, const std::string& where);

        EventLoop& loop_;
        FrameWriter& writer_;
        bool ui_;
        Settings settings_;
        /** The presentation of the next editor: "editor" or "host". */
        std::string presentation_;
        Plugin plugin_;
        LiveAudio audio_;
        HostModel model_;
        AudioWorker worker_;
        std::deque<Frame> queue_;
        bool closing_ = false;
        int exitCode_ = 0;
    };
} // namespace soundor::vst3host
