// One shared tooltip for every control with a data-tip, shown on hover or keyboard focus. Touch has no hover,
// so a finger never opens it; those controls keep their accessible names for screen readers.

const showDelayMs = 450;
// Moving straight from one control to the next shows the next tooltip at once, as native toolbars do.
const warmMs = 600;
const gap = 8;
const margin = 8;

function tipOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null;
}

export function installTooltips(): void {
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.id = 'tooltip';
  tooltip.hidden = true;
  document.body.append(tooltip);

  let owner: HTMLElement | null = null;
  let pending: HTMLElement | null = null;
  let showTimer: number | undefined;
  let hiddenAt = 0;

  const place = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    // Controls in the lower half open their tooltip upwards, so the bottom bar's tooltips stay in the window.
    const above = rect.top + rect.height / 2 > window.innerHeight / 2;
    const top = above ? rect.top - gap - height : rect.bottom + gap;
    const left = Math.min(window.innerWidth - margin - width, Math.max(margin, rect.left + rect.width / 2 - width / 2));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const show = (anchor: HTMLElement) => {
    const text = anchor.dataset.tip;
    if (!text) return;
    tooltip.replaceChildren(text);
    if (anchor.dataset.keys) {
      const keys = document.createElement('kbd');
      keys.textContent = anchor.dataset.keys;
      tooltip.append(keys);
    }
    tooltip.hidden = false;
    owner = anchor;
    anchor.setAttribute('aria-describedby', tooltip.id);
    place(anchor);
  };

  const hide = () => {
    clearTimeout(showTimer);
    pending = null;
    if (!owner) return;
    owner.removeAttribute('aria-describedby');
    owner = null;
    tooltip.hidden = true;
    hiddenAt = Date.now();
  };

  const schedule = (anchor: HTMLElement) => {
    if (Date.now() - hiddenAt < warmMs) {
      show(anchor);
      return;
    }
    pending = anchor;
    showTimer = window.setTimeout(() => {
      pending = null;
      show(anchor);
    }, showDelayMs);
  };

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const anchor = tipOf(event.target);
    if (anchor === owner || anchor === pending) return;
    hide();
    if (anchor) schedule(anchor);
  });
  document.addEventListener('pointerout', (event) => {
    const anchor = tipOf(event.target);
    if (anchor && anchor.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) return;
    if (anchor) hide();
  });
  document.addEventListener('focusin', (event) => {
    const anchor = tipOf(event.target);
    if (anchor?.matches(':focus-visible')) show(anchor);
  });
  document.addEventListener('focusout', hide);
  // Pressing a control acts on it, so its tooltip steps aside; so does anything that moves the page under it.
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  window.addEventListener('wheel', hide, { passive: true });
  window.addEventListener('resize', hide);
}
