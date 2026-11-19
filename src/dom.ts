// Small pieces of behaviour that several controls share.

export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id} in index.html.`);
  return element as T;
}

// One button of a group is pressed, or none when nothing matches.
export function pressOnly(buttons: readonly HTMLElement[], pressed: HTMLElement | undefined): void {
  for (const button of buttons) button.setAttribute('aria-pressed', String(button === pressed));
}

// A button that opens a menu under it. Choosing an item, pressing outside or Escape closes it; an item
// marked data-keep-open (one that asks to confirm first) leaves it open. Returns the function that closes it.
export function createDropdown(toggle: HTMLButtonElement, menu: HTMLElement): () => void {
  const setOpen = (open: boolean) => {
    menu.classList.toggle('is-hidden', !open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  const close = () => setOpen(false);
  toggle.addEventListener('click', () => setOpen(menu.classList.contains('is-hidden')));
  menu.addEventListener('click', (event) => {
    const item = event.target instanceof Element ? event.target.closest('[role="menuitem"]') : null;
    if (item && !item.hasAttribute('data-keep-open')) close();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node) || toggle.contains(event.target) || menu.contains(event.target)) return;
    close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  return close;
}

const confirmMs = 3000;

// A destructive button asks once: the first press turns it into a red "Are you sure?", the second runs it.
// It falls back after a few seconds, or when the next press lands anywhere else.
export function confirmTwice(button: HTMLButtonElement, run: () => void): void {
  const label = button.querySelector('.label');
  if (!label) throw new Error(`#${button.id} needs a .label to confirm with.`);
  const idle = label.textContent;
  let timer: number | undefined;
  const disarm = () => {
    clearTimeout(timer);
    button.classList.remove('is-armed');
    label.textContent = idle;
  };
  button.addEventListener('click', () => {
    if (!button.classList.contains('is-armed')) {
      button.classList.add('is-armed');
      label.textContent = 'Are you sure?';
      timer = window.setTimeout(disarm, confirmMs);
      return;
    }
    disarm();
    run();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node && button.contains(event.target))) disarm();
  });
}
