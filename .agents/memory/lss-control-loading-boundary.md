---
name: LSS control loading boundary
description: Reliability boundary for opening one LSS Control and Field Instruments panel.
---

Opening one LSS control panel must use a targeted book/system lookup rather than loading the complete Design Book engineering aggregate. Browser requests must be time-bounded, non-repeating by default, and cancelled when navigation makes them obsolete.

**Why:** A catalogue lock combined with repeated component remounts left control and product requests pending for minutes, accumulated duplicate work, and kept the panel on its loading state.

**How to apply:** Keep detail-panel reads independent from unrelated engineering packages. Convert timeouts to a recoverable error with explicit retry, and pass cancellation signals through data-query clients.