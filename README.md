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

Nesting new elements inside containers and moving elements between containers are not built yet; edit the text for those. Long-form relationships keep their type; change it in the text.

## Development

The designer needs `layout custom`, which is in archimaid 0.2.0. Until that version is published, `archimaid` is linked from a sibling checkout at `../Archimate for Mermaid`; build that checkout first (`npm run build` there).

```sh
npm install
npm run dev
npm test
npm run build
```

Code from the playground (`render.ts`, `editor.ts`, `syntax.ts`, `share.ts`, `storage.ts`, `export.ts`) is copied here for now; it can move into a shared package once both apps settle.

## Licence

MIT. ArchiMate® is a registered trademark of The Open Group. Archimaid is not affiliated with or endorsed by The Open Group.
