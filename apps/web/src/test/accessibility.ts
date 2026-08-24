const CONTROL_SELECTOR = 'button, a, [role="button"], [role="menuitem"]';

function hasAccessibleName(element: HTMLElement): boolean {
  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) return true;

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map(id => document.getElementById(id)?.textContent?.trim() || '')
      .join(' ')
      .trim();
    if (label) return true;
  }

  if (element.textContent?.trim()) return true;
  return Boolean(element.getAttribute('title')?.trim());
}

/**
 * Finds controls whose only visible content is an icon and that have no
 * accessible name. This intentionally ignores decorative icon containers.
 */
export function findUnnamedIconOnlyControls(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
    .filter(element => !hasAccessibleName(element));
}