#include "../web/WebTestSupport.h"

#include <soundor/a11y/SurfaceSemantics.h>

using namespace soundor;
using test::WebFixture;

namespace
{
    constexpr const char* setup = R"(
        import {root,createSvg,createView} from 'soundor:ui';
        const g=globalThis;
        g.svg=createSvg({position:'absolute',width:'50%',height:40});
        g.snapshot={version:1,viewBox:[0,0,20,20],children:[{type:'path',d:'M2 2h16v16H2z'}]};
        svg.setSvgScene(snapshot); root.appendChild(svg);
        g.other=createView({position:'absolute',left:80,top:80,width:10,height:10,backgroundColor:'red'});
        root.appendChild(other);
    )";
}

TEST_SUITE("soundor:ui SVG")
{
    TEST_CASE("layout and physical-scale changes reuse paths, and idle/unrelated frames do not walk the scene")
    {
        WebFixture f;
        f.host.surface().setSize({ 100, 100 });
        f.run(setup);
        (void)f.host.frame();
        CHECK(f.eval("svg.type").asString() == "svg");
        CHECK(f.eval("svg.children.length").asNumber() == 0);
        CHECK(f.eval("svg.layout.width").asNumber() == 50);
        auto& surface = f.host.surface();
        const auto draws = surface.statistics().svgDraws;
        CHECK(f.host.frame().statistics.pixelsRasterized == 0);
        f.run("other.style.backgroundColor='blue';");
        CHECK(f.host.frame().statistics.pixelsRasterized > 0);
        CHECK(surface.statistics().svgDraws == draws);
        surface.setSize({ 200, 100 });
        (void)f.host.frame();
        CHECK(f.eval("svg.layout.width").asNumber() == 100);
        for (const float scale : { 0.5f, 1.0f, 1.5f, 2.0f, 3.0f, 4.0f })
        {
            surface.setScale(scale);
            CHECK(f.host.frame().width == static_cast<int>(200 * scale));
            CHECK(f.eval("svg.layout.width").asNumber() == 100);
        }
        CHECK(surface.statistics().svgPathParses == 1);
        const auto before = surface.statistics().svgSceneUpdates;
        f.run("snapshot.presentation={fill:'blue'};svg.setSvgScene(snapshot);");
        CHECK(surface.statistics().svgSceneUpdates == before + 1);
        CHECK(surface.statistics().svgPathParses == 1);
        (void)f.host.frame();
        const auto layouts = surface.statistics().layoutPasses;
        f.run("snapshot.presentation.fill='red';svg.setSvgScene(snapshot);");
        (void)f.host.frame();
        CHECK(surface.statistics().layoutPasses == layouts);
        f.run("svg.setSvgScene(null);svg.remove();");
        CHECK(f.eval("svg.isConnected").asBoolean() == false);
    }

    TEST_CASE("invalid JS snapshots never replace a valid scene")
    {
        WebFixture f;
        f.host.surface().setSize({ 100, 100 });
        f.run(setup);
        const auto svg = f.host.surface().root().children().front()->id();
        const auto good = *f.host.surface().find(svg)->svgScene();
        for (const auto* data :
             { "{version:2,children:[]}", "{version:1,viewBox:[0,0,NaN,1],children:[]}",
               "{version:1,children:[{type:'script'}]}", "{version:1,children:[{type:'path',d:'M0 0 L'}]}",
               "{version:1,children:[{type:'path',d:'M0 0'+' '.repeat(262144)}]}",
               "{version:1,children:[{type:'path',d:'M0 0\\0L1 1'}]}",
               "{version:1,children:[{type:'rect',width:Infinity}]}",
               "{version:1,children:[{type:'polygon',points:[0,1,2]}]}",
               "{version:1,children:new Array(4096).fill({type:'g'})}",
               "{version:1,children:[{type:'g',get children(){throw new Error('getter failure')}}]}" })
        {
            const auto error = f.error(std::string("svg.setSvgScene(") + data + ");");
            CHECK_FALSE(error.empty());
            REQUIRE(f.host.surface().find(svg)->svgScene() != nullptr);
            CHECK(*f.host.surface().find(svg)->svgScene() == good);
        }
        CHECK(
            f.error("const cyclic={type:'g'};cyclic.children=[cyclic];svg.setSvgScene({version:1,children:[cyclic]});")
                .find("nesting")
            != std::string::npos);
        CHECK(f.error("other.setSvgScene(null);").find("svg") != std::string::npos);
    }

    TEST_CASE("the root owns hit testing, event propagation and accessibility")
    {
        WebFixture f;
        f.host.surface().setSize({ 100, 100 });
        f.run(std::string(setup) + R"(
            g.clicks=0;g.bubbled=0;svg.focusable=true;
            svg.accessibility={role:'button',label:'Vector control'};
            svg.addEventListener('click',()=>{g.clicks++;});
            root.addEventListener('click',()=>{g.bubbled++;});
        )");
        auto& surface = f.host.surface();
        surface.layout();
        const auto svg = surface.root().children().front()->id();
        CHECK(surface.hitTest({ 1, 1 }) == svg); // outside painted path, inside root viewport
        surface.pointer({ .phase = ui::PointerInput::Phase::Down, .position = { 1, 1 }, .button = 0, .buttons = 1 });
        surface.pointer({ .phase = ui::PointerInput::Phase::Up, .position = { 1, 1 }, .button = 0, .buttons = 0 });
        CHECK(f.eval("clicks").asNumber() == 1);
        CHECK(f.eval("bubbled").asNumber() == 1);
        CHECK(f.eval("svg.focused").asBoolean());
        a11y::SurfaceSemantics semantics(surface);
        (void)semantics.update();
        const auto* accessible = semantics.tree().find(semantics.elementOf(svg));
        REQUIRE(accessible != nullptr);
        CHECK(accessible->role == a11y::Role::Button);
        CHECK(accessible->label == "Vector control");
        CHECK(accessible->children.empty());
    }
}
