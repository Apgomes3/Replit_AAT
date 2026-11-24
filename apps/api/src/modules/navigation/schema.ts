// Left-menu menus, managed on Admin -> Menus. System menus are the code-defined areas (their pages
// live in the web app's LeftNav); admins can rename, reorder, retarget or switch them off. Custom
// menus are added by admins and hold their own links (nav_menu_items).
//
// Who sees a menu: visibility 'everyone', 'departments' (department_keys; a sub-department counts
// as its parent) or 'people' (user_ids). include_unassigned: people without a department count as
// in the rule. People outside the rule either do not see it (outside 'hide') or see it folded
// (outside 'fold'). nav_menu_overrides always show or always hide a menu for one person.
export const NAVIGATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS nav_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(60) NOT NULL UNIQUE,
  label VARCHAR(80) NOT NULL,
  icon VARCHAR(30),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  visibility VARCHAR(20) NOT NULL DEFAULT 'everyone' CHECK (visibility IN ('everyone', 'departments', 'people')),
  department_keys TEXT[] NOT NULL DEFAULT '{}',
  user_ids UUID[] NOT NULL DEFAULT '{}',
  include_unassigned BOOLEAN NOT NULL DEFAULT FALSE,
  outside VARCHAR(10) NOT NULL DEFAULT 'hide' CHECK (outside IN ('hide', 'fold')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nav_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id UUID NOT NULL REFERENCES nav_menus(id) ON DELETE CASCADE,
  label VARCHAR(80) NOT NULL,
  path VARCHAR(500) NOT NULL,
  icon VARCHAR(30),
  module_key VARCHAR(40),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_nav_menu_items_menu ON nav_menu_items (menu_id, sort_order);

CREATE TABLE IF NOT EXISTS nav_menu_overrides (
  menu_id UUID NOT NULL REFERENCES nav_menus(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode VARCHAR(10) NOT NULL CHECK (mode IN ('show', 'hide')),
  PRIMARY KEY (menu_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_nav_menu_overrides_user ON nav_menu_overrides (user_id);
`;
