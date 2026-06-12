export class HistoryStack {
  constructor(limit = 250) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  snapshot(document) {
    this.undoStack.push(structuredClone(document));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(currentDocument) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(structuredClone(currentDocument));
    return this.undoStack.pop();
  }

  redo(currentDocument) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(structuredClone(currentDocument));
    return this.redoStack.pop();
  }
}
