import { idFromName } from './source.ts';

const pngScale = 2;
// Safari refuses canvases above about 16.7 million pixels and every browser caps a side at 16384 px.
const maxCanvasPixels = 16_000_000;
const maxCanvasSide = 16_384;

export interface ExportedSvg {
  readonly source: string;
  readonly width: number;
  readonly height: number;
}

// A download gets the diagram's natural size, so it opens at 100% on its own. The renderer already draws
// without a canvas background, so the export is transparent too.
function prepareSvg(previewSvg: string): ExportedSvg {
  const document = new DOMParser().parseFromString(previewSvg, 'image/svg+xml');
  const svg = document.documentElement;
  if (!(svg instanceof SVGSVGElement)) throw new Error('The rendered diagram is not an SVG document.');
  const { width, height } = svg.viewBox.baseVal;
  if (!(width > 0 && height > 0)) throw new Error('The rendered diagram has no size to export.');

  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.style.removeProperty('max-width');
  if (!svg.getAttribute('style')?.trim()) svg.removeAttribute('style');
  return { source: new XMLSerializer().serializeToString(svg), width, height };
}

async function renderPng({ source, width, height }: ExportedSvg): Promise<Blob> {
  const scale = Math.min(
    pngScale,
    Math.sqrt(maxCanvasPixels / (width * height)),
    maxCanvasSide / Math.max(width, height),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw a PNG.');

  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The PNG could not be encoded.'))), 'image/png');
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking in the same task can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// "Order fulfilment" downloads as order-fulfilment.svg.
export function fileBaseOf(title: string): string {
  return idFromName(title || 'diagram', new Set()).replace(/[A-Z]/gu, (letter) => '-' + letter.toLowerCase());
}

// The text needs no drawing; the images need the last diagram that rendered.
// Resolves to whether a file was downloaded: there is no image to export until the diagram has rendered.
export async function exportDiagram(
  kind: string,
  text: string,
  svg: string | undefined,
  base: string,
): Promise<boolean> {
  if (kind === 'mmd') {
    downloadBlob(new Blob([text], { type: 'text/plain' }), `${base}.mmd`);
    return true;
  }
  if (!svg) return false;
  const prepared = prepareSvg(svg);
  if (kind === 'svg') downloadBlob(new Blob([prepared.source], { type: 'image/svg+xml' }), `${base}.svg`);
  else downloadBlob(await renderPng(prepared), `${base}.png`);
  return true;
}
