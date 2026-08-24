const normalized = value => String(value ?? '').normalize('NFKC').toLowerCase();

function snapshotCandidate(candidate) {
  return Object.freeze({
    id: String(candidate?.id ?? ''),
    type: String(candidate?.type ?? ''),
    label: String(candidate?.label ?? ''),
    value: String(candidate?.value ?? ''),
    description: String(candidate?.description ?? '')
  });
}

function snapshotRange(range) {
  const start = Number.isInteger(range?.[0]) ? Math.max(0, range[0]) : 0;
  const end = Number.isInteger(range?.[1]) ? Math.max(start, range[1]) : start;
  return Object.freeze([start, end]);
}

export function matchCandidates(query, candidates) {
  const needle = normalized(query);
  return Object.freeze((Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => {
      const snapshot = snapshotCandidate(candidate);
      const rank = normalized(snapshot.value).startsWith(needle)
        ? 0
        : normalized(snapshot.label).startsWith(needle) ? 1 : 2;
      return { snapshot, index, rank };
    })
    .filter(item => item.rank < 2)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(item => item.snapshot));
}

export function openCompletion(candidates, replacementRange) {
  const snapshots = Object.freeze((Array.isArray(candidates) ? candidates : []).map(snapshotCandidate));
  return Object.freeze({
    candidates: snapshots,
    activeIndex: snapshots.length > 0 ? 0 : -1,
    replacementRange: snapshotRange(replacementRange)
  });
}

export function cycleCompletion(state, direction = 1) {
  const count = Array.isArray(state?.candidates) ? state.candidates.length : 0;
  if (count === 0) return state;
  const step = direction < 0 ? -1 : 1;
  const current = Number.isInteger(state.activeIndex) ? state.activeIndex : -1;
  return Object.freeze({
    ...state,
    activeIndex: (current + step + count) % count
  });
}

export function confirmCompletion(input, state) {
  const source = String(input ?? '');
  const candidate = state?.candidates?.[state.activeIndex];
  if (!candidate) return { value: source, cursor: source.length };

  const [rawStart, rawEnd] = snapshotRange(state.replacementRange);
  const start = Math.min(source.length, rawStart);
  let end = Math.min(source.length, Math.max(start, rawEnd));
  const hasTrailingSeparator = end > start && /\s/u.test(source[end - 1]);
  if (hasTrailingSeparator) end -= 1;
  const suffix = hasTrailingSeparator
    ? ''
    : candidate.type === 'command' ? ' ' : candidate.type === 'directory' ? '/' : '';
  const replacement = `${candidate.value}${suffix}`;
  return {
    value: source.slice(0, start) + replacement + source.slice(end),
    cursor: start + replacement.length
  };
}
