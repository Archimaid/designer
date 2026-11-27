import { relationshipChoices } from './relationships.ts';

// The relationship picker that opens where a connection is released. One key picks a type.

let open: (() => void) | undefined;

export function closePicker(): void {
  open?.();
}

export function openPicker(client: { x: number; y: number }, title: string, choose: (glyph: string) => void): void {
  closePicker();
  const picker = document.createElement('div');
  picker.className = 'float picker';
  picker.setAttribute('role', 'menu');
  picker.setAttribute('aria-label', title);
  const heading = document.createElement('span');
  heading.className = 'picker-title';
  heading.textContent = title;
  picker.append(heading);
  const pick = (glyph: string) => {
    close();
    choose(glyph);
  };
  for (const choice of relationshipChoices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    const key = document.createElement('kbd');
    key.textContent = choice.key.toUpperCase();
    const name = document.createElement('span');
    name.textContent = choice.name;
    const glyph = document.createElement('code');
    glyph.textContent = choice.glyph;
    button.append(key, name, glyph);
    button.addEventListener('click', () => pick(choice.glyph));
    picker.append(button);
  }
  const left = Math.min(client.x + 12, window.innerWidth - 250);
  const top = Math.min(client.y + 12, window.innerHeight - 420);
  picker.style.left = `${Math.max(12, left)}px`;
  picker.style.top = `${Math.max(12, top)}px`;
  document.body.append(picker);
  picker.querySelector('button')?.focus();

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const choice = relationshipChoices.find(({ key }) => key === event.key.toLowerCase());
    if (choice && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      pick(choice.glyph);
    }
  };
  const onPointer = (event: PointerEvent) => {
    if (!(event.target instanceof Node) || !picker.contains(event.target)) close();
  };
  function close() {
    picker.remove();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPointer, true);
    open = undefined;
  }
  document.addEventListener('keydown', onKey, true);
  // Wait for the release that opened the picker to finish before listening for outside clicks.
  setTimeout(() => document.addEventListener('pointerdown', onPointer, true), 0);
  open = close;
}
