// Prompt-only encoding. Preserve every field and number while transmitting
// repeated candidate trees once. Never merge by id: different degrees can
// attach different provenance to the same candidate id.
export function deduplicateWaveModelEvidence(theory) {
  const candidates = {};
  const keys = new Map();
  function reference(candidate) {
    if (!candidate) return candidate;
    const serialized = JSON.stringify(candidate);
    let ref = keys.get(serialized);
    if (!ref) {
      ref = `C${keys.size + 1}`;
      keys.set(serialized, ref);
      candidates[ref] = candidate;
    }
    return { candidateRef: ref };
  }
  function structures(value) {
    return {
      ...value,
      candidates: value.candidates.map(reference),
      primaryCandidate: reference(value.primaryCandidate),
      alternatives: value.alternatives.map(reference),
    };
  }
  function degree(value) {
    return value ? { ...value, structures: structures(value.structures) } : value;
  }
  const result = {
    ...theory,
    structures: structures(theory.structures),
    multiTimeframe: {
      ...theory.multiTimeframe,
      structure: degree(theory.multiTimeframe.structure),
      execution: degree(theory.multiTimeframe.execution),
    },
  };
  return {
    encoding: 'Each {candidateRef:"C1"} is the complete candidate in candidateCatalog.C1. References preserve ordering and degree. Select original candidate id values, never C1 keys. In user-facing prose use wave pattern names, not catalog aliases or internal ids. No evidence has been removed.',
    candidateCatalog: candidates,
    ...result,
  };
}
