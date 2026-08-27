---
name: Exhibit navigation
description: Navigation convention for Design Book exhibit detail pages.
---

Back to Design Book is the primary exhibit escape action and should remain visually prominent. Exhibit-level tools belong in the adjacent accessible tools menu, which can also be opened from the exhibit header context menu. Keyboard Escape should close that menu first, then navigate back only when focus is not in an editable field.

**Why:** Users need an obvious way out of a detail page, while a single tools surface gives future actions a predictable home without crowding the header.

**How to apply:** Keep the primary back action as a labeled button, preserve keyboard and mobile access through the visible tools control, close menus on outside click or Escape, and treat input, select, textarea, and contenteditable focus as an edit guard.