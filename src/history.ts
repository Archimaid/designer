const historyLimit = 200;

// Undo and redo over whole versions of the text, which is the designer's only document state.
export class History {
  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // Keeps the version an edit is about to replace; a new edit ends any redo.
  record(current: string): void {
    this.undoStack.push(current);
    if (this.undoStack.length > historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(current: string): string | undefined {
    const previous = this.undoStack.pop();
    if (previous !== undefined) this.redoStack.push(current);
    return previous;
  }

  redo(current: string): string | undefined {
    const next = this.redoStack.pop();
    if (next !== undefined) this.undoStack.push(current);
    return next;
  }
}

// The 1-based lines of `after` that `before` does not have, so the text panel can mark what an edit wrote.
export function changedLineNumbers(before: string, after: string): number[] {
  const remaining = new Map<string, number>();
  for (const line of before.split('\n')) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const changed: number[] = [];
  after.split('\n').forEach((line, index) => {
    const count = remaining.get(line) ?? 0;
    if (count > 0) remaining.set(line, count - 1);
    else if (line.trim()) changed.push(index + 1);
  });
  return changed;
}
