import { ui } from './ui.ts';

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

const toastMs = 2800;
let timer: number | undefined;
let pendingAction: (() => void) | undefined;

// One notification at a time: a new one replaces the last, and its action runs at most once.
export function showToast(message: string, action?: ToastAction, durationMs = toastMs): void {
  clearTimeout(timer);
  ui.toastMessage.textContent = message;
  ui.toastAction.hidden = !action;
  ui.toastAction.textContent = action?.label ?? '';
  pendingAction = action?.run;
  ui.toast.classList.remove('is-hidden');
  timer = window.setTimeout(() => ui.toast.classList.add('is-hidden'), durationMs);
}

ui.toastAction.addEventListener('click', () => {
  pendingAction?.();
  pendingAction = undefined;
  ui.toast.classList.add('is-hidden');
});
