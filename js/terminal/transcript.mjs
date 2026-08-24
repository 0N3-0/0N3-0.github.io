export const TRANSCRIPT_LIMIT = 20;
const SETTLED = new Set(['completed', 'interrupted']);

function frozenSnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenSnapshot));
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, frozenSnapshot(item)])
  ));
}

function frozenEntry(value) {
  const entry = {
    id: value.id,
    prompt: Object.freeze({ ...value.prompt }),
    command: value.command,
    status: value.status,
    marker: value.marker
  };
  if (value.result !== undefined && value.result !== null) entry.result = frozenSnapshot(value.result);
  return Object.freeze(entry);
}

export function createTranscriptEntry({ id, submittedAt, cwdNodeId, command }) {
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('Transcript entry id is required');
  if (!Number.isFinite(submittedAt)) throw new TypeError('Transcript submittedAt must be finite');
  if (typeof cwdNodeId !== 'string' || cwdNodeId.length === 0) throw new TypeError('Transcript cwdNodeId is required');
  return frozenEntry({
    id,
    prompt: { submittedAt: new Date(submittedAt).toISOString(), cwdNodeId },
    command: String(command ?? ''),
    status: 'running',
    marker: null
  });
}

export function appendTranscript(entries, entry, limit = TRANSCRIPT_LIMIT) {
  if (!Array.isArray(entries)) throw new TypeError('Transcript entries must be an array');
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('Transcript limit must be positive');
  return Object.freeze([...entries, entry].slice(-limit));
}

export function settleTranscriptEntry(entries, entryId, { status, marker = null, result } = {}) {
  if (!Array.isArray(entries)) throw new TypeError('Transcript entries must be an array');
  if (!SETTLED.has(status)) throw new TypeError('Transcript settlement must be completed or interrupted');
  const index = entries.findIndex(entry => entry.id === entryId);
  if (index < 0) return entries;
  const next = [...entries];
  next[index] = frozenEntry({
    ...entries[index],
    status,
    marker: marker === null ? null : String(marker),
    ...(result === undefined ? {} : { result })
  });
  return Object.freeze(next);
}

export function clearTranscript() {
  return Object.freeze([]);
}
