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

function isIconOnlyControl(element: HTMLElement): boolean {
  return !Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
}

/**
 * Finds icon-only controls that have no accessible name. This intentionally
 * ignores controls that contain visible text and decorative icon containers.
 */
export function findUnnamedIconOnlyControls(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(CONTROL_SELECTOR))
    .filter(element => isIconOnlyControl(element) && !hasAccessibleName(element));
}

/**
 * Produces actionable test output that identifies the surface and exact
 * control requiring an accessible name.
 */
export function describeUnnamedIconOnlyControls(surface: string, controls: HTMLElement[]): string[] {
  return controls.map((control, index) => {
    const attributes = [
      control.id && `#${control.id}`,
      control.getAttribute('data-testid') && `[data-testid="${control.getAttribute('data-testid')}"]`,
      control.getAttribute('name') && `[name="${control.getAttribute('name')}"]`,
      control.classList.length > 0 && `.${Array.from(control.classList).slice(0, 3).join('.')}`,
    ].filter(Boolean).join('');
    const markup = control.outerHTML.replace(/\s+/g, ' ').slice(0, 180);

    return `${surface} control ${index + 1}: <${control.tagName.toLowerCase()}${attributes}> needs an accessible name — ${markup}`;
  });
}