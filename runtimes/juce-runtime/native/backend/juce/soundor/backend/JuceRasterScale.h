#pragma once

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // A scale-mode editor can fit its completed image to a new window without
    // reallocating/rasterizing every canvas at each step of a resize. Keep the
    // raster density while the size keeps changing, then sharpen at the new
    // density once it has been still for 100 ms. Whether a pointer is held is
    // not asked: that is a round trip on the X connection every frame, and an
    // event arriving during one waits in Xlib's queue for the next (a click).
    class JuceRasterScale
    {
    public:
        float update(float wanted, int width, int height, double nowMs) noexcept
        {
            if (width != width_ || height != height_)
            {
                width_ = width;
                height_ = height;
                changedAt_ = nowMs;
            }
            if (scale_ <= 0 || nowMs - changedAt_ >= 100)
                scale_ = wanted;
            return scale_;
        }

    private:
        float scale_ = 0;
        int width_ = 0;
        int height_ = 0;
        double changedAt_ = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
