// Negative control for the symbol check: exports one symbol that is not on the
// allow-list, so the check must fail on this library.

extern "C" __attribute__((visibility("default"))) int soundor_probe_entry()
{
    return 0;
}
extern "C" __attribute__((visibility("default"))) int JS_LeakedEngineSymbol()
{
    return 1;
}
