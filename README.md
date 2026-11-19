# Archimaid Designer

Draw ArchiMate® 3.2 diagrams by dragging elements onto a canvas, and watch [Archimaid](https://archimaid.org) write the plain text. Planned for design.archimaid.org, next to the [playground](https://try.archimaid.org).

The text is the only document state. Every gesture is a small edit to the `archimate-beta` source, so the text panel, undo, share links and the renderer always agree, and the result works anywhere Archimaid does.

## What you can do

- Drag an element type from the palette onto the canvas and type its name. The ID follows the name until you change it yourself.
- Drag elements to move them. In custom layout this writes `id at x y` in the `positions` block; in auto layout the first move pins every element where it is and switches to custom layout.
- Drag the edges or corners of a selected element to resize it, which writes `size WxH`; the round handles in the middle of each edge start a relationship instead. An element never shrinks below the size its name needs.
- Move elements anywhere: placing one above or left of the others shifts every position to make room.
- Select an element to edit its name and description. Leaving a field or the element saves to the text.
- Drag from a selection handle to another element and pick the relationship type, with one key per type.
- Click a relationship to select it. Drag either end onto another element to reconnect it, or onto a side of its own element to pin that side (`from` and `to` in the `positions` block). Change its type, add a label, or delete it.
- Delete with the Delete key, rename with Enter or a double-click, undo with ⌘Z.
- Open the text panel to read or edit the source. Lines the canvas just wrote are highlighted.
- Elements without a position wait in the Unplaced tray until you drag them in.
- Export SVG, PNG or `.mmd`, share a link, or open the diagram in the playground.

On a phone the canvas fills the screen with a Canvas | Text switch at the top. Tap Add element and then a type to place it in the middle of the view. Tap an element to select it, which opens a short action bar; Details opens its name and description in a full-width sheet. One finger pans, two fingers zoom, and a selected element can be dragged, resized or connected from its larger handles.

Nesting new elements inside containers and moving elements between containers are not built yet; edit the text for those. Long-form relationships keep their type; change it in the text.

## Development

The designer needs `layout custom`, which archimaid has since 0.2.0, and installs `archimaid` from npm.

```sh
npm install
npm run dev
npm test
npm run build
npm run og
```

`npm run og` renders `public/og.png`, the social preview, from the built designer with Playwright; run it after changing the starter diagram or the look, and commit the image. It needs Playwright's Chromium (`npx playwright install chromium`).

Code from the playground (`render.ts`, `editor.ts`, `syntax.ts`, `share.ts`, `storage.ts`, `export.ts`) is copied here for now; it can move into a shared package once both apps settle.

## Deploy to Cloudflare

The designer deploys as a Cloudflare Worker that serves static files, like the playground. `wrangler.jsonc` points Wrangler at `dist`. Connect the repository to a Worker named `archimaid-designer` with these build settings:

| Setting               | Value                      |
| --------------------- | -------------------------- |
| Path (root directory) | empty, the repository root |
| Build command         | `npm ci && npm run build`  |
| Deploy command        | `npx wrangler deploy`      |
| Environment variable  | `NODE_VERSION=24`          |

Then add `design.archimaid.org` as a custom domain.

## Licence

MIT. ArchiMate® is a registered trademark of The Open Group. Archimaid is not affiliated with or endorsed by The Open Group.
