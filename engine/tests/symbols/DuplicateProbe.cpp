// Negative control for the shared-definitions check: compiled into two
// archives, so both define the same C symbol and the check must fail on them.

extern "C" int soundor_duplicate_probe()
{
    return 0;
}
