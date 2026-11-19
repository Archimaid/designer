import type { Mermaid } from 'mermaid';

export type RenderOutcome =
  | { readonly kind: 'rendered'; readonly svg: string }
  | { readonly kind: 'failed'; readonly message: string }
  // A newer render started before this one finished; its result was dropped.
  | { readonly kind: 'superseded' };

let mermaidPromise: Promise<Mermaid> | undefined;

// Mermaid and the renderer are large, so they load only when the first diagram is drawn.
function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= Promise.all([import('mermaid'), import('archimaid')])
    .then(async ([{ default: mermaid }, { createArchiMatePlugin }]) => {
      // Natural size and no canvas fill: the designer's own page is the canvas and handles zoom itself.
      await mermaid.registerExternalDiagrams([
        createArchiMatePlugin({ useMaxWidth: false, background: 'transparent' }),
      ]);
      return mermaid;
    })
    .catch((error: unknown) => {
      // Forget the failed load (for example a dropped connection), so the next render tries again.
      mermaidPromise = undefined;
      throw error;
    });
  return mermaidPromise;
}

let latestRequest = 0;

export async function renderDiagram(source: string): Promise<RenderOutcome> {
  const request = ++latestRequest;
  try {
    const mermaid = await loadMermaid();
    if (request !== latestRequest) return { kind: 'superseded' };
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
    const { svg } = await mermaid.render(`archimaid-designer-${request}`, source);
    return request === latestRequest ? { kind: 'rendered', svg } : { kind: 'superseded' };
  } catch (error) {
    if (request !== latestRequest) return { kind: 'superseded' };
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
