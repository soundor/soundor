---
'@soundor/web-runtime': minor
---

Soundor's accessibility semantics as ARIA in the browser, on the elements that already draw the nodes. Roles, labels (explicit, or the text inside a button-like element), hints, states and range values become ARIA attributes; text inputs and images keep their native semantics. A modal is an `aria-modal` dialog with everything outside it `aria-hidden`, nested modals supersede each other, and a portal opened from a modal is owned by it (`aria-owns`). A screen reader's activation (a click with no pointer) presses a `Pressable` once, through the `activate` accessibility action.
