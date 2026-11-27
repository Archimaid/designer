import { validateArchiMate, type ArchiMateDiagnostic, type ArchiMateModel } from 'archimaid/language';
import { History } from './history.ts';

// Typing is one history step per pause, not one per keystroke.
const typingMergeMs = 800;

export type CommitOutcome = 'applied' | 'unchanged' | 'refused';

function hasErrors(text: string): boolean {
  return validateArchiMate(text).diagnostics.some(({ severity }) => severity === 'error');
}

// The source text is the designer's only document state, with its undo history. The model is derived from
// it and is the last valid one, so the canvas keeps showing a diagram while the text is being fixed.
export class DiagramDocument {
  private text = '';
  private lastModel: ArchiMateModel | undefined;
  private problems: readonly ArchiMateDiagnostic[] = [];
  private readonly history = new History();
  private lastTyped = Number.NEGATIVE_INFINITY;

  get source(): string {
    return this.text;
  }

  get model(): ArchiMateModel | undefined {
    return this.lastModel;
  }

  get diagnostics(): readonly ArchiMateDiagnostic[] {
    return this.problems;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  // The text the designer starts with, which nothing can undo.
  load(text: string): void {
    this.text = text;
  }

  // A hand edit in the text panel, at the given time in milliseconds.
  type(text: string, now: number): void {
    if (now - this.lastTyped > typingMergeMs) this.history.record(this.text);
    this.lastTyped = now;
    this.text = text;
  }

  // An edit from the canvas. It never turns valid text into invalid text; a refused edit changes nothing.
  commit(next: string): CommitOutcome {
    if (next === this.text) return 'unchanged';
    if (hasErrors(next) && !hasErrors(this.text)) return 'refused';
    this.replace(next);
    return 'applied';
  }

  // Replaces the whole text in one undo step, valid or not, as opening a diagram does. Typing after it starts
  // a step of its own, so one undo never takes back this edit together with the typing.
  replace(next: string): void {
    this.history.record(this.text);
    this.text = next;
    this.lastTyped = Number.NEGATIVE_INFINITY;
  }

  undo(): boolean {
    const previous = this.history.undo(this.text);
    if (previous === undefined) return false;
    this.text = previous;
    return true;
  }

  redo(): boolean {
    const next = this.history.redo(this.text);
    if (next === undefined) return false;
    this.text = next;
    return true;
  }

  validate(): void {
    const result = validateArchiMate(this.text);
    this.problems = result.diagnostics;
    if (result.model) this.lastModel = result.model;
  }
}
