import {
  relationshipNames,
  type ArchiMateElement,
  type ArchiMateModel,
  type ArchiMateRelationship,
} from 'archimaid/language';
import { paletteType, tileIcon, type PaletteType } from './catalogue.ts';
import { sideNames } from './format.ts';
import { glyphOf, nameOf } from './model.ts';
import { readAnchor, readDescription, readRelationshipLine } from './source.ts';
import { ui } from './ui.ts';

const typeNames: ReadonlyMap<string, string> = new Map(Object.entries(relationshipNames));

// Fills the element and relationship inspectors and the phone's selection bar. Which of them shows is the
// selection's business; this only writes what they say.

// The icon takes the layer's colours, and so does the header around it.
function fillTypeIcon(icon: HTMLElement, headClass: string, type: PaletteType | undefined): void {
  const category = type?.category ?? 'composite';
  icon.className = `tile-icon t-${category}`;
  icon.replaceChildren(...(type ? tileIcon(type).childNodes : []));
  icon.closest(`.${headClass}`)?.setAttribute('class', `${headClass} t-${category}`);
}

export function renderSelectionBar(element: ArchiMateElement): void {
  const type = paletteType(element.type);
  fillTypeIcon(ui.barIcon, 'selection-head', type);
  ui.barName.textContent = element.name;
  ui.barType.textContent = `${type?.name ?? element.type} · ${element.id}`;
}

export function renderElementInspector(element: ArchiMateElement, model: ArchiMateModel, source: string): void {
  const type = paletteType(element.type);
  fillTypeIcon(ui.inspectorIcon, 'inspector-head', type);
  ui.inspectorType.textContent = type?.name ?? element.type;
  ui.inspectorId.textContent = element.id;
  // A field being typed in keeps its text until it is saved.
  if (document.activeElement !== ui.fieldName) ui.fieldName.value = element.name;
  if (document.activeElement !== ui.fieldDescription) ui.fieldDescription.value = readDescription(source, element.id);
  const rows = model.relationships
    .filter((relationship) => relationship.source === element.id || relationship.target === element.id)
    .map((relationship) => relationRow(model, element.id, relationship));
  ui.relationsSection.hidden = !rows.length;
  ui.relationsCount.textContent = String(rows.length);
  ui.relations.replaceChildren(...rows);
}

function relationRow(model: ArchiMateModel, id: string, relationship: ArchiMateRelationship): HTMLElement {
  const row = document.createElement('div');
  row.className = 'relation';
  const glyph = document.createElement('code');
  glyph.textContent = glyphOf(relationship);
  const text = document.createElement('span');
  const outgoing = relationship.source === id;
  const other = document.createElement('b');
  other.textContent = nameOf(model, outgoing ? relationship.target : relationship.source);
  text.append(outgoing ? 'to ' : 'from ', other);
  row.append(glyph, text);
  return row;
}

// A relationship is addressed by its place among the relationships, which survives edits that change its ID.
export function renderRelationshipInspector(
  relationship: ArchiMateRelationship,
  index: number,
  model: ArchiMateModel,
  source: string,
): void {
  const line = readRelationshipLine(source, index);
  const anchor = readAnchor(source, index);
  ui.relGlyph.textContent = glyphOf(relationship);
  ui.relType.textContent = `${typeNames.get(relationship.type) ?? relationship.type} relationship`;
  ui.relId.textContent = relationship.id;
  ui.relFrom.textContent = nameOf(model, relationship.source) + (anchor.from ? ` · ${sideNames[anchor.from]}` : '');
  ui.relTo.textContent = nameOf(model, relationship.target) + (anchor.to ? ` · ${sideNames[anchor.to]}` : '');
  if (document.activeElement !== ui.relLabel) ui.relLabel.value = relationship.label ?? '';
  ui.relRetype.disabled = line?.kind !== 'shorthand';
  ui.relRetype.dataset.tip = ui.relRetype.disabled ? 'Change the type of a long-form relationship in the text.' : '';
}
