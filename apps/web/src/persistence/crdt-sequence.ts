import type * as Y from "yjs";

export const uniqueSequence = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

// Reconcile a Y.Array without replacing the whole sequence, so each edit is
// a small positional operation instead of a full rewrite of the array.
export const reconcileSequence = (sequence: Y.Array<string>, desiredValues: readonly string[]) => {
  const desired = uniqueSequence(desiredValues);
  const desiredSet = new Set(desired);

  // Remove deleted ids and duplicate concurrent placements first.
  const seen = new Set<string>();
  let index = 0;
  while (index < sequence.length) {
    const value = sequence.get(index);
    if (!desiredSet.has(value) || seen.has(value)) sequence.delete(index, 1);
    else {
      seen.add(value);
      index++;
    }
  }

  // Move existing values with delete+insert and add missing values. Yjs gives
  // concurrent inserts at the same position a deterministic total order.
  for (let index = 0; index < desired.length; index++) {
    const wanted = desired[index];
    if (wanted === undefined) continue;
    if (sequence.get(index) === wanted) continue;
    const current = sequence.toArray();
    const existing = current.indexOf(wanted, index + 1);
    if (existing >= 0) sequence.delete(existing, 1);
    sequence.insert(index, [wanted]);
  }
  if (sequence.length > desired.length) {
    sequence.delete(desired.length, sequence.length - desired.length);
  }
};
