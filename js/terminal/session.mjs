import { validateNavigationUrl } from './model.mjs';
import { TRANSCRIPT_LIMIT } from './transcript.mjs';

const RETURN_KEY = 'one-terminal:return:v1';
const MAX_DRAFT_CODE_POINTS = 4096;
const MAX_RECORD_BYTES = 16 * 1024;
const BUILD_ID = /^[0-9a-f]{16}$/u;
const RECORD_KEYS = Object.freeze([
  'activeItemId',
  'buildId',
  'createdAt',
  'cwdNodeId',
  'inputDraft',
  'nextEntryId',
  'route',
  'schemaVersion',
  'scrollTop',
  'targetArticleUrl',
  'terminalUrl',
  'transcript',
  'viewNodeId'
]);
const ROUTE_KINDS = new Set(['root', 'posts', 'archives', 'tags', 'categories', 'tag', 'category', 'document']);
const ENTRY_ID = /^entry:([1-9][0-9]*)$/u;
const SETTLED_STATUSES = new Set(['completed', 'interrupted']);

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === RECORD_KEYS.length && keys.every((key, index) => key === RECORD_KEYS[index]);
}

function nullableId(value) {
  return value === null || typeof value === 'string' && value.length > 0;
}

function hasExactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every(key => keys.includes(key))
    && keys.every(key => required.includes(key) || optional.includes(key));
}

function nonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function snapshotHelpCommands(value) {
  if (!Array.isArray(value)) return null;
  const commands = [];
  for (const command of value) {
    if (!hasExactKeys(command, ['name', 'aliases', 'usage', 'description'])
      || !nonBlankString(command.name)
      || !Array.isArray(command.aliases)
      || !command.aliases.every(nonBlankString)
      || typeof command.usage !== 'string'
      || typeof command.description !== 'string') return null;
    commands.push({
      name: command.name,
      aliases: [...command.aliases],
      usage: command.usage,
      description: command.description
    });
  }
  return commands;
}

function snapshotTranscriptResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.type === 'error') {
    return hasExactKeys(value, ['type', 'code', 'message'])
      && nonBlankString(value.code)
      && typeof value.message === 'string'
      ? { type: 'error', code: value.code, message: value.message }
      : null;
  }
  if (value.type !== 'render' || typeof value.view !== 'string') return null;
  if (value.view === 'about') {
    return hasExactKeys(value, ['type', 'view']) ? { type: 'render', view: 'about' } : null;
  }
  if (value.view === 'ls') {
    return hasExactKeys(value, ['type', 'view', 'viewNodeId']) && nonBlankString(value.viewNodeId)
      ? { type: 'render', view: 'ls', viewNodeId: value.viewNodeId }
      : null;
  }
  if (value.view === 'help') {
    const commands = snapshotHelpCommands(value.commands);
    return hasExactKeys(value, ['type', 'view', 'commands']) && commands !== null
      ? { type: 'render', view: 'help', commands }
      : null;
  }
  return null;
}

function snapshotTranscriptEntry(value, truncateCommand, settleRunning) {
  if (!hasExactKeys(value, ['id', 'prompt', 'command', 'status', 'marker'], ['result'])) return null;
  const match = typeof value.id === 'string' ? value.id.match(ENTRY_ID) : null;
  const status = value.status === 'running' && settleRunning ? 'completed' : value.status;
  if (!match
    || !Number.isSafeInteger(Number(match[1]))
    || !hasExactKeys(value.prompt, ['submittedAt', 'cwdNodeId'])
    || typeof value.prompt.submittedAt !== 'string'
    || !nonBlankString(value.prompt.cwdNodeId)
    || typeof value.command !== 'string'
    || !SETTLED_STATUSES.has(status)
    || value.status === 'running' && value.result !== undefined
    || !(value.marker === null || typeof value.marker === 'string')) return null;
  try {
    if (new Date(value.prompt.submittedAt).toISOString() !== value.prompt.submittedAt) return null;
  } catch {
    return null;
  }
  const result = value.result === undefined ? undefined : snapshotTranscriptResult(value.result);
  if (value.result !== undefined && result === null) return null;
  const command = truncateCommand
    ? [...value.command].slice(0, MAX_DRAFT_CODE_POINTS).join('')
    : value.command;
  return {
    id: value.id,
    prompt: { submittedAt: value.prompt.submittedAt, cwdNodeId: value.prompt.cwdNodeId },
    command,
    status,
    marker: value.marker,
    ...(result === undefined ? {} : { result })
  };
}

function snapshotTranscript(value, truncateCommand, settleRunning = false) {
  if (!Array.isArray(value) || !truncateCommand && value.length > TRANSCRIPT_LIMIT) return null;
  const entries = truncateCommand ? value.slice(-TRANSCRIPT_LIMIT) : value;
  const snapshot = [];
  const ids = new Set();
  for (const [index, entry] of entries.entries()) {
    const normalized = snapshotTranscriptEntry(
      entry,
      truncateCommand,
      settleRunning && index === entries.length - 1
    );
    if (!normalized || ids.has(normalized.id)) return null;
    ids.add(normalized.id);
    snapshot.push(normalized);
  }
  return snapshot;
}

function snapshotRoute(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (!keys.includes('kind') || keys.some(key => !['kind', 'viewNodeId', 'canonicalUrl', 'replace'].includes(key))) return null;
  if (!ROUTE_KINDS.has(value.kind)) return null;
  if (value.viewNodeId !== undefined && !nullableId(value.viewNodeId)) return null;
  if (value.canonicalUrl !== undefined && typeof value.canonicalUrl !== 'string') return null;
  if (value.replace !== undefined && typeof value.replace !== 'boolean') return null;
  const route = { kind: value.kind };
  if (value.viewNodeId !== undefined) route.viewNodeId = value.viewNodeId;
  if (value.canonicalUrl !== undefined) route.canonicalUrl = value.canonicalUrl;
  if (value.replace !== undefined) route.replace = value.replace;
  return route;
}

function snapshotRecord(value, truncateDraft) {
  if (!isRecord(value)) return null;
  const route = snapshotRoute(value.route);
  const transcript = snapshotTranscript(
    value.transcript,
    truncateDraft,
    truncateDraft && value.targetArticleUrl !== null
  );
  if (!route
    || transcript === null
    || !Number.isInteger(value.schemaVersion)
    || value.schemaVersion < 0
    || typeof value.buildId !== 'string'
    || !BUILD_ID.test(value.buildId)
    || !Number.isFinite(value.createdAt)
    || !Number.isInteger(value.createdAt)
    || value.createdAt < 0
    || typeof value.terminalUrl !== 'string'
    || !nullableId(value.cwdNodeId)
    || value.cwdNodeId === null
    || !nullableId(value.viewNodeId)
    || !nullableId(value.activeItemId)
    || !Number.isFinite(value.scrollTop)
    || value.scrollTop < 0
    || typeof value.inputDraft !== 'string'
    || !Number.isSafeInteger(value.nextEntryId)
    || value.nextEntryId < 1
    || !(value.targetArticleUrl === null || typeof value.targetArticleUrl === 'string')) {
    return null;
  }
  const newestEntryId = transcript.reduce((maximum, entry) => Math.max(maximum, Number(entry.id.slice(6))), 0);
  if (value.nextEntryId <= newestEntryId) return null;
  const inputDraft = truncateDraft
    ? [...value.inputDraft].slice(0, MAX_DRAFT_CODE_POINTS).join('')
    : value.inputDraft;
  return {
    schemaVersion: value.schemaVersion,
    buildId: value.buildId,
    createdAt: value.createdAt,
    terminalUrl: value.terminalUrl,
    route,
    cwdNodeId: value.cwdNodeId,
    viewNodeId: value.viewNodeId,
    activeItemId: value.activeItemId,
    scrollTop: value.scrollTop,
    inputDraft,
    transcript,
    nextEntryId: value.nextEntryId,
    targetArticleUrl: value.targetArticleUrl
  };
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function remove(storage) {
  try {
    storage.removeItem(RETURN_KEY);
    return true;
  } catch {
    // Storage can be unavailable in privacy modes; invalid data still fails closed.
    return false;
  }
}

export function hasReturnRecord(storage) {
  try {
    return Boolean(storage) && typeof storage.getItem(RETURN_KEY) === 'string';
  } catch {
    return false;
  }
}

export function writeReturnRecord(storage, record) {
  try {
    const snapshot = snapshotRecord(record, true);
    if (!snapshot) return false;
    let serialized = JSON.stringify(snapshot);
    while (byteLength(serialized) > MAX_RECORD_BYTES && snapshot.transcript.length > 0) {
      snapshot.transcript.shift();
      serialized = JSON.stringify(snapshot);
    }
    if (byteLength(serialized) > MAX_RECORD_BYTES) return false;
    storage.setItem(RETURN_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function readReturnRecord(storage, options) {
  let serialized;
  try {
    serialized = storage.getItem(RETURN_KEY);
  } catch {
    return null;
  }
  if (serialized === null) return null;

  try {
    if (typeof serialized !== 'string' || byteLength(serialized) > MAX_RECORD_BYTES) throw new Error('invalid record');
    const snapshot = snapshotRecord(JSON.parse(serialized), false);
    if (!snapshot) throw new Error('invalid record');
    const now = options.now;
    const ttlMs = options.ttlMs;
    const age = now - snapshot.createdAt;
    if (!Number.isFinite(now)
      || !Number.isFinite(ttlMs)
      || ttlMs < 0
      || age < 0
      || age > ttlMs
      || snapshot.schemaVersion !== options.schemaVersion
      || snapshot.buildId !== options.buildId) {
      throw new Error('invalid record');
    }
    const validation = { origin: options.origin, root: options.root };
    snapshot.terminalUrl = validateNavigationUrl(snapshot.terminalUrl, validation);
    if (snapshot.targetArticleUrl !== null) {
      snapshot.targetArticleUrl = validateNavigationUrl(snapshot.targetArticleUrl, validation);
    }
    return snapshot;
  } catch {
    remove(storage);
    return null;
  }
}

export function consumeReturnRecord(storage, options) {
  const record = readReturnRecord(storage, options);
  if (record === null) return null;
  let currentUrl;
  try {
    currentUrl = options.currentUrl;
    if (currentUrl !== undefined) {
      const normalizedCurrentUrl = validateNavigationUrl(currentUrl, {
        origin: options.origin,
        root: options.root
      });
      if (normalizedCurrentUrl !== record.terminalUrl) return null;
    }
  } catch {
    return null;
  }
  return remove(storage) ? record : null;
}
