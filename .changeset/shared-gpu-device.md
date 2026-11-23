---
'@soundor/engine': patch
---

Opening an editor starts far fewer threads, and editors open at the same time share one GPU device. ANGLE's worker pool had one thread per CPU for each editor's display, so each open started about a dozen threads, and their glibc arenas kept the memory they freed after the editor closed. A display's pool now has at most two threads (a patch to ANGLE). The editors open on one thread share one device, with one display and one pool. A display is reused when an editor is opened again, rather than ANGLE keeping one more per open.
