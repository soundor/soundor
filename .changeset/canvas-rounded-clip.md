---
'@soundor/engine': patch
---

With the GPU compositor, a WebGL canvas inside a rounded `overflow: 'hidden'` view keeps the view's rounded corners. The canvas's layer was clipped by an ancestor only where the canvas stuck out of the ancestor's box, so one that filled it was drawn with square corners. The layer's clip is now the canvas's own rounded box and its clipping ancestors' together, and a canvas that more than one rounded rectangle cuts is read back and drawn on the CPU. A canvas larger than a rounded clip is a GPU layer now, rather than read back.
