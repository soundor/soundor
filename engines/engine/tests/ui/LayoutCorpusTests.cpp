// The frames the engine gives the trees of tests/layout/corpus.json, through
// soundor:ui itself: what the web runtime must match (its layout-corpus.test.ts).
// With UPDATE_GOLDEN=1 this writes them, after a change that is meant to change
// layout; generate.mjs writes the trees.
#include "../support/Modules.h"
#include "../web/WebTestSupport.h"

#include <cstddef>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>

using namespace soundor;
using test::WebFixture;

namespace
{
    // Whether to write the frames, rather than check them.
    bool updatingGolden()
    {
#if defined(_MSC_VER)
        char* value = nullptr;
        std::size_t size = 0;
        const bool set = _dupenv_s(&value, &size, "UPDATE_GOLDEN") == 0 && value != nullptr;
        std::free(value);
        return set;
#else
        // Read before any thread is started.
        return std::getenv("UPDATE_GOLDEN") != nullptr; // NOLINT(concurrency-mt-unsafe)
#endif
    }

    RuntimeHost::Options approximateText()
    {
        RuntimeHost::Options options;
        options.textEngine = ui::approximateTextEngine();
        return options;
    }
} // namespace

TEST_SUITE("layout corpus")
{
    TEST_CASE("the engine's frames are the corpus's")
    {
        std::ifstream in(SOUNDOR_LAYOUT_CORPUS, std::ios::binary);
        REQUIRE(in.good());
        std::stringstream text;
        text << in.rdbuf();

        WebFixture f(approximateText());
        f.host.surface().setSize({ 800, 600 });
        f.run(R"(
            import { root, createView, createText, createScrollView } from 'soundor:ui';
            globalThis.corpus = )"
              + text.str() + R"(;
            const make = (tree) => {
              const node = tree.type === 'text' ? createText(tree.text, tree.style)
                : tree.type === 'scroll' ? createScrollView(tree.style)
                : createView(tree.style);
              for (const child of tree.children) node.appendChild(make(child));
              return node;
            };
            const frames = (node, out) => {
              const { x, y, width, height } = node.layout;
              out.push([x, y, width, height]);
              for (const child of node.children) frames(child, out);
              return out;
            };
            globalThis.layOut = (scale) => {
              let differing = 0;
              let first = '';
              const framesOf = (list) => list.map((frame) => JSON.stringify(frame));
              corpus.entries.forEach((entry, index) => {
                const node = make(entry.tree);
                root.appendChild(node);
                // The corpus's root is in the view's root, which fills the view.
                const got = frames(node, []);
                root.removeChild(node);
                const want = entry.frames[scale];
                if (JSON.stringify(got) !== JSON.stringify(want)) {
                  differing++;
                  const has = framesOf(got);
                  const had = framesOf(want);
                  const at = has.findIndex((frame, i) => frame !== had[i]);
                  first ||= `tree ${index} at scale ${scale}, node ${at}: ${has[at]}, not ${had[at]}`;
                }
                entry.frames[scale] = got;
              });
              return differing === 0 ? '' : `${differing} trees differ, first ${first}`;
            };
        )");

        const bool update = updatingGolden();
        const auto scales = static_cast<int>(f.eval("corpus.scales.length").asNumber());
        for (int i = 0; i < scales; ++i)
        {
            const std::string index = std::to_string(i);
            const auto scale = static_cast<float>(f.eval("corpus.scales[" + index + "]").asNumber());
            f.host.surface().setScale(scale);
            const std::string differences = f.eval("layOut(corpus.scales[" + index + "])").asString();
            if (! update)
                CHECK(differences == "");
        }
        if (update)
        {
            std::ofstream out(SOUNDOR_LAYOUT_CORPUS, std::ios::binary);
            out << f.eval("JSON.stringify(corpus)").asString() << '\n';
        }
    }
}
