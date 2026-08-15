# Phase 13 - Mobile and responsive behavior

Room controls wrap on narrow screens, primary touch actions have at least a 44-pixel target, and the
image, multi-file, and folder inputs use native browser pickers. Active and paused transfers display
a keep-open warning and register a `beforeunload` guard. The warning is intentionally honest: mobile
operating systems may suspend a backgrounded browser or PWA.

Automated responsive rendering remains part of the web gate. Final iPhone/iPad/Android device checks
are listed in the Phase 20 beta matrix because browser background and memory policies cannot be
faithfully accepted in desktop emulation.
