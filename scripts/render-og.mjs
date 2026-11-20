// Renders public/og.png, the social preview, from the built designer: the diagram in the image is the starter
// diagram as the designer draws it. The output is committed; run `npm run og` after changing the starter or the look.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { elementTypes } from 'archimaid/language';
import { chromium } from 'playwright';
import { preview } from 'vite';

const root = new URL('../', import.meta.url);
const output = new URL('public/og.png', root);

const colours = {
  ink: '#17171c',
  paper: '#fbfaf6',
  strategy: '#f5deaa',
  business: '#faf087',
  application: '#b8e7fc',
  technology: '#d6f8b8',
  implementation: '#ffe0e0',
  motivation: '#d9cfff',
};

function fontFace(family, file, weight) {
  const data = readFileSync(new URL(`node_modules/${file}`, root)).toString('base64');
  return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:${weight};}`;
}

const fonts = [
  fontFace(
    'Space Grotesk',
    '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2',
    '300 700',
  ),
  fontFace('JetBrains Mono', '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', 400),
  fontFace('JetBrains Mono', '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2', 600),
].join('');

const mark = `<svg viewBox="0 0 120 120" aria-hidden="true">${[
  [34, 14, colours.business],
  [23, 47, colours.application],
  [12, 80, colours.technology],
]
  .map(
    ([x, y, fill]) =>
      `<rect x="${x}" y="${y}" width="74" height="26" rx="9" fill="${fill}" stroke="${colours.ink}" stroke-width="6"/>`,
  )
  .join('')}</svg>`;

// The palette tiles use the catalogue's own notation icons, as the designer does.
function tile(key, label, fill, ink) {
  const paths = (elementTypes[key]?.notation?.icon ?? [])
    .map(({ d, fill: pathFill }) => `<path d="${d}" fill="${pathFill === 'ink' ? 'currentColor' : 'none'}"/>`)
    .join('');
  return `<div class="tile"><span class="icon" style="background:${fill};color:${ink}"><svg viewBox="0 0 16 16">${paths}</svg></span>${label}</div>`;
}

async function renderedStarterDiagram(browser, url) {
  const page = await browser.newPage();
  await page.goto(url);
  const svg = page.locator('#stage svg.diagram');
  await svg.locator('[data-archimate-element]').first().waitFor();
  const markup = await svg.evaluate((element) => element.outerHTML);
  await page.close();
  return markup;
}

function socialPreviewPage(diagram) {
  const stripe = ['strategy', 'business', 'application', 'technology', 'implementation', 'motivation']
    .map((layer) => `<span style="background:${colours[layer]}"></span>`)
    .join('');
  const tiles = [
    tile('businessActor', 'Actor', colours.business, '#5c5200'),
    tile('businessProcess', 'Process', colours.business, '#5c5200'),
    tile('applicationService', 'Service', colours.application, '#0b4a6b'),
    tile('node', 'Node', colours.technology, '#2b5e0f'),
  ].join('');
  return `<!doctype html><html><head><style>
    ${fonts}
    *{box-sizing:border-box}
    html,body{margin:0;width:1200px;height:630px;overflow:hidden;color:${colours.ink};font-family:'Space Grotesk',sans-serif;
      background-color:${colours.paper};background-image:radial-gradient(#dcdad2 1.2px,transparent 1.2px);background-size:22px 22px}
    .stripe{display:grid;grid-template-columns:repeat(6,1fr);height:10px}
    .copy{position:absolute;left:64px;top:62px;width:470px}
    .brand{display:flex;align-items:center;gap:16px;font-size:40px;font-weight:700;letter-spacing:-0.03em}
    .brand svg{width:56px;height:56px}
    .chip{padding:5px 13px;border:2px solid ${colours.ink};border-radius:999px;background:#fff;font:400 18px 'JetBrains Mono',monospace;letter-spacing:0}
    h1{margin:42px 0 0;font-size:64px;line-height:1.03;letter-spacing:-0.04em;font-weight:700}
    mark{background:${colours.application};color:inherit;padding:0 0.14em;border-radius:0.16em}
    p{margin:24px 0 0;font-size:25px;line-height:1.4;color:#4a4a5c}
    .footer{position:absolute;left:64px;bottom:46px;display:flex;gap:14px;font-family:'JetBrains Mono',monospace;font-size:20px}
    .pill{padding:6px 14px;border:2px solid ${colours.ink};border-radius:999px;background:#fff}
    .panel{position:absolute;border:3px solid ${colours.ink};border-radius:22px;overflow:hidden;box-shadow:10px 10px 0 ${colours.ink}}
    .canvas{left:584px;top:44px;width:572px;height:400px;background-color:${colours.paper};
      background-image:radial-gradient(circle at 1px 1px,#d6d3c8 1.3px,transparent 1.4px);background-size:16px 16px}
    .diagram{position:absolute;left:148px;top:30px;width:400px}
    .diagram svg{position:static !important;display:block;width:100% !important;height:auto !important;max-width:none !important}
    .palette{left:556px;top:96px;width:150px;padding:12px;display:flex;flex-direction:column;gap:8px;background:#fff}
    .palette .title{font-size:15px;font-weight:700;margin-bottom:2px}
    .tile{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:11px;background:#f5f4ef;font-size:15px;font-weight:500}
    .icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px}
    .icon svg{width:17px;height:17px;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
    .code{left:716px;top:404px;width:440px;background:#14141c;color:#ecebe7}
    .bar{display:flex;align-items:center;gap:9px;padding:12px 18px;font:400 14px 'JetBrains Mono',monospace;color:#a9a9bb;border-bottom:1px solid #2a2a36}
    .dot{width:11px;height:11px;border-radius:999px;background:#ff92b8}
    pre{margin:0;padding:12px 0 16px;font:400 16px/27px 'JetBrains Mono',monospace;font-variant-ligatures:none;font-feature-settings:'calt' 0}
    .ln{display:block;padding:0 20px}
    .changed{background:rgba(195,182,255,0.2);box-shadow:inset 4px 0 0 #c3b6ff}
    .kw{color:#c3b6ff}.num{color:#f5d08a}.op{color:#ff92b8;font-weight:600}
  </style></head><body>
    <div class="stripe">${stripe}</div>
    <div class="copy">
      <div class="brand">${mark}Archimaid<span class="chip">Designer</span></div>
      <h1>Draw the architecture.<br><mark>Get&nbsp;the&nbsp;text.</mark></h1>
      <p>Drag ArchiMate® elements onto a canvas, and Archimaid writes the plain text. Nothing leaves your browser.</p>
    </div>
    <div class="footer"><span class="pill">try.archimaid.org</span><span class="pill">Free · open source</span></div>
    <div class="panel canvas"><div class="diagram">${diagram}</div></div>
    <div class="panel palette"><span class="title">Elements</span>${tiles}</div>
    <div class="panel code">
      <div class="bar"><span class="dot"></span>order-fulfilment.mmd</div>
      <pre><span class="ln">  <span class="kw">positions</span> {</span><span class="ln changed">    orders <span class="kw">at</span> <span class="num">10 8</span></span><span class="ln">    orders <span class="op">--&gt;</span> fulfil <span class="kw">from</span> <span class="num">T</span> <span class="kw">to</span> <span class="num">B</span></span></pre>
    </div>
  </body></html>`;
}

const server = await preview({ root: fileURLToPath(root), preview: { port: 0 }, logLevel: 'silent' });
const browser = await chromium.launch();
try {
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('The Vite preview server did not report a URL.');
  const diagram = await renderedStarterDiagram(browser, url);
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(socialPreviewPage(diagram), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(output, await page.screenshot({ type: 'png' }));
  console.log(`Social preview written to ${fileURLToPath(output)}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
