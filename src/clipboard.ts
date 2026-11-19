// The Clipboard API only exists in a secure context. A page opened over plain http on the local network, as
// when trying the designer on a phone, falls back to the older copy command, which still works from a tap.
function copyWithSelection(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  Object.assign(field.style, { position: 'fixed', top: '0', left: '-9999px', opacity: '0' });
  document.body.append(field);
  field.select();
  field.setSelectionRange(0, text.length);
  const copied = document.execCommand('copy');
  field.remove();
  return copied;
}

export async function copyText(text: string): Promise<boolean> {
  if (!window.isSecureContext || !('clipboard' in navigator)) return copyWithSelection(text);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    // Some browsers refuse the API without a recent gesture; the selection fallback may still succeed.
    console.warn('Clipboard write was refused, trying the copy command.', error);
    return copyWithSelection(text);
  }
}
