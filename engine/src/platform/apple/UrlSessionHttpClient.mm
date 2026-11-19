// systemHttpClient() on macOS and iOS: NSURLSession, the system's HTTP stack
// (HTTP/2, and HTTP/3 where the system uses it), with the system's proxies
// and certificates.
//
// Ephemeral sessions: no cookies, cache or credentials are kept, or shared
// with the host. A request that must not follow redirects goes through a
// session whose delegate refuses them; its class is made at run time
// (platform/apple/RuntimeClass.h), as Soundor declares no Objective-C class.

#include "platform/Http.h"
#include "platform/apple/RuntimeClass.h"

#import <Foundation/Foundation.h>

#include <array>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    namespace
    {
        NSString* string(const std::string& text)
        {
            return [[NSString alloc] initWithBytes:text.data() length:text.size() encoding:NSUTF8StringEncoding];
        }

        std::string utf8(NSString* text)
        {
            const char* bytes = text != nil ? text.UTF8String : nullptr;
            return bytes != nullptr ? std::string(bytes) : std::string();
        }

        // The delegate of the sessions that return redirects as responses.
        Class refusingRedirects()
        {
            static Class registered = []
            {
                const SEL selector = @selector(URLSession:
                                                     task:willPerformHTTPRedirection:newRequest:completionHandler:);
                const char* encoding =
                    protocol_getMethodDescription(@protocol(NSURLSessionTaskDelegate), selector, NO, YES).types;
                const std::array methods {
                    platform::apple::Method {
                        selector,
                        reinterpret_cast<IMP>(+[](id, SEL, NSURLSession*, NSURLSessionTask*, NSHTTPURLResponse*,
                                                  NSURLRequest*, void (^completion)(NSURLRequest*))
                                              { completion(nil); }),
                        encoding },
                };
                return platform::apple::makeRuntimeClass("SoundorHttpRedirects", [NSObject class], methods,
                                                         @protocol(NSURLSessionTaskDelegate));
            }();
            return registered;
        }

        class UrlSessionHttpClient final : public HttpClient
        {
        public:
            UrlSessionHttpClient() : watcher([this] { watch(); }) {}

            ~UrlSessionHttpClient() override
            {
                {
                    std::lock_guard lock(mutex);
                    stopping = true;
                }
                wake.notify_all();
                watcher.join();
                std::vector<NSURLSessionTask*> tasks;
                {
                    std::lock_guard lock(mutex);
                    for (auto& entry : active)
                        tasks.push_back(entry.task);
                }
                // Each completes with NSURLErrorCancelled ("aborted").
                for (NSURLSessionTask* task : tasks)
                    [task cancel];
                std::unique_lock lock(mutex);
                done.wait(lock, [&] { return active.empty(); });
                for (NSURLSession* session : sessions)
                    [session invalidateAndCancel];
            }

            UrlSessionHttpClient(const UrlSessionHttpClient&) = delete;
            UrlSessionHttpClient& operator=(const UrlSessionHttpClient&) = delete;
            UrlSessionHttpClient(UrlSessionHttpClient&&) = delete;
            UrlSessionHttpClient& operator=(UrlSessionHttpClient&&) = delete;

            void send(HttpRequest request, std::shared_ptr<const CancellationToken> cancellation,
                      Completion complete) override
            {
                @autoreleasepool
                {
                    NSURL* url = [NSURL URLWithString:string(request.url)];
                    if (url == nil || url.scheme == nil
                        || ! ([url.scheme isEqualToString:@"http"] || [url.scheme isEqualToString:@"https"]))
                    {
                        complete("invalid URL " + request.url);
                        return;
                    }
                    NSMutableURLRequest* native = [NSMutableURLRequest requestWithURL:url];
                    native.HTTPMethod = string(request.method);
                    native.HTTPShouldHandleCookies = NO;
                    // Without a limit, no timeout: a long poll waits.
                    native.timeoutInterval =
                        request.timeoutMs != 0 ? static_cast<double>(request.timeoutMs) / 1000.0 : 31536000.0;
                    for (const auto& [name, value] : request.headers)
                        [native addValue:string(value) forHTTPHeaderField:string(name)];
                    if (! request.body.empty())
                    {
                        // NSURLSession otherwise labels a POST body as form data.
                        if (! http::hasHeader(request.headers, "Content-Type"))
                            [native setValue:@"application/octet-stream" forHTTPHeaderField:@"Content-Type"];
                        native.HTTPBody = [NSData dataWithBytes:request.body.data() length:request.body.size()];
                    }

                    std::unique_lock lock(mutex);
                    if (stopping)
                    {
                        lock.unlock();
                        complete(std::string("aborted"));
                        return;
                    }
                    const auto key = ++nextId;
                    NSURLSession* session = sessionFor(request.proxy, request.followRedirects);
                    const std::string requested = request.url;
                    auto shared = std::make_shared<Completion>(std::move(complete));
                    NSURLSessionDataTask* task =
                        [session dataTaskWithRequest:native
                                   completionHandler:^(NSData* data, NSURLResponse* response, NSError* error) {
                                     finish(key, *shared, requested, data, response, error);
                                   }];
                    active.push_back({ key, task, std::move(cancellation) });
                    lock.unlock();
                    [task resume];
                }
            }

        private:
            struct Entry
            {
                std::uint64_t key = 0;
                NSURLSessionTask* task = nil;
                std::shared_ptr<const CancellationToken> cancellation;
            };

            // One session per kind of request, made when first needed.
            NSURLSession* sessionFor(bool proxy, bool follow)
            {
                const std::size_t index = (proxy ? 0 : 1) + (follow ? 0 : 2);
                if (sessions[index] == nil)
                {
                    NSURLSessionConfiguration* configuration =
                        [NSURLSessionConfiguration ephemeralSessionConfiguration];
                    configuration.URLCache = nil;
                    configuration.HTTPCookieStorage = nil;
                    configuration.URLCredentialStorage = nil;
                    configuration.timeoutIntervalForResource = 31536000.0;
                    if (! proxy)
                        configuration.connectionProxyDictionary = @ {};
                    id delegate = follow ? nil : [[refusingRedirects() alloc] init];
                    sessions[index] = [NSURLSession sessionWithConfiguration:configuration
                                                                    delegate:delegate
                                                               delegateQueue:nil];
                }
                return sessions[index];
            }

            void finish(std::uint64_t key, Completion& complete, const std::string& requested, NSData* data,
                        NSURLResponse* response, NSError* error)
            {
                bool cancelled = false;
                {
                    std::lock_guard lock(mutex);
                    for (auto it = active.begin(); it != active.end(); ++it)
                        if (it->key == key)
                        {
                            cancelled = stopping || (it->cancellation && it->cancellation->isCancelled());
                            active.erase(it);
                            break;
                        }
                    done.notify_all();
                }
                if (cancelled || (error != nil && error.code == NSURLErrorCancelled))
                {
                    complete(std::string("aborted"));
                    return;
                }
                if (error != nil)
                {
                    complete(utf8(error.localizedDescription));
                    return;
                }
                auto* http = [response isKindOfClass:[NSHTTPURLResponse class]] ? (NSHTTPURLResponse*)response : nil;
                if (http == nil)
                {
                    complete(std::string("not an HTTP response"));
                    return;
                }
                HttpResponse out;
                out.status = static_cast<int>(http.statusCode);
                out.statusText = std::string(http::reasonPhrase(out.status));
                out.url = http.URL != nil ? utf8(http.URL.absoluteString) : requested;
                for (NSString* name in http.allHeaderFields)
                {
                    id value = http.allHeaderFields[name];
                    if ([value isKindOfClass:[NSString class]])
                        out.headers.push_back({ utf8(name), utf8((NSString*)value) });
                }
                if (data.length != 0)
                {
                    const auto* bytes = static_cast<const std::uint8_t*>(data.bytes);
                    out.body.assign(bytes, bytes + data.length);
                }
                complete(std::move(out));
            }

            // Cancels tasks whose request was cancelled, within 50 ms.
            void watch()
            {
                std::unique_lock lock(mutex);
                while (! stopping)
                {
                    wake.wait_for(lock, std::chrono::milliseconds(50));
                    std::vector<NSURLSessionTask*> cancelled;
                    for (auto& entry : active)
                        if (entry.cancellation && entry.cancellation->isCancelled() && entry.task != nil)
                        {
                            cancelled.push_back(entry.task);
                            entry.task = nil;
                        }
                    lock.unlock();
                    for (NSURLSessionTask* task : cancelled)
                        [task cancel];
                    lock.lock();
                }
            }

            std::mutex mutex;
            std::condition_variable wake;
            std::condition_variable done;
            std::vector<Entry> active;
            std::array<NSURLSession*, 4> sessions {};
            std::uint64_t nextId = 0;
            bool stopping = false;
            std::thread watcher;
        };
    } // namespace

    std::shared_ptr<HttpClient> systemHttpClient()
    {
        return std::make_shared<UrlSessionHttpClient>();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
