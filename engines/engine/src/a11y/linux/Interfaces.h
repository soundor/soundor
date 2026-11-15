// Protocol signatures from the official AT-SPI XML interface reference.
// https://gnome.pages.gitlab.gnome.org/at-spi2-core/devel-docs/xml-interfaces.html
#pragma once

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
{
    inline constexpr auto introspection = R"xml(<node>
<interface name="org.a11y.atspi.Accessible">
<property name="Name" type="s" access="read"/>
<property name="Description" type="s" access="read"/>
<property name="HelpText" type="s" access="read"/>
<property name="Parent" type="(so)" access="read"/>
<property name="ChildCount" type="i" access="read"/>
<property name="Locale" type="s" access="read"/>
<property name="AccessibleId" type="s" access="read"/>
<method name="GetChildAtIndex">
<arg type="i" direction="in"/>
<arg type="(so)" direction="out"/>
</method>
<method name="GetChildren">
<arg type="a(so)" direction="out"/>
</method>
<method name="GetIndexInParent">
<arg type="i" direction="out"/>
</method>
<method name="GetRelationSet">
<arg type="a(ua(so))" direction="out"/>
</method>
<method name="GetRole">
<arg type="u" direction="out"/>
</method>
<method name="GetRoleName">
<arg type="s" direction="out"/>
</method>
<method name="GetLocalizedRoleName">
<arg type="s" direction="out"/>
</method>
<method name="GetState">
<arg type="au" direction="out"/>
</method>
<method name="GetAttributes">
<arg type="a{ss}" direction="out"/>
</method>
<method name="GetApplication">
<arg type="(so)" direction="out"/>
</method>
<method name="GetInterfaces">
<arg type="as" direction="out"/>
</method>
</interface>
<interface name="org.a11y.atspi.Application">
<property name="ToolkitName" type="s" access="read"/>
<property name="Version" type="s" access="read"/>
<property name="ToolkitVersion" type="s" access="read"/>
<property name="AtspiVersion" type="s" access="read"/>
<property name="Id" type="i" access="readwrite"/>
<method name="GetLocale">
<arg type="u" direction="in"/>
<arg type="s" direction="out"/>
</method>
<method name="GetApplicationBusAddress">
<arg type="s" direction="out"/>
</method>
</interface>
<interface name="org.a11y.atspi.Component">
<method name="Contains">
<arg type="i" direction="in"/>
<arg type="i" direction="in"/>
<arg type="u" direction="in"/>
<arg type="b" direction="out"/>
</method>
<method name="GetAccessibleAtPoint">
<arg type="i" direction="in"/>
<arg type="i" direction="in"/>
<arg type="u" direction="in"/>
<arg type="(so)" direction="out"/>
</method>
<method name="GetExtents">
<arg type="u" direction="in"/>
<arg type="(iiii)" direction="out"/>
</method>
<method name="GetPosition">
<arg type="u" direction="in"/>
<arg type="i" direction="out"/>
<arg type="i" direction="out"/>
</method>
<method name="GetSize">
<arg type="i" direction="out"/>
<arg type="i" direction="out"/>
</method>
<method name="GetLayer">
<arg type="u" direction="out"/>
</method>
<method name="GetMDIZOrder">
<arg type="n" direction="out"/>
</method>
<method name="GrabFocus">
<arg type="b" direction="out"/>
</method>
<method name="GetAlpha">
<arg type="d" direction="out"/>
</method>
<method name="SetExtents">
<arg type="i" direction="in"/>
<arg type="i" direction="in"/>
<arg type="i" direction="in"/>
<arg type="i" direction="in"/>
<arg type="u" direction="in"/>
<arg type="b" direction="out"/>
</method>
<method name="SetPosition">
<arg type="i" direction="in"/>
<arg type="i" direction="in"/>
<arg type="u" direction="in"/>
<arg type="b" direction="out"/>
</method>
<method name="SetSize">
<arg type="i" direction="in"/>
<arg type="i" direction="in"/>
<arg type="b" direction="out"/>
</method>
<method name="ScrollTo">
<arg type="u" direction="in"/>
<arg type="b" direction="out"/>
</method>
<method name="ScrollToPoint">
<arg type="u" direction="in"/>
<arg type="i" direction="in"/>
<arg type="i" direction="in"/>
<arg type="b" direction="out"/>
</method>
</interface>
<interface name="org.a11y.atspi.Action">
<property name="NActions" type="i" access="read"/>
<method name="GetDescription">
<arg type="i" direction="in"/>
<arg type="s" direction="out"/>
</method>
<method name="GetName">
<arg type="i" direction="in"/>
<arg type="s" direction="out"/>
</method>
<method name="GetLocalizedName">
<arg type="i" direction="in"/>
<arg type="s" direction="out"/>
</method>
<method name="GetKeyBinding">
<arg type="i" direction="in"/>
<arg type="s" direction="out"/>
</method>
<method name="GetActions">
<arg type="a(sss)" direction="out"/>
</method>
<method name="DoAction">
<arg type="i" direction="in"/>
<arg type="b" direction="out"/>
</method>
</interface>
<interface name="org.a11y.atspi.Value">
<property name="MinimumValue" type="d" access="read"/>
<property name="MaximumValue" type="d" access="read"/>
<property name="MinimumIncrement" type="d" access="read"/>
<property name="CurrentValue" type="d" access="readwrite"/>
<property name="Text" type="s" access="read"/>
</interface>
<interface name="org.a11y.atspi.Cache">
<method name="GetItems">
<arg type="a((so)(so)(so)iiassusau)" direction="out"/>
</method>
<signal name="AddAccessible">
<arg type="((so)(so)(so)iiassusau)"/>
</signal>
<signal name="RemoveAccessible">
<arg type="(so)"/>
</signal>
</interface>
<interface name="org.a11y.atspi.Event.Object">
<signal name="PropertyChange">
<arg type="s"/>
<arg type="i"/>
<arg type="i"/>
<arg type="v"/>
<arg type="a{sv}"/>
</signal>
<signal name="BoundsChanged">
<arg type="s"/>
<arg type="i"/>
<arg type="i"/>
<arg type="v"/>
<arg type="a{sv}"/>
</signal>
<signal name="StateChanged">
<arg type="s"/>
<arg type="i"/>
<arg type="i"/>
<arg type="v"/>
<arg type="a{sv}"/>
</signal>
<signal name="ChildrenChanged">
<arg type="s"/>
<arg type="i"/>
<arg type="i"/>
<arg type="v"/>
<arg type="a{sv}"/>
</signal>
<signal name="VisibleDataChanged">
<arg type="s"/>
<arg type="i"/>
<arg type="i"/>
<arg type="v"/>
<arg type="a{sv}"/>
</signal>
</interface>
<interface name="org.a11y.atspi.Event.Window">
<signal name="Activate">
<arg type="s"/>
<arg type="i"/>
<arg type="i"/>
<arg type="v"/>
<arg type="a{sv}"/>
</signal>
<signal name="Deactivate">
<arg type="s"/>
<arg type="i"/>
<arg type="i"/>
<arg type="v"/>
<arg type="a{sv}"/>
</signal>
</interface>
</node>)xml";
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
