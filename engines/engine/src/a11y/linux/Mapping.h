#pragma once

#include <soundor/a11y/Platform.h>

#include <array>
#include <cstdint>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
{
    // AT-SPI wire values, not a dependency on libatspi (which is a client).
    struct RoleInfo
    {
        std::uint32_t value;
        std::string_view name;
    };
    [[nodiscard]] RoleInfo role(Role input);
    [[nodiscard]] std::array<std::uint32_t, 2> states(const Node& node, bool focused, bool active);
    [[nodiscard]] Rect bounds(const Node& node, const Tree& tree, const ViewGeometry& geometry,
                              std::uint32_t coordinates);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
