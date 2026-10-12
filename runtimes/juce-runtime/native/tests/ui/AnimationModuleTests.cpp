#include "../web/WebTestSupport.h"

using namespace soundor;
using test::WebFixture;

TEST_SUITE("native animation API")
{
    TEST_CASE("backward fill holds a delayed transition while new application base styles are published")
    {
        double time = 0;
        RuntimeHost::Options options;
        options.animationClock = [&] { return time; };
        WebFixture f(std::move(options));
        f.run(R"(
            import {root,createView} from 'soundor:ui';
            globalThis.view=createView({opacity:0});root.appendChild(view);
            globalThis.animation=view.animate([{opacity:1}],{delay:100,duration:100,fill:'both'});
            view.style.opacity=1;
        )");
        const auto node = f.host.surface().root().children()[0]->id();
        CHECK(f.host.surface().presentation(node)[ui::AnimatedProperty::Opacity] == 0);
        CHECK(f.host.surface().find(node)->style().opacity == 1);
        time = 50;
        f.host.tick();
        CHECK(f.host.surface().presentation(node)[ui::AnimatedProperty::Opacity] == 0);
        time = 150;
        f.host.tick();
        CHECK(f.host.surface().presentation(node)[ui::AnimatedProperty::Opacity] == doctest::Approx(0.5));
        f.run("view.style.opacity=0.3; animation.cancel();");
        CHECK(f.host.surface().presentation(node)[ui::AnimatedProperty::Opacity] == doctest::Approx(0.3));
    }

    TEST_CASE("teardown and reload discard pending native animations and completion promises")
    {
        double time = 0;
        for (int cycle = 0; cycle < 3; ++cycle)
        {
            RuntimeHost::Options options;
            options.animationClock = [&] { return time; };
            WebFixture f(std::move(options));
            f.run(R"(
                import {root,createView} from 'soundor:ui';
                const node=createView({opacity:0});root.appendChild(node);
                globalThis.pending=node.animate([{opacity:1}],{duration:10000});
                pending.finished.catch(()=>{});
            )");
            CHECK(f.host.surface().animations().size() == 1);
            time += 50;
            f.host.tick();
        }
        WebFixture fresh;
        CHECK(fresh.host.surface().animations().size() == 0);
        CHECK(fresh.eval("typeof pending").asString() == "undefined");
    }

    TEST_CASE("completion listeners and clocks remain isolated across simultaneous runtimes")
    {
        double timeA = 0, timeB = 0;
        RuntimeHost::Options optionsA, optionsB;
        optionsA.animationClock = [&] { return timeA; };
        optionsB.animationClock = [&] { return timeB; };
        WebFixture a(std::move(optionsA)), b(std::move(optionsB));
        const std::string body = R"(
            import {root,createView} from 'soundor:ui';
            const node=createView({opacity:0});root.appendChild(node);
            globalThis.status='pending';
            node.animate([{opacity:1}],{duration:100,fill:'forwards'}).finished.then(()=>{globalThis.status='finished';});
        )";
        a.run(body);
        b.run(body);
        timeA = 50;
        a.host.tick();
        CHECK(a.eval("status").asString() == "pending");
        CHECK(b.eval("status").asString() == "pending");
        timeB = 100;
        b.host.tick();
        CHECK(b.eval("status").asString() == "finished");
        CHECK(a.eval("status").asString() == "pending");
        CHECK(a.host.surface().presentation(a.host.surface().root().children()[0]->id())[ui::AnimatedProperty::Opacity]
              == doctest::Approx(0.5));
    }

    TEST_CASE("a retained finished promise settles after its animation handle is collected")
    {
        double time = 0;
        RuntimeHost::Options options;
        options.animationClock = [&] { return time; };
        WebFixture f(std::move(options));
        f.run(R"(
            import {root,createView} from 'soundor:ui';
            globalThis.view = createView({opacity:0});
            root.appendChild(view);
            globalThis.status = 'pending';
            view.animate([{opacity:1}], {duration:100,fill:'forwards'}).finished.then(()=>{globalThis.status='finished';});
        )");
        f.host.tick();
        f.host.runtime().collectGarbage();
        f.host.tick();
        time = 100;
        f.host.tick();
        CHECK(f.eval("status").asString() == "finished");
        const auto node = f.host.surface().root().children()[0]->id();
        CHECK(f.host.surface().presentation(node)[ui::AnimatedProperty::Opacity] == 1);
    }

    TEST_CASE("one submission animates without JS callbacks, UI calls or React updates between endpoints")
    {
        double time = 0;
        RuntimeHost::Options options;
        options.animationClock = [&] { return time; };
        WebFixture f(std::move(options));
        f.host.surface().setSize({ 100, 100 });
        f.run(R"(
            import { root, createView } from 'soundor:ui';
            globalThis.view = createView({width: 40, height: 20, opacity: 0});
            root.appendChild(view);
            globalThis.status = 'pending';
            globalThis.animation = view.animate([
                {opacity: 0, transform: [{translateY: 20}]},
                {opacity: 1, transform: [{translateY: 0}]}
            ], {duration: 100, easing: 'linear', fill: 'forwards'});
            animation.finished.then(() => {globalThis.status = 'finished';});
        )");
        (void)f.host.frame();
        const auto id = f.host.surface().root().children()[0]->id();
        const auto before = f.host.statistics();
        time = 50;
        f.host.tick();
        const auto after = f.host.statistics();
        CHECK(after.runtime.ui.calls == before.runtime.ui.calls);
        CHECK(after.surface.styleChanges == before.surface.styleChanges);
        CHECK(after.surface.layoutPasses == before.surface.layoutPasses);
        CHECK(f.host.surface().presentation(id)[ui::AnimatedProperty::Opacity] == doctest::Approx(0.5));
        CHECK(f.host.surface().presentation(id)[ui::AnimatedProperty::TranslateY] == doctest::Approx(10));
        CHECK(f.eval("status").asString() == "pending");
        CHECK(f.eval("view.style.opacity").asNumber() == 0);
        time = 100;
        f.host.tick();
        CHECK(f.eval("status").asString() == "finished");
        CHECK(f.eval("animation.playState").asString() == "finished");
        CHECK(f.eval("animation.currentTime").asNumber() == 100);
        f.run("animation.cancel(); animation.pause();");
        CHECK(f.eval("animation.playState").asString() == "paused");
        f.run("animation.cancel(); animation.finish();");
        CHECK(f.eval("animation.playState").asString() == "finished");
    }

    TEST_CASE("cancellation rejects finished, playback restarts and old completion cannot finish the new run")
    {
        double time = 0;
        RuntimeHost::Options options;
        options.animationClock = [&] { return time; };
        WebFixture f(std::move(options));
        f.run(R"(
            import {createView} from 'soundor:ui';
            globalThis.view = createView({opacity: 0});
            globalThis.animation = view.animate([{opacity: 1}], {duration: 100, fill: 'forwards'});
            globalThis.status = '';
            animation.finished.catch(error => {globalThis.status = error.name;});
            animation.cancel();
        )");
        f.host.tick();
        CHECK(f.eval("status").asString() == "AbortError");
        f.run("animation.play(); animation.finish(); animation.play(); globalThis.status='pending'; "
              "animation.finished.then(()=>{globalThis.status='finished';});");
        f.host.tick();
        CHECK(f.eval("status").asString() == "pending");
        time = 100;
        f.host.tick();
        CHECK(f.eval("status").asString() == "finished");
    }

    TEST_CASE("validation, transformed styles and reduced motion share the UI contract")
    {
        WebFixture f;
        f.run(
            R"(import { createView, root } from 'soundor:ui'; globalThis.view=createView({width:40,height:20,transform:[{translateX:60},{rotate:'90deg'}]}); root.appendChild(view);)");
        f.host.surface().setSize({ 100, 100 });
        CHECK(f.eval("view.getBoundingClientRect().width").asNumber() == doctest::Approx(20));
        CHECK(f.error("view.animate([{width:30}]);").find("unsupported property width") != std::string::npos);
        CHECK(f.error("view.animate([{opacity:1}], {duration:-1});").find("nonnegative") != std::string::npos);
        CHECK(f.error("view.style.transform=[{scale:1},{scale:2}];").find("duplicate scale") != std::string::npos);
        f.run(R"(
            import {setReducedMotion, prefersReducedMotion} from 'soundor:ui';
            setReducedMotion(true);
            globalThis.reduced= prefersReducedMotion();
            globalThis.animation=view.animate([{opacity:0}],{duration:100,fill:'forwards'});
        )");
        CHECK(f.eval("reduced").asBoolean());
        CHECK(f.eval("animation.playState").asString() == "finished");
    }
}
