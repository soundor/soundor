---
'@soundor/react': minor
---

`FocusScope`: a boundary for keyboard focus that adds no node, so layout is unchanged.

- `trapped`: Tab and Shift+Tab cycle through the scope's focusable nodes (wrapping, skipping hidden and unfocusable ones) instead of the whole view, and focus moved outside, programmatically or by a press, is taken back. The innermost trapping scope wins.
- `autoFocus`: on mount, focuses the first focusable node unless focus is already inside.
- `restoreFocus`: on unmount, returns focus to the node that had it on mount when it is still connected and focusable; nested scopes each restore to where they were opened.
- Membership follows React's tree rather than the node tree, so content a scope renders elsewhere in the view still belongs to it.
