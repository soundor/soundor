// A small JSON value for the host's control messages (protocol.json). Audio
// never passes through it: buffers travel in each frame's binary payload.
#pragma once

#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace soundor::vst3host
{
    class Json
    {
    public:
        enum class Type
        {
            Null,
            Bool,
            Number,
            String,
            Array,
            Object
        };
        using Array = std::vector<Json>;
        using Object = std::vector<std::pair<std::string, Json>>;

        Json() = default;
        Json(std::nullptr_t) {}
        Json(bool value) : type_(Type::Bool), bool_(value) {}
        Json(double value) : type_(Type::Number), number_(value) {}
        Json(int value) : type_(Type::Number), number_(value) {}
        Json(int64_t value) : type_(Type::Number), number_(static_cast<double>(value)) {}
        Json(uint32_t value) : type_(Type::Number), number_(value) {}
        Json(const char* value) : type_(Type::String), string_(value) {}
        Json(std::string value) : type_(Type::String), string_(std::move(value)) {}
        Json(Array value) : type_(Type::Array), array_(std::move(value)) {}
        Json(Object value) : type_(Type::Object), object_(std::move(value)) {}

        static Json object() { return Json(Object {}); }
        static Json array() { return Json(Array {}); }

        Type type() const { return type_; }
        bool isNull() const { return type_ == Type::Null; }
        bool isBool() const { return type_ == Type::Bool; }
        bool isNumber() const { return type_ == Type::Number; }
        bool isString() const { return type_ == Type::String; }
        bool isArray() const { return type_ == Type::Array; }
        bool isObject() const { return type_ == Type::Object; }

        bool asBool() const { return bool_; }
        double asNumber() const { return number_; }
        const std::string& asString() const { return string_; }
        const Array& asArray() const { return array_; }
        Array& asArray() { return array_; }
        const Object& asObject() const { return object_; }

        /** The member named `key`, or nullptr (also when this is not an object). */
        const Json* find(std::string_view key) const;
        /** Adds or replaces a member; this must be an object. */
        Json& set(std::string key, Json value);
        /** Appends to an array. */
        void push(Json value) { array_.push_back(std::move(value)); }

        std::string dump() const;
        static Json parse(std::string_view text);

    private:
        void dumpTo(std::string& out) const;

        Type type_ = Type::Null;
        bool bool_ = false;
        double number_ = 0;
        std::string string_;
        Array array_;
        Object object_;
    };

    struct JsonError : std::runtime_error
    {
        using std::runtime_error::runtime_error;
    };
} // namespace soundor::vst3host
