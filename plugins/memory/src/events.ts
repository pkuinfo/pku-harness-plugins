/** The edit sheet tells the memory list to reload when it saved something. */
const listeners = new Set<() => void>();

export function onMemoryChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function memoryChanged() {
  listeners.forEach((l) => l());
}
