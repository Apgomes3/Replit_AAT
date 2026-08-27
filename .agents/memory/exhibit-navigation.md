---
name: Design Book detail navigation
description: Navigation convention for Design Book exhibit and LSS detail pages.
---

Back is the primary escape action on Design Book exhibit and LSS detail pages and should remain visually prominent. Page-level tools belong in an adjacent accessible menu. Keyboard Escape should close that menu first, then navigate back only when focus is not in an editable field.

**Why:** Users need an obvious way out of a detail page, while a single tools surface gives future actions a predictable home without crowding the header.

**How to apply:** Keep the primary back action as a labeled button, preserve keyboard and mobile access through the visible tools control, close menus on outside click or Escape, and treat input, select, textarea, and contenteditable focus as an edit guard.