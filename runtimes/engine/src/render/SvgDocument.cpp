#include "SvgDocument.h"

// Expat shares Skia's private static archive and symbol prefix. Never use a
// system Expat here: a plugin host may carry a different version of it.
#include "../../cmake/skia/SoundorSkiaPrefix.h"
#define XML_STATIC
#include <expat/expat.h>
#include <include/core/SkStream.h>

#include <algorithm>
#include <charconv>
#include <cmath>
#include <limits>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    namespace
    {
        constexpr std::size_t maxBytes = std::size_t { 1024 } * 1024;
        constexpr std::size_t maxNodes = 4096;
        constexpr std::size_t maxDepth = 64;
        constexpr std::size_t maxWork = 262144;
        constexpr std::size_t maxNumbers = 65536;

        struct Element
        {
            std::vector<std::size_t> edges;
            std::vector<std::string> references;
            std::size_t work = 0;
            std::size_t height = 0;
            std::size_t cost = 1;
            bool visiting = false;
        };

        struct Validator
        {
            XML_Parser parser;
            std::vector<Element> elements;
            std::vector<std::size_t> parents;
            std::unordered_map<std::string, std::size_t> ids;
            std::size_t numbers = 0;
            bool valid = true;

            void fail()
            {
                valid = false;
                XML_StopParser(parser, XML_FALSE);
            }

            // Bound geometry without implementing SVG's path grammar. Skia
            // remains responsible for syntax and commands, including arcs.
            bool geometry(std::string_view value)
            {
                while (! value.empty())
                {
                    const char first = value.front();
                    const auto lower = [](char c) { return c >= 'A' && c <= 'Z' ? c + ('a' - 'A') : c; };
                    // Skia's scalar reader uses strtod, which also accepts
                    // non-SVG NaN/Infinity and hexadecimal floats. Reject them
                    // before they can bypass the finite decimal budget.
                    if ((value.size() >= 3
                         && ((lower(value[0]) == 'n' && lower(value[1]) == 'a' && lower(value[2]) == 'n')
                             || (lower(value[0]) == 'i' && lower(value[1]) == 'n' && lower(value[2]) == 'f')))
                        || (value.size() >= 2 && first == '0' && lower(value[1]) == 'x'))
                        return false;
                    if ((first >= '0' && first <= '9') || first == '-' || first == '+' || first == '.')
                    {
                        if (first == '+')
                            value.remove_prefix(1);
                        float number = 0;
                        const auto parsed = std::from_chars(value.data(), value.data() + value.size(), number);
                        if (parsed.ec != std::errc() || ! std::isfinite(number) || std::abs(number) > 1000000
                            || ++numbers > maxNumbers)
                            return false;
                        value.remove_prefix(static_cast<std::size_t>(parsed.ptr - value.data()));
                    }
                    else
                        value.remove_prefix(1);
                }
                return true;
            }

            static void XMLCALL start(void* data, const char* tag, const char** attributes)
            {
                auto& self = *static_cast<Validator*>(data);
                if (! self.valid)
                    return;
                // Filters can allocate intermediate surfaces unrelated to the
                // output viewport. Enable only with a separate resource budget.
                if (std::string_view(tag) == "filter" || self.elements.size() >= maxNodes
                    || self.parents.size() >= maxDepth)
                {
                    self.fail();
                    return;
                }
                const auto id = self.elements.size();
                self.elements.emplace_back();
                if (! self.parents.empty())
                    self.elements[self.parents.back()].edges.push_back(id);
                self.parents.push_back(id);
                std::size_t count = 0;
                for (const char** attr = attributes; *attr != nullptr; attr += 2)
                {
                    const auto previousNumbers = self.numbers;
                    const std::string_view name(attr[0]);
                    const std::string_view value(attr[1]);
                    if (++count > 64 || value.size() > 262144)
                    {
                        self.fail();
                        return;
                    }
                    if (name == "id")
                    {
                        if (value.find_first_of(" \t\r\n") != std::string_view::npos
                            || ! self.ids.emplace(value, id).second)
                        {
                            self.fail();
                            return;
                        }
                    }
                    else if (name == "href" || name == "xlink:href")
                    {
                        auto ref = value;
                        while (! ref.empty()
                               && (ref.front() == ' ' || ref.front() == '\t' || ref.front() == '\r'
                                   || ref.front() == '\n'))
                            ref.remove_prefix(1);
                        if (ref.starts_with('#'))
                            self.elements[id].references.emplace_back(ref.substr(1));
                    }
                    // Paint servers, clips and style attributes may reference
                    // other nodes. Include them in the cycle/expansion budget.
                    for (std::size_t pos = 0; (pos = value.find("url", pos)) != std::string_view::npos;)
                    {
                        pos += 3;
                        while (pos < value.size()
                               && (value[pos] == ' ' || value[pos] == '\t' || value[pos] == '\r' || value[pos] == '\n'))
                            ++pos;
                        if (pos == value.size() || value[pos] != '(')
                            continue;
                        ++pos;
                        const auto end = value.find(')', pos);
                        if (end == std::string_view::npos)
                            break;
                        auto ref = value.substr(pos, end - pos);
                        while (! ref.empty()
                               && (ref.front() == ' ' || ref.front() == '\t' || ref.front() == '\r'
                                   || ref.front() == '\n' || ref.front() == '\'' || ref.front() == '"'))
                            ref.remove_prefix(1);
                        while (! ref.empty() && (ref.back() == ' ' || ref.back() == '\'' || ref.back() == '"'))
                            ref.remove_suffix(1);
                        if (ref.starts_with('#'))
                            self.elements[id].references.emplace_back(ref.substr(1));
                        pos = end + 1;
                    }
                    if (self.elements[id].references.size() > 64)
                    {
                        self.fail();
                        return;
                    }
                    constexpr std::string_view geometryNames[] = { "d",
                                                                   "points",
                                                                   "transform",
                                                                   "viewBox",
                                                                   "x",
                                                                   "y",
                                                                   "width",
                                                                   "height",
                                                                   "cx",
                                                                   "cy",
                                                                   "r",
                                                                   "rx",
                                                                   "ry",
                                                                   "x1",
                                                                   "x2",
                                                                   "y1",
                                                                   "y2",
                                                                   "stroke-width",
                                                                   "stroke-dasharray",
                                                                   "stroke-dashoffset",
                                                                   "gradientTransform" };
                    if (std::find(std::begin(geometryNames), std::end(geometryNames), name) != std::end(geometryNames)
                        && ! self.geometry(value))
                    {
                        self.fail();
                        return;
                    }
                    self.elements[id].cost += self.numbers - previousNumbers;
                }
            }

            static void XMLCALL end(void* data, const char*)
            {
                auto& self = *static_cast<Validator*>(data);
                if (! self.parents.empty())
                    self.parents.pop_back();
            }

            static void XMLCALL doctype(void* data, const char*, const char*, const char*, int)
            {
                static_cast<Validator*>(data)->fail();
            }

            bool budget(std::size_t id, std::size_t depth)
            {
                auto& element = elements[id];
                if (element.visiting || depth > maxDepth)
                    return false;
                if (element.work != 0)
                    return depth + element.height <= maxDepth;
                element.visiting = true;
                std::size_t work = element.cost;
                std::size_t height = 0;
                for (auto child : element.edges)
                {
                    if (! budget(child, depth + 1))
                        return false;
                    work += elements[child].work;
                    height = std::max(height, elements[child].height + 1);
                    if (work > maxWork || depth + height > maxDepth)
                        return false;
                }
                element.visiting = false;
                element.work = work;
                element.height = height;
                return true;
            }

            bool validate(std::span<const std::uint8_t> bytes)
            {
                XML_SetUserData(parser, this);
                XML_SetElementHandler(parser, start, end);
                XML_SetStartDoctypeDeclHandler(parser, doctype);
                // No entity declarations (DOCTYPE is rejected), parameter
                // entities or external entity handlers, and no resource loader.
                XML_SetParamEntityParsing(parser, XML_PARAM_ENTITY_PARSING_NEVER);
                if (XML_Parse(parser, reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()),
                              XML_TRUE)
                        != XML_STATUS_OK
                    || ! valid || elements.empty())
                    return false;
                for (auto& element : elements)
                    for (const auto& reference : element.references)
                        if (const auto found = ids.find(reference); found != ids.end())
                            element.edges.push_back(found->second);
                // Validate disconnected definitions as well as visible nodes.
                for (std::size_t i = 0; i < elements.size(); ++i)
                    if (! budget(i, 0))
                        return false;
                return true;
            }
        };
    } // namespace

    sk_sp<SkSVGDOM> parseSvgDocument(std::span<const std::uint8_t> bytes)
    {
        if (bytes.empty() || bytes.size() > maxBytes)
            return nullptr;
        const std::unique_ptr<std::remove_pointer_t<XML_Parser>, decltype(&XML_ParserFree)> parser(
            XML_ParserCreate(nullptr), XML_ParserFree);
        if (! parser)
            return nullptr;
        Validator validator { parser.get(), {}, {}, {} };
        if (! validator.validate(bytes))
            return nullptr;
        SkMemoryStream stream(bytes.data(), bytes.size());
        // Skia's default provider returns null for every resource request,
        // including file, network, data URLs, embedded images and fonts.
        return SkSVGDOM::Builder().make(stream);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
