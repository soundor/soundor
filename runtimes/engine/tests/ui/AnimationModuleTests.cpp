#include "../web/WebTestSupport.h"

using namespace soundor;
using test::WebFixture;

TEST_SUITE("native animation API")
{
    TEST_CASE("seeking before queued completion delivery settles the prior promise independently")
    {
        WebFixture f;
        f.run(R"(
            import {createView} from 'soundor:ui';
            const node=createView({opacity:0});
            globalThis.animation=node.animate([{opacity:1}],{duration:100,fill:'forwards'});
            globalThis.oldState='pending';globalThis.newState='pending';
            animation.finished.then(()=>{globalThis.oldState='finished';});
            animation.currentTime=100;animation.currentTime=50;
            animation.finished.then(()=>{globalThis.newState='finished';});
        )");
        f.host.tick();
        CHECK(f.eval("oldState").asString() == "finished");
        CHECK(f.eval("newState").asString() == "pending");
        CHECK(f.eval("animation.playState").asString() == "paused");
        f.run("animation.finish();");
        f.host.tick();
        CHECK(f.eval("newState").asString() == "finished");
    }

    TEST_CASE("keyframes starting after zero capture the underlying presentation")
    {
        WebFixture f;
        f.run(R"(
            import {root,createView} from 'soundor:ui';
            globalThis.node=createView({opacity:0.25});root.appendChild(node);
            globalThis.animation=node.animate([{opacity:1,offset:0.5},{opacity:0,offset:1}],{duration:100,fill:'forwards'});
            animation.pause();animation.currentTime=25;
        )");
        CHECK(f.eval("node.style.opacity").asNumber() == 0.25);
        CHECK(f.host.surface().presentation(f.host.surface().root().children()[0]->id())[ui::AnimatedProperty::Opacity]
              == doctest::Approx(0.625));
    }

    TEST_CASE("composed descriptions cross the binding once and native phases do not invoke JavaScript")
    {
        double time = 0;
        RuntimeHost::Options options;
        options.animationClock = [&] { return time; };
        WebFixture f(std::move(options));
        f.run(R"(
            import {root,createView,sequence,delay} from 'soundor:ui';
            globalThis.node=createView({opacity:1});root.appendChild(node);
            globalThis.status='pending';
            globalThis.animation=node.animate(sequence([
                {keyframes:[{opacity:0}],options:{duration:100}},
                delay(50),
                {keyframes:[{opacity:1}],options:{duration:100}}
            ],{fill:'forwards'}));
            animation.finished.then(()=>{globalThis.status='finished';});
        )");
        const auto id = f.host.surface().root().children()[0]->id();
        const auto before = f.host.statistics().runtime.ui.calls;
        time = 50;
        f.host.tick();
        CHECK(f.host.statistics().runtime.ui.calls == before);
        CHECK(f.host.surface().presentation(id)[ui::AnimatedProperty::Opacity] == doctest::Approx(0.5));
        time = 125;
        f.host.tick();
        CHECK(f.host.statistics().runtime.ui.calls == before);
        CHECK(f.host.surface().presentation(id)[ui::AnimatedProperty::Opacity] == 0);
        CHECK(f.eval("status").asString() == "pending");
        time = 250;
        f.host.tick();
        CHECK(f.eval("status").asString() == "finished");
        CHECK(f.eval("animation.currentTime").asNumber() == 250);
        f.run("animation.currentTime=75;");
        CHECK(f.eval("animation.playState").asString() == "paused");
        CHECK(f.host.surface().presentation(id)[ui::AnimatedProperty::Opacity] == doctest::Approx(0.25));
    }

    TEST_CASE("global parallel descriptions own multiple node targets and reject as one on interruption")
    {
        double time = 0;
        RuntimeHost::Options options;
        options.animationClock = [&] { return time; };
        WebFixture f(std::move(options));
        f.run(R"(
            import {root,createView,effect,stagger,animate} from 'soundor:ui';
            globalThis.a=createView({opacity:1});globalThis.b=createView({opacity:1});
            root.appendChild(a);root.appendChild(b);globalThis.status='pending';
            globalThis.group=animate(stagger(50,[effect(a,[{opacity:0}],{duration:100}),effect(b,[{opacity:0}],{duration:100})],{fill:'forwards'}));
            group.finished.catch(error=>{globalThis.status=error.name;});
        )");
        time = 75;
        f.host.tick();
        const auto first = f.host.surface().root().children()[0]->id();
        const auto second = f.host.surface().root().children()[1]->id();
        CHECK(f.host.surface().presentation(first)[ui::AnimatedProperty::Opacity] == doctest::Approx(0.25));
        CHECK(f.host.surface().presentation(second)[ui::AnimatedProperty::Opacity] == doctest::Approx(0.75));
        f.run("b.animate([{opacity:1}],{duration:100});");
        f.host.tick();
        CHECK(f.eval("group.playState").asString() == "idle");
        CHECK(f.eval("status").asString() == "AbortError");
        CHECK(f.host.surface().presentation(first)[ui::AnimatedProperty::Opacity] == 1);
    }

    TEST_CASE("advanced keyframes preserve offsets and seeking updates their native presentation")
    {
        WebFixture f;
        f.run(R"(
            import {root,createView} from 'soundor:ui';
            globalThis.node=createView({opacity:0});root.appendChild(node);
            globalThis.animation=node.animate([
              {opacity:0,offset:0,easing:'ease-in'},
              {opacity:1,offset:0.5},
              {opacity:0.5,offset:1}
            ],{duration:100,iterations:2,direction:'alternate',fill:'forwards'});
            animation.pause();animation.currentTime=25;
        )");
        const auto id = f.host.surface().root().children()[0]->id();
        CHECK(f.host.surface().presentation(id)[ui::AnimatedProperty::Opacity]
              == doctest::Approx(ui::AnimationTimeline::ease(ui::Easing::EaseIn, 0.5)));
        f.run("animation.currentTime=175;");
        CHECK(f.host.surface().presentation(id)[ui::AnimatedProperty::Opacity]
              == doctest::Approx(ui::AnimationTimeline::ease(ui::Easing::EaseIn, 0.5)));
        CHECK(f.error("node.animate([{opacity:0,offset:0.7},{opacity:1,offset:0.2}]);").find("nondecreasing")
              != std::string::npos);
    }

    TEST_CASE("typed spring and paint descriptions execute through one native submission")
    {
        double time = 0;
        RuntimeHost::Options options;
        options.animationClock = [&] { return time; };
        WebFixture f(std::move(options));
        f.run(R"(
            import {root,createView} from 'soundor:ui';
            globalThis.node=createView({opacity:0,backgroundColor:'#ff0000'});root.appendChild(node);
            globalThis.spring=node.animate([{opacity:1}],{type:'spring',stiffness:300,damping:25,mass:1,fill:'forwards'});
            globalThis.paint=node.animate([{backgroundColor:'#0000ff'}],{duration:100,fill:'forwards'});
        )");
        const auto id = f.host.surface().root().children()[0]->id();
        time = 50;
        f.host.tick();
        const auto* node = f.host.surface().find(id);
        CHECK(node->presentedStyle().backgroundColor == ui::Color { 128, 0, 128, 255 });
        CHECK(node->presentedStyle().opacity > 0);
        CHECK(node->style().opacity == 0);
        CHECK(f.eval("spring.playState").asString() == "running");
        CHECK(f.error("node.animate([{opacity:1}],{type:'spring',mass:0});").find("spring parameters")
              != std::string::npos);
        CHECK(f.error("node.animate([{backgroundColor:'red'}],{type:'spring'});").find("numeric opacity")
              != std::string::npos);
        time = 10000;
        f.host.tick();
        CHECK(f.eval("spring.playState").asString() == "finished");
        CHECK(node->presentedStyle().opacity == 1);
    }

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
        f.run("view.style.transform=[{rotate:'+9e1deg'}];");
        CHECK(f.eval("view.getBoundingClientRect().width").asNumber() == doctest::Approx(20));
        CHECK(f.error("view.style.transform=[{rotate:'1e1.0deg'}];").find("invalid angle") != std::string::npos);
        CHECK(f.error("view.style.transform=[{rotate:'1e+deg'}];").find("invalid angle") != std::string::npos);
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
