/**
 * Centralized keyboard shortcut definitions.
 * Each entry carries both Mac and Windows/PC display labels so every
 * affordance in the UI stays in sync automatically.
 */

export interface ShortcutKey {
  mac: string;
  win: string;
}

export interface ShortcutEntry {
  id: string;
  description: string;
  keys: ShortcutKey;
}

export interface ShortcutGroup {
  group: string;
  shortcuts: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    group: 'Global Search',
    shortcuts: [
      {
        id: 'cmd-palette-open',
        description: 'Open / close command palette',
        keys: { mac: '⌘ K', win: 'Ctrl K' },
      },
      {
        id: 'cmd-palette-navigate',
        description: 'Navigate results',
        keys: { mac: '↑ ↓', win: '↑ ↓' },
      },
      {
        id: 'cmd-palette-open-result',
        description: 'Open selected result',
        keys: { mac: '↵', win: '↵' },
      },
      {
        id: 'cmd-palette-close',
        description: 'Close palette / dismiss',
        keys: { mac: 'Esc', win: 'Esc' },
      },
    ],
  },
];

/** Convenience: the open/close shortcut used in inline affordances. */
export const SEARCH_SHORTCUT: ShortcutKey = SHORTCUT_GROUPS[0].shortcuts[0].keys;
