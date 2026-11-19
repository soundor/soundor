// systemHttpClient(): the system's HTTP stack against a real server on
// localhost (plain HTTP: TLS is the system's, and tested by it).

#include <soundor/platform/Platform.h>

#include <doctest/doctest.h>

#if defined(_WIN32)
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #include <winsock2.h>
    #include <ws2tcpip.h>
using Socket = SOCKET;
constexpr Socket noSocket = INVALID_SOCKET;
#else
    #include <arpa/inet.h>
    #include <netinet/in.h>
    #include <sys/socket.h>
    #include <unistd.h>
using Socket = int;
constexpr Socket noSocket = -1;
#endif

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cstdlib>
#include <functional>
#include <future>
#include <memory>
#include <string>
#include <thread>
#include <utility>
#include <variant>
#include <vector>

using namespace soundor;

namespace
{
    void sendAll(Socket socket, const std::string& data)
    {
#if defined(_WIN32)
        ::send(socket, data.data(), static_cast<int>(data.size()), 0);
#else
        ::send(socket, data.data(), data.size(), 0);
#endif
    }

    void closeSocket(Socket socket)
    {
#if defined(_WIN32)
        closesocket(socket);
#else
        close(socket);
#endif
    }

    // Serves HTTP/1.1 on 127.0.0.1, one connection at a time: `reply` makes
    // each response from its request (headers and body as received).
    class Server
    {
    public:
        using Reply = std::function<std::string(const std::string& request)>;

        explicit Server(Reply replying) : reply(std::move(replying))
        {
#if defined(_WIN32)
            WSADATA data {};
            WSAStartup(MAKEWORD(2, 2), &data);
#endif
            listener = socket(AF_INET, SOCK_STREAM, 0);
            REQUIRE(listener != noSocket);
            sockaddr_in address {};
            address.sin_family = AF_INET;
            address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
            address.sin_port = 0;
            REQUIRE(bind(listener, reinterpret_cast<sockaddr*>(&address), sizeof address) == 0);
            REQUIRE(listen(listener, 8) == 0);
            socklen_t length = sizeof address;
            REQUIRE(getsockname(listener, reinterpret_cast<sockaddr*>(&address), &length) == 0);
            port = ntohs(address.sin_port);
            thread = std::thread([this] { serve(); });
        }
        ~Server()
        {
            stopping = true;
            // Unblocks accept() (closing alone does not, on Linux).
#if defined(_WIN32)
            shutdown(listener, SD_BOTH);
#else
            shutdown(listener, SHUT_RDWR);
#endif
            closeSocket(listener);
            if (thread.joinable())
                thread.join();
#if defined(_WIN32)
            WSACleanup();
#endif
        }
        Server(const Server&) = delete;
        Server& operator=(const Server&) = delete;
        Server(Server&&) = delete;
        Server& operator=(Server&&) = delete;

        [[nodiscard]] std::string url(const std::string& path) const
        {
            return "http://127.0.0.1:" + std::to_string(port) + path;
        }

        std::vector<std::string> requests;

    private:
        void serve()
        {
            while (! stopping)
            {
                const Socket client = accept(listener, nullptr, nullptr);
                if (client == noSocket)
                    return;
                std::string request;
                char buffer[4096];
                std::size_t expected = std::string::npos;
                for (;;)
                {
                    const auto read = recv(client, buffer, sizeof buffer, 0);
                    if (read <= 0)
                        break;
                    request.append(buffer, static_cast<std::size_t>(read));
                    const auto end = request.find("\r\n\r\n");
                    if (end == std::string::npos)
                        continue;
                    if (expected == std::string::npos)
                    {
                        expected = end + 4;
                        std::string lower = request.substr(0, end);
                        for (auto& c : lower)
                            c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                        if (const auto at = lower.find("content-length:"); at != std::string::npos)
                            expected += std::strtoul(lower.c_str() + at + 15, nullptr, 10);
                    }
                    if (request.size() >= expected)
                        break;
                }
                requests.push_back(request);
                const std::string response = reply(request);
                if (! response.empty())
                    sendAll(client, response);
                else
                    // No answer: the connection stays until the client goes.
                    while (! stopping && recv(client, buffer, sizeof buffer, 0) > 0)
                    {
                    }
                closeSocket(client);
            }
        }

        Reply reply;
        Socket listener = noSocket;
        unsigned short port = 0;
        std::atomic<bool> stopping { false };
        std::thread thread;
    };

    platform::HttpClient::Result send(platform::HttpClient& client, platform::HttpRequest request,
                                      std::shared_ptr<platform::CancellationToken> token = nullptr)
    {
        if (! token)
            token = std::make_shared<platform::CancellationToken>();
        auto promise = std::make_shared<std::promise<platform::HttpClient::Result>>();
        auto result = promise->get_future();
        client.send(std::move(request), token,
                    [promise](platform::HttpClient::Result value) { promise->set_value(std::move(value)); });
        REQUIRE(result.wait_for(std::chrono::seconds(20)) == std::future_status::ready);
        return result.get();
    }

    std::string header(const platform::HttpResponse& response, const std::string& name)
    {
        for (const auto& field : response.headers)
            if (field.name.size() == name.size()
                && std::equal(field.name.begin(), field.name.end(), name.begin(),
                              [](char a, char b) { return std::tolower(a) == std::tolower(b); }))
                return field.value;
        return {};
    }

    std::string lowercase(std::string text)
    {
        for (auto& c : text)
            c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        return text;
    }
} // namespace

TEST_CASE("systemHttpClient: a request and its response, as the server sent them")
{
    Server server(
        [](const std::string&)
        {
            return "HTTP/1.1 201 Made It\r\nContent-Type: application/json\r\nX-Reply: yes\r\n"
                   "Content-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}";
        });
    auto client = platform::systemHttpClient();
    platform::HttpRequest request;
    request.method = "POST";
    request.url = server.url("/presets?x=1");
    request.headers = { { "x-token", "abc" } };
    const std::string payload = "payload";
    request.body.assign(payload.begin(), payload.end());
    const auto result = send(*client, request);
    const auto* response = std::get_if<platform::HttpResponse>(&result);
    if (response == nullptr)
        FAIL(std::get<std::string>(result));
    CHECK(response->status == 201);
    CHECK(response->statusText == "Made It");
    CHECK(response->url == request.url);
    CHECK(header(*response, "X-Reply") == "yes");
    CHECK(std::string(response->body.begin(), response->body.end()) == "{\"ok\":true}");
    REQUIRE(server.requests.size() == 1);
    const auto& received = server.requests.front();
    INFO(received);
    CHECK(received.starts_with("POST /presets?x=1 HTTP/1.1\r\n"));
    CHECK(lowercase(received).find("x-token: abc\r\n") != std::string::npos);
    CHECK(received.ends_with("\r\n\r\npayload"));
    // No form content type the client chose, and no 100-continue wait.
    CHECK(lowercase(received).find("x-www-form-urlencoded") == std::string::npos);
}

TEST_CASE("systemHttpClient: redirects followed, or returned")
{
    Server server(
        [](const std::string& request)
        {
            if (request.starts_with("GET /old "))
                return std::string("HTTP/1.1 302 Found\r\nLocation: /new\r\nContent-Length: 0\r\nConnection: "
                                   "close\r\n\r\n");
            return std::string("HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nnew");
        });
    auto client = platform::systemHttpClient();
    platform::HttpRequest request;
    request.method = "GET";
    request.url = server.url("/old");

    const auto followed = send(*client, request);
    REQUIRE(std::holds_alternative<platform::HttpResponse>(followed));
    const auto& last = std::get<platform::HttpResponse>(followed);
    CHECK(last.status == 200);
    CHECK(last.url == server.url("/new"));
    CHECK(std::string(last.body.begin(), last.body.end()) == "new");

    request.followRedirects = false;
    const auto returned = send(*client, request);
    REQUIRE(std::holds_alternative<platform::HttpResponse>(returned));
    CHECK(std::get<platform::HttpResponse>(returned).status == 302);
    CHECK(header(std::get<platform::HttpResponse>(returned), "Location") == "/new");
}

TEST_CASE("systemHttpClient: a cancelled request stops, and completes as aborted")
{
    Server server([](const std::string&) { return std::string(); }); // never answers
    auto client = platform::systemHttpClient();
    platform::HttpRequest request;
    request.method = "GET";
    request.url = server.url("/poll");
    auto token = std::make_shared<platform::CancellationToken>();
    auto promise = std::make_shared<std::promise<platform::HttpClient::Result>>();
    auto result = promise->get_future();
    client->send(request, token,
                 [promise](platform::HttpClient::Result value) { promise->set_value(std::move(value)); });
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    CHECK(result.wait_for(std::chrono::milliseconds(0)) == std::future_status::timeout);
    const auto cancelled = std::chrono::steady_clock::now();
    token->cancel();
    REQUIRE(result.wait_for(std::chrono::seconds(5)) == std::future_status::ready);
    CHECK(std::chrono::steady_clock::now() - cancelled < std::chrono::seconds(2));
    const auto value = result.get();
    REQUIRE(std::holds_alternative<std::string>(value));
    CHECK(std::get<std::string>(value) == "aborted");
}

TEST_CASE("systemHttpClient: destroying the client completes its requests")
{
    Server server([](const std::string&) { return std::string(); });
    auto client = platform::systemHttpClient();
    platform::HttpRequest request;
    request.method = "GET";
    request.url = server.url("/poll");
    auto promise = std::make_shared<std::promise<platform::HttpClient::Result>>();
    auto result = promise->get_future();
    client->send(request, std::make_shared<platform::CancellationToken>(),
                 [promise](platform::HttpClient::Result value) { promise->set_value(std::move(value)); });
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    client.reset();
    REQUIRE(result.wait_for(std::chrono::seconds(5)) == std::future_status::ready);
    const auto value = result.get();
    REQUIRE(std::holds_alternative<std::string>(value));
    CHECK(std::get<std::string>(value) == "aborted");
}

TEST_CASE("systemHttpClient: errors are messages")
{
    auto client = platform::systemHttpClient();
    platform::HttpRequest request;
    request.method = "GET";
    // Nothing listens on port 1.
    request.url = "http://127.0.0.1:1/";
    request.connectTimeoutMs = 5000;
    const auto unreachable = send(*client, request);
    REQUIRE(std::holds_alternative<std::string>(unreachable));
    CHECK_FALSE(std::get<std::string>(unreachable).empty());

    request.url = "file:///etc/passwd";
    const auto other = send(*client, request);
    REQUIRE(std::holds_alternative<std::string>(other));
}

#if defined(__linux__)
TEST_CASE("systemHttpClient: proxy: false goes direct, whatever the environment names")
{
    Server server([](const std::string&)
                  { return std::string("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n"); });
    // A proxy that is not there: a request through it fails.
    const char* previous = std::getenv("http_proxy"); // NOLINT(concurrency-mt-unsafe)
    const std::string saved = previous != nullptr ? previous : "";
    setenv("http_proxy", "http://127.0.0.1:1", 1); // NOLINT(concurrency-mt-unsafe)
    auto client = platform::systemHttpClient();
    platform::HttpRequest request;
    request.method = "GET";
    request.url = server.url("/");
    request.proxy = false;
    const auto direct = send(*client, request);
    request.proxy = true;
    const auto proxied = send(*client, request);
    if (previous != nullptr)
        setenv("http_proxy", saved.c_str(), 1); // NOLINT(concurrency-mt-unsafe)
    else
        unsetenv("http_proxy"); // NOLINT(concurrency-mt-unsafe)
    REQUIRE(std::holds_alternative<platform::HttpResponse>(direct));
    CHECK(std::get<platform::HttpResponse>(direct).status == 204);
    CHECK(std::holds_alternative<std::string>(proxied));
}
#endif
