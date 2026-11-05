#include "Session.h"

#include "Bundle.h"
#include "HostWindow.h"
#include "Version.h"
#include "pluginterfaces/vst/vstspeaker.h"

#include <cctype>
#include <cmath>
#include <cstring>

namespace soundor::vst3host
{
    using namespace Steinberg::Vst;

    AudioWorker::AudioWorker()
        : thread_(
              [this]
              {
                  while (true)
                  {
                      std::function<void()> job;
                      {
                          std::unique_lock lock(mutex_);
                          wake_.wait(lock, [this] { return stop_ || job_ != nullptr; });
                          if (stop_ && job_ == nullptr)
                              return;
                          job = std::move(job_);
                          job_ = nullptr;
                      }
                      job();
                  }
              })
    {
    }

    AudioWorker::~AudioWorker()
    {
        {
            const std::scoped_lock lock(mutex_);
            stop_ = true;
        }
        wake_.notify_one();
        thread_.join();
    }

    void AudioWorker::run(std::function<void()> work)
    {
        {
            const std::scoped_lock lock(mutex_);
            job_ = std::move(work);
        }
        wake_.notify_one();
    }

    namespace
    {
        const char* platformName()
        {
#if defined(_WIN32)
            return "win32";
#elif defined(__APPLE__)
            return "darwin";
#else
            return "linux";
#endif
        }

        std::string requireString(const Json& params, const char* name, const std::string& where)
        {
            const Json* value = params.find(name);
            if (value == nullptr || ! value->isString() || value->asString().empty())
                throw Failure("invalid-request", where + "." + name + " must be a non-empty string");
            return value->asString();
        }

        std::string optionalString(const Json& params, const char* name, const std::string& where)
        {
            const Json* value = params.find(name);
            if (value == nullptr || value->isNull())
                return {};
            if (! value->isString())
                throw Failure("invalid-request", where + "." + name + " must be a string");
            return value->asString();
        }

        SpeakerArrangement arrangementForChannels(int64 channels)
        {
            switch (channels)
            {
                case 0:
                    return SpeakerArr::kEmpty;
                case 1:
                    return SpeakerArr::kMono;
                case 2:
                    return SpeakerArr::kStereo;
                case 3:
                    return SpeakerArr::k30Cine;
                case 4:
                    return SpeakerArr::k40Music;
                case 5:
                    return SpeakerArr::k50;
                case 6:
                    return SpeakerArr::k51;
                case 8:
                    return SpeakerArr::k71Cine;
                default:
                    return (SpeakerArrangement { 1 } << static_cast<unsigned>(channels)) - 1;
            }
        }

        SpeakerArrangement parseArrangement(const std::string& text, const std::string& where)
        {
            if (text.starts_with("0x") || text.starts_with("0X"))
            {
                try
                {
                    size_t used = 0;
                    const auto value = std::stoull(text.substr(2), &used, 16);
                    if (used == text.size() - 2)
                        return static_cast<SpeakerArrangement>(value);
                }
                catch (const std::exception&) // NOLINT(bugprone-empty-catch): reported below
                {
                }
                throw Failure("invalid-request", where + ".arrangement \"" + text + "\" is not a hexadecimal mask");
            }
            const std::string lower = [&]
            {
                std::string result = text;
                for (char& c : result)
                    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                return result;
            }();
            if (lower == "mono")
                return SpeakerArr::kMono;
            if (lower == "stereo")
                return SpeakerArr::kStereo;
            if (lower == "empty")
                return SpeakerArr::kEmpty;
            // The SDK's names ("5.1", "7.1 Cine", ...).
            const SpeakerArrangement named = SpeakerArr::getSpeakerArrangementFromString(text.c_str());
            if (named != SpeakerArr::kEmpty)
                return named;
            throw Failure("invalid-request", where + ".arrangement \"" + text
                                                 + "\" is not a known speaker arrangement (mono, stereo, an SDK "
                                                   "name such as \"5.1\", or a hexadecimal mask such as \"0x3\")");
        }

        std::vector<std::optional<BusRequest>> parseBuses(const Json* list, const std::string& where)
        {
            std::vector<std::optional<BusRequest>> result;
            if (list == nullptr || list->isNull())
                return result;
            if (! list->isArray())
                throw Failure("invalid-request", where + " must be an array of bus settings");
            for (size_t index = 0; index < list->asArray().size(); ++index)
            {
                const Json& entry = list->asArray()[index];
                const std::string at = where + "[" + std::to_string(index) + "]";
                if (entry.isNull())
                {
                    result.emplace_back();
                    continue;
                }
                if (! entry.isObject())
                    throw Failure("invalid-request", at + " must be null or { channels, arrangement, active }");
                BusRequest request;
                const Json* channels = entry.find("channels");
                if (channels != nullptr && ! channels->isNull())
                {
                    if (! channels->isNumber() || channels->asNumber() != std::floor(channels->asNumber())
                        || channels->asNumber() < 0 || channels->asNumber() > 64)
                        throw Failure("invalid-request", at + ".channels must be an integer from 0 to 64");
                    request.arrangement = arrangementForChannels(static_cast<int64>(channels->asNumber()));
                }
                const std::string arrangement = optionalString(entry, "arrangement", at);
                if (! arrangement.empty())
                {
                    const auto parsed = parseArrangement(arrangement, at);
                    if (request.arrangement
                        && SpeakerArr::getChannelCount(parsed) != SpeakerArr::getChannelCount(*request.arrangement))
                    {
                        std::string message = at;
                        message += ".arrangement \"" + arrangement + "\" does not have ";
                        message += std::to_string(SpeakerArr::getChannelCount(*request.arrangement)) + " channels";
                        throw Failure("invalid-request", message);
                    }
                    request.arrangement = parsed;
                }
                if (const Json* active = entry.find("active"); active != nullptr && ! active->isNull())
                {
                    if (! active->isBool())
                        throw Failure("invalid-request", at + ".active must be a boolean");
                    request.active = active->asBool();
                }
                result.emplace_back(request);
            }
            return result;
        }

        Setup parseSetup(const Json& params, const Setup& base, const std::string& where)
        {
            Setup setup = base;
            if (const Json* rate = params.find("sampleRate"); rate != nullptr && ! rate->isNull())
            {
                if (! rate->isNumber() || ! std::isfinite(rate->asNumber()) || rate->asNumber() < 1000
                    || rate->asNumber() > 1536000)
                    throw Failure("invalid-request", where + ".sampleRate must be from 1000 to 1536000 Hz");
                setup.sampleRate = rate->asNumber();
            }
            if (const Json* block = params.find("blockSize"); block != nullptr && ! block->isNull())
            {
                if (! block->isNumber() || block->asNumber() != std::floor(block->asNumber()) || block->asNumber() < 1
                    || block->asNumber() > 65536)
                    throw Failure("invalid-request", where + ".blockSize must be an integer from 1 to 65536");
                setup.blockSize = static_cast<int32>(block->asNumber());
            }
            const std::string mode = optionalString(params, "processMode", where);
            if (mode == "realtime")
                setup.processMode = kRealtime;
            else if (mode == "offline")
                setup.processMode = kOffline;
            else if (mode == "prefetch")
                setup.processMode = kPrefetch;
            else if (! mode.empty())
                throw Failure("invalid-request", where + R"(.processMode must be "realtime", "offline" or "prefetch")");
            if (params.find("inputs") != nullptr)
                setup.inputs = parseBuses(params.find("inputs"), where + ".inputs");
            if (params.find("outputs") != nullptr)
                setup.outputs = parseBuses(params.find("outputs"), where + ".outputs");
            return setup;
        }

        ParamID parameterId(const Json& params, const std::string& where)
        {
            const Json* id = params.find("id");
            if (id == nullptr || ! id->isNumber() || id->asNumber() != std::floor(id->asNumber()) || id->asNumber() < 0
                || id->asNumber() > 4294967295.0)
                throw Failure("invalid-request",
                              where + ".id must be a VST3 parameter id (an unsigned 32-bit integer)");
            return static_cast<ParamID>(id->asNumber());
        }
    } // namespace

    Session::Session(EventLoop& loop, FrameWriter& writer, bool ui)
        : loop_(loop),
          writer_(writer),
          ui_(ui),
          settings_(Settings::load()),
          presentation_(settings_.presentation),
          plugin_(loop, ui,
                  PluginCallbacks { [this](const std::string& event, Json params) { emit(event, std::move(params)); },
                                    [this](const std::string& title, int width, int height,
                                           EditorWindow::Callbacks callbacks, std::string& error)
                                    { return createWindow(title, width, height, std::move(callbacks), error); } }),
          audio_(loop, plugin_),
          model_ { plugin_, audio_, settings_,
                   [this](const std::string& event, Json params) { emit(event, std::move(params)); } }
    {
        audio_.setVolume(settings_.volume);
    }

    std::unique_ptr<EditorWindow> Session::createWindow(const std::string& title, int width, int height,
                                                        EditorWindow::Callbacks callbacks, std::string& error)
    {
#if defined(__linux__)
        // X11 needs the same live presentation with or without the interface.
        return HostWindow::create(loop_, model_, title, width, height, presentation_ != "host", std::move(callbacks),
                                  error);
#else
        if (presentation_ == "host")
            return HostWindow::create(loop_, model_, title, width, height, false, std::move(callbacks), error);
        return EditorWindow::create(loop_, title, width, height, std::move(callbacks), error);
#endif
    }

    Json Session::openEditor(const Json& params, const std::string& where)
    {
        std::optional<double> scale;
        if (const Json* value = params.find("scale"); value != nullptr && ! value->isNull())
        {
            if (! value->isNumber() || value->asNumber() <= 0 || value->asNumber() > 8)
                throw Failure("invalid-request", where + ".scale must be from 0 to 8");
            scale = value->asNumber();
        }
        const std::string presentation = optionalString(params, "presentation", where);
        if (! presentation.empty() && presentation != "editor" && presentation != "host")
            throw Failure("invalid-request", where + R"(.presentation must be "editor" or "host")");
        // An editor already open in another presentation opens again in this
        // one, at the same size and scale.
        if (! presentation.empty() && presentation != presentation_)
        {
            presentation_ = presentation;
            if (plugin_.editorOpen())
            {
                const Json before = plugin_.editorInfo();
                if (! scale)
                    scale = plugin_.editorScale();
                plugin_.closeEditor();
                plugin_.openEditor(scale);
                if (plugin_.editorOpen())
                {
                    const Json* width = before.find("width");
                    const Json* height = before.find("height");
                    const Json after = plugin_.editorInfo();
                    if (after.find("resizable")->asBool()
                        && (after.find("width")->asNumber() != width->asNumber()
                            || after.find("height")->asNumber() != height->asNumber()))
                        plugin_.resizeEditor(static_cast<int>(width->asNumber()), static_cast<int>(height->asNumber()));
                }
                return plugin_.editorInfo();
            }
        }
        return plugin_.openEditor(scale);
    }

    void Session::applyAudio(const Json& params, const std::string& where)
    {
        if (const Json* muted = params.find("muted"); muted != nullptr && ! muted->isNull())
        {
            if (! muted->isBool())
                throw Failure("invalid-request", where + ".muted must be a boolean");
            audio_.setMuted(muted->asBool());
        }
        if (const Json* volume = params.find("volume"); volume != nullptr && ! volume->isNull())
        {
            if (! volume->isNumber() || volume->asNumber() < 0 || volume->asNumber() > 1)
                throw Failure("invalid-request", where + ".volume must be from 0 to 1");
            audio_.setVolume(volume->asNumber());
        }
        const std::string input = optionalString(params, "input", where);
        const std::string file = optionalString(params, "file", where);
        if (! input.empty())
        {
            const auto parsed = parseInput(input);
            if (! parsed)
                throw Failure("invalid-request",
                              where + R"(.input must be "oscillator", "file", "microphone" or "none")");
            audio_.setInput(*parsed, file);
        }
        else if (! file.empty())
            audio_.setInput(AudioInput::file, file);
    }

    Session::~Session() = default;

    void Session::hello(size_t maxPayload)
    {
        Json params = Json::object();
        params.set("protocol", protocolVersion);
        params.set("version", hostVersion);
        params.set("sdkVersion", sdkVersion);
        params.set("platform", platformName());
        params.set("arch", hostArchitecture());
        params.set("mode", ui_ ? "ui" : "headless");
        params.set("maxPayloadBytes", static_cast<double>(maxPayload));
        emit("hello", std::move(params));
    }

    void Session::emit(const std::string& event, Json params)
    {
        Json header = Json::object();
        header.set("event", event);
        header.set("params", std::move(params));
        writer_.write(header);
    }

    void Session::respond(const Json& id, Json result, std::span<const uint8_t> payload)
    {
        Json header = Json::object();
        header.set("id", id);
        header.set("result", std::move(result));
        writer_.write(header, payload);
    }

    void Session::respondError(const Json& id, const std::string& code, const std::string& message, const Json& details)
    {
        Json error = Json::object();
        error.set("code", code);
        error.set("message", message);
        if (! details.isNull())
            error.set("details", details);
        Json header = Json::object();
        header.set("id", id);
        header.set("error", std::move(error));
        writer_.write(header);
    }

    void Session::onFrame(Frame frame)
    {
        if (closing_)
            return;
        queue_.push_back(std::move(frame));
        pump();
    }

    void Session::pump()
    {
        while (! queue_.empty() && ! plugin_.busy && ! closing_)
        {
            plugin_.applyPendingRestarts();
            Frame frame = std::move(queue_.front());
            queue_.pop_front();
            handle(frame);
        }
    }

    void Session::finish(int code)
    {
        closing_ = true;
        exitCode_ = code;
        queue_.clear();
        audio_.stop();
        plugin_.unload();
        loop_.quit();
    }

    void Session::onInputClosed()
    {
        // The client went away: stop once the current job, if any, is done.
        closing_ = true;
        if (! plugin_.busy)
            finish(0);
    }

    void Session::onProtocolError(const std::string& message)
    {
        Json params = Json::object();
        params.set("message", message);
        emit("protocolError", std::move(params));
        if (! plugin_.busy)
            finish(2);
        else
            closing_ = true;
    }

    void Session::handle(Frame& frame)
    {
        const Json& header = frame.header;
        if (! header.isObject())
        {
            Json params = Json::object();
            params.set("message", "a request header is not a JSON object");
            emit("protocolError", std::move(params));
            return;
        }
        const Json* idValue = header.find("id");
        const Json id = idValue != nullptr ? *idValue : Json();
        if (! id.isNumber())
        {
            Json params = Json::object();
            params.set("message", "a request has no numeric id");
            emit("protocolError", std::move(params));
            return;
        }
        const Json* methodValue = header.find("method");
        const Json emptyParams = Json::object();
        const Json* paramsValue = header.find("params");
        const Json& params = paramsValue != nullptr && paramsValue->isObject() ? *paramsValue : emptyParams;
        if (methodValue == nullptr || ! methodValue->isString())
        {
            respondError(id, "invalid-request", "a request needs a method");
            return;
        }
        if (paramsValue != nullptr && ! paramsValue->isObject() && ! paramsValue->isNull())
        {
            respondError(id, "invalid-request", "a request's params must be an object");
            return;
        }
        const std::string& method = methodValue->asString();
        const std::string where = method;

        try
        {
            if (method == "ping")
                respond(id, Json::object());
            else if (method == "load")
            {
                const std::string path = requireString(params, "path", where);
                const std::string className = optionalString(params, "className", where);
                const std::string classId = optionalString(params, "classId", where);
                const Setup setup = parseSetup(params, Setup {}, where);
                plugin_.load(path, className, classId, setup);
                audio_.formatChanged();
                Json result = plugin_.info();
                if (const Json* open = params.find("openEditor"); open != nullptr && open->isBool() && open->asBool())
                    result.set("editor", openEditor(params, where));
                respond(id, std::move(result));
            }
            else if (method == "info")
                respond(id, plugin_.info());
            else if (method == "getParameters")
                respond(id, plugin_.parameters());
            else if (method == "getParameter")
                respond(id, plugin_.parameter(parameterId(params, where)));
            else if (method == "setParameter")
            {
                const ParamID parameter = parameterId(params, where);
                const Json* normalized = params.find("normalized");
                const Json* plain = params.find("plain");
                const bool hasNormalized = normalized != nullptr && ! normalized->isNull();
                const bool hasPlain = plain != nullptr && ! plain->isNull();
                if (hasNormalized == hasPlain)
                    throw Failure("invalid-request", "setParameter takes either normalized or plain");
                if ((hasNormalized && ! normalized->isNumber()) || (hasPlain && ! plain->isNumber()))
                    throw Failure("invalid-request", "a parameter value must be a number");
                respond(id, plugin_.setParameter(parameter,
                                                 hasNormalized ? std::optional(normalized->asNumber()) : std::nullopt,
                                                 hasPlain ? std::optional(plain->asNumber()) : std::nullopt));
            }
            else if (method == "getLatency")
                respond(id, plugin_.latencyAndTail());
            else if (method == "process")
            {
                if (audio_.running())
                    throw Failure("invalid-state", "live audio is running: stop it (stopAudio) to process offline");
                std::shared_ptr<ProcessJob> job = plugin_.prepareProcess(params, std::move(frame.payload));
                plugin_.busy = true;
                worker_.run(
                    [this, job, id]
                    {
                        plugin_.runProcess(*job);
                        loop_.post(
                            [this, job, id]
                            {
                                plugin_.busy = false;
                                try
                                {
                                    Json result = plugin_.finishProcess(*job);
                                    respond(id, std::move(result),
                                            std::span<const uint8_t>(job->output.data(), job->output.size()));
                                }
                                catch (const Failure& failure)
                                {
                                    respondError(id, failure.code(), failure.what(), failure.details());
                                }
                                if (closing_)
                                    finish(exitCode_);
                                else
                                {
                                    plugin_.applyPendingRestarts();
                                    pump();
                                }
                            });
                    });
            }
            else if (method == "getState")
            {
                size_t componentSize = 0;
                const auto bytes = plugin_.getState(componentSize);
                Json result = Json::object();
                result.set("componentBytes", static_cast<double>(componentSize));
                result.set("controllerBytes", static_cast<double>(bytes.size() - componentSize));
                respond(id, std::move(result), bytes);
            }
            else if (method == "setState")
            {
                const Json* componentBytes = params.find("componentBytes");
                const Json* controllerBytes = params.find("controllerBytes");
                if (componentBytes == nullptr || ! componentBytes->isNumber() || controllerBytes == nullptr
                    || ! controllerBytes->isNumber() || componentBytes->asNumber() < 0
                    || controllerBytes->asNumber() < 0
                    || componentBytes->asNumber() + controllerBytes->asNumber()
                           != static_cast<double>(frame.payload.size()))
                    throw Failure("invalid-request", "setState's componentBytes and controllerBytes must add up to "
                                                     "the payload's size");
                const auto componentSize = static_cast<size_t>(componentBytes->asNumber());
                plugin_.setState(frame.payload.data(), componentSize, frame.payload.data() + componentSize,
                                 frame.payload.size() - componentSize);
                respond(id, Json::object());
            }
            else if (method == "reset")
            {
                plugin_.reset();
                respond(id, Json::object());
            }
            else if (method == "recreate")
            {
                plugin_.recreate();
                audio_.formatChanged();
                respond(id, plugin_.info());
            }
            else if (method == "configure")
            {
                // Bus requests not given keep their current arrangements.
                plugin_.configure(parseSetup(params, plugin_.setup(), where));
                audio_.formatChanged();
                respond(id, plugin_.info());
            }
            else if (method == "openEditor")
                respond(id, openEditor(params, where));
            else if (method == "startAudio")
            {
                applyAudio(params, where);
                audio_.start();
                respond(id, audio_.status());
            }
            else if (method == "stopAudio")
            {
                audio_.stop();
                respond(id, audio_.status());
            }
            else if (method == "setAudio")
            {
                applyAudio(params, where);
                respond(id, audio_.status());
            }
            else if (method == "getAudio")
                respond(id, audio_.status());
            else if (method == "getTransport")
            {
                if (! plugin_.loaded())
                    throw Failure("invalid-state", "no plugin is loaded");
                respond(id, plugin_.transportJson());
            }
            else if (method == "setTransport")
                respond(id, plugin_.setTransport(params));
            else if (method == "closeEditor")
            {
                plugin_.closeEditor();
                respond(id, plugin_.editorInfo());
            }
            else if (method == "resizeEditor")
            {
                const Json* width = params.find("width");
                const Json* height = params.find("height");
                if (width == nullptr || height == nullptr || ! width->isNumber() || ! height->isNumber())
                    throw Failure("invalid-request", "resizeEditor takes a width and a height");
                respond(id, plugin_.resizeEditor(static_cast<int>(width->asNumber()),
                                                 static_cast<int>(height->asNumber())));
            }
            else if (method == "getEditor")
                respond(id, plugin_.editorInfo());
            else if (method == "shutdown")
            {
                audio_.stop();
                plugin_.unload();
                respond(id, Json::object());
                finish(0);
            }
            else
                respondError(id, "unknown-method",
                             "\"" + method + "\" is not a method of this host (protocol "
                                 + std::to_string(protocolVersion) + ")");
        }
        catch (const Failure& failure)
        {
            respondError(id, failure.code(), failure.what(), failure.details());
        }
        catch (const std::exception& error)
        {
            respondError(id, "internal-error", error.what());
        }
    }
} // namespace soundor::vst3host
