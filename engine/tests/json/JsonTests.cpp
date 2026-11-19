#include <soundor/json/Json.h>

#include <doctest/doctest.h>

#include <clocale>
#include <string>

using namespace soundor;

TEST_CASE("JSON: strict parsing, member order, numbers as written")
{
    const auto value = json::parse(R"({"b":1,"a":[true,null,"x\u00e9\ud83d\ude00"],"n":18446744073709551615})");
    CHECK(json::write(value) == "{\"b\":1,\"a\":[true,null,\"x\xc3\xa9\xf0\x9f\x98\x80\"],\"n\":18446744073709551615}");
    CHECK(value.at("n").asUint64() == 18446744073709551615ULL);
    CHECK_THROWS_AS(static_cast<void>(json::parse("[1,]")), json::Error);
    CHECK_THROWS_AS(static_cast<void>(json::parse("{\"a\":1,\"a\":2}")), json::Error);
    CHECK_THROWS_AS(static_cast<void>(json::parse("\"\\ud800\"")), json::Error);
    CHECK_THROWS_AS(static_cast<void>(json::parse(std::string(70, '[') + std::string(70, ']'))), json::Error);
    CHECK_THROWS_AS(static_cast<void>(json::parse("\"\xff\"")), json::Error);
    CHECK(json::quote("a\"\n\x01") == "\"a\\\"\\n\\u0001\"");
}

TEST_CASE("JSON: numbers written as JavaScript writes them")
{
    CHECK(json::formatNumber(0.1) == "0.1");
    CHECK(json::formatNumber(-0.0) == "0");
    CHECK(json::formatNumber(100) == "100");
    CHECK(json::formatNumber(1e21) == "1e+21");
    CHECK(json::formatNumber(123456789012345680000.0) == "123456789012345680000");
    CHECK(json::formatNumber(1e-7) == "1e-7");
    CHECK(json::formatNumber(0.000001) == "0.000001");
    CHECK(json::formatNumber(5e-324) == "5e-324");
    CHECK(json::formatNumber(static_cast<double>(0.1f)) == "0.10000000149011612");
    CHECK(json::parse("2.5e-3").asNumber() == 0.0025);
    CHECK(json::parse("5e-324").asNumber() == 5e-324);
    CHECK_THROWS_AS(static_cast<void>(json::parse("1e999").asNumber()), json::Error);
}

TEST_CASE("JSON: numbers whatever the decimal point of the host's locale")
{
    // Hosts may set a locale whose decimal point is a comma.
    const std::string previous = std::setlocale(LC_NUMERIC, nullptr); // NOLINT(concurrency-mt-unsafe)
    bool comma = false;
    for (const char* name : { "de_DE.UTF-8", "de_DE.utf8", "fr_FR.UTF-8", "German_Germany.1252" })
        if (std::setlocale(LC_NUMERIC, name) != nullptr) // NOLINT(concurrency-mt-unsafe)
        {
            comma = true;
            break;
        }
    if (! comma)
        MESSAGE("no locale with a decimal comma here: checked in the C locale only");
    CHECK(json::formatNumber(0.5) == "0.5");
    CHECK(json::formatNumber(1234.5678) == "1234.5678");
    CHECK(json::parse("0.25").asNumber() == 0.25);
    CHECK(json::write(json::Value::number(-1.5)) == "-1.5");
    std::setlocale(LC_NUMERIC, previous.c_str()); // NOLINT(concurrency-mt-unsafe)
}
