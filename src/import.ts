import { maxFileBytes, readImported } from './diagram-file.ts';
import { isTyping } from './dom.ts';
import { showToast } from './toast.ts';
import { ui } from './ui.ts';

export interface ImportOptions {
  readonly open: (source: string, title: string) => void;
  // A paste that is not a diagram is explained only where a paste was clearly meant as an import.
  readonly expectsPaste: () => boolean;
}

const notADiagram = 'That is not an Archimaid diagram: it needs an archimate-beta line.';

// A diagram comes in four ways: the file picker, a file dropped anywhere on the page, ⌘V outside the text
// fields, and the empty state's Paste button.
export function installImport({ open, expectsPaste }: ImportOptions): void {
  const take = (text: string, fileName?: string): boolean => {
    const imported = readImported(text, fileName);
    if (imported.kind === 'not-a-diagram') return false;
    open(imported.source, imported.title);
    return true;
  };

  const takeFile = async (file: File): Promise<void> => {
    if (file.size > maxFileBytes) {
      showToast(`${file.name} is too large to be a diagram.`);
      return;
    }
    try {
      if (!take(await file.text(), file.name)) showToast(notADiagram);
    } catch {
      showToast(`${file.name} could not be read.`);
    }
  };

  const chooseFile = () => ui.fileInput.click();
  ui.openFile.addEventListener('click', chooseFile);
  ui.emptyChoose.addEventListener('click', chooseFile);
  ui.fileInput.addEventListener('change', () => {
    const [file] = ui.fileInput.files ?? [];
    // Clearing the value lets the same file be chosen again after it was changed on disk.
    ui.fileInput.value = '';
    if (file) void takeFile(file);
  });

  ui.emptyPaste.addEventListener('click', async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Firefox and denied permissions refuse to read the clipboard, but a keyboard paste always works.
      showToast('Press ⌘V or Ctrl+V to paste the diagram.');
      return;
    }
    if (!take(text)) showToast(text.trim() ? notADiagram : 'The clipboard is empty.');
  });

  document.addEventListener('paste', (event) => {
    if (isTyping(event.target)) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (take(text)) {
      event.preventDefault();
      return;
    }
    if (expectsPaste() && text.trim()) showToast(notADiagram);
  });

  installDropZone(takeFile);
}

// dragenter and dragleave fire for every child the pointer crosses, so the zone counts them to know when the
// file has left the window.
function installDropZone(takeFile: (file: File) => Promise<void>): void {
  let depth = 0;
  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  const setShown = (shown: boolean) => ui.dropZone.classList.toggle('is-hidden', !shown);

  window.addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    depth++;
    setShown(true);
  });
  window.addEventListener('dragleave', (event) => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setShown(false);
  });
  window.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    // Without this the browser opens the dropped file in place of the page.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth = 0;
    setShown(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    const [file] = files;
    if (!file) return;
    if (files.length > 1) showToast('Drop one diagram at a time.');
    else void takeFile(file);
  });
}
