---
'@soundor/engine': patch
'@soundor/environment': patch
---

Round layout to the device-pixel grid by where each edge is in the view, instead of with Yoga's rounding, so boxes laid out to line up stay lined up at a fractional scale (125 %, 150 %), and the native renderer and the browser draw the same pixels:

- Boxes centred in one parent share one centre exactly, and keep the same size wherever the parent lands; where their sizes would differ by an odd number of device pixels, a view's size is rounded the other way, or one device pixel added, to fit it. An `Image`, `Canvas` or `Svg` at a whole number of device pixels keeps its size, so it stays sharp.
- Nodes with the same style land on the same pixels whatever their type: an `Svg`, `Image` or `Canvas` was rounded down like text, a pixel away from a `View` styled the same.
- Border widths, outline widths and outline offsets are whole device pixels, rounded down and at least one, as CSS has them: the native renderer drew a 1 px border at 125 % as 1.25 device pixels with soft edges, where the browser draws one. What is inside a border moves with it.
- In the browser, the view's origin is put on a device pixel when the page places it between two (a view centred in the page), so the browser does not round each element again.

Text is still never narrower than measured, now by up to one device pixel less than before. Frames change by at most one device pixel.
