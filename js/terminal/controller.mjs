import {
  cycleCompletion,
  confirmCompletion,
  matchCandidates,
  openCompletion
} from './completion.mjs';
import { ExecutionManager } from './execution.mjs';
import { parseCommand } from './parser.mjs';
import { writeReturnRecord } from './session.mjs';
import { isDirectoryNode } from './tree.mjs';
import {
  appendTranscript,
  clearTranscript,
  createTranscriptEntry,
  settleTranscriptEntry
} from './transcript.mjs';

const HISTORY_KEY = 'one-terminal:history:v1';
const THEME_KEY = 'theme';
const HISTORY_LIMIT = 100;
const BUILD_ID = /^[0-9a-f]{16}$/u;
const ROOT_ROUTE = Object.freeze({ kind: 'root', canonicalUrl: '/' });
const ROUTE_FIELDS = Object.freeze([
  'kind',
  'canonicalUrl',
  'viewNodeId',
  'parentViewNodeId',
  'replace'
]);
const STABLE_ACTIONS = new Set([
  'INDEX_READY',
  'OPEN_ROUTE',
  'POP_ROUTE',
  'QUIT_LIST',
  'ESCAPE',
  'CONFIRM_COMPLETION',
  'HISTORY_MOVE',
  'MOVE_ACTIVE',
  'RESTORE',
  'SET_ACTIVE',
  'SET_INPUT'
]);
const RENDER_VIEWS = new Set(['help', 'ls', 'about', 'posts', 'archives', 'tags', 'categories', 'tag', 'category']);
const NODE_OWNED_VIEWS = new Set(['ls', 'posts', 'tags', 'categories', 'tag', 'category']);
const HISTORICAL_VIEWS = new Set(['help', 'ls', 'about']);
const INVALID_RESULT = Object.freeze({
  type: 'error',
  code: 'INVALID_RESULT',
  message: 'Command returned an invalid result.'
});

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

function snapshotRoute(route, fallback = ROOT_ROUTE) {
  const source = route && typeof route === 'object' ? route : fallback;
  const snapshot = {};
  for (const field of ROUTE_FIELDS) {
    const value = source[field];
    if (value !== undefined) snapshot[field] = value;
  }
  snapshot.kind = typeof snapshot.kind === 'string' && snapshot.kind ? snapshot.kind : fallback.kind;
  snapshot.canonicalUrl = typeof snapshot.canonicalUrl === 'string' && snapshot.canonicalUrl
    ? snapshot.canonicalUrl
    : fallback.canonicalUrl;
  if (snapshot.viewNodeId !== undefined && snapshot.viewNodeId !== null) snapshot.viewNodeId = String(snapshot.viewNodeId);
  if (snapshot.parentViewNodeId !== undefined && snapshot.parentViewNodeId !== null) snapshot.parentViewNodeId = String(snapshot.parentViewNodeId);
  if (snapshot.replace !== undefined) snapshot.replace = Boolean(snapshot.replace);
  return deepFreeze(snapshot);
}

function routePresentation(route) {
  if (route.kind === 'root') return { foreground: null, output: null };
  const phase = route.kind === 'document' ? 'settled' : 'interactive';
  return {
    foreground: phase === 'interactive'
      ? Object.freeze({ runId: 'route', entryId: null, kind: 'route' })
      : null,
    output: Object.freeze({
      ownerId: null,
      phase,
      result: Object.freeze({ type: 'render', view: route.kind, viewNodeId: route.viewNodeId ?? null })
    })
  };
}

function routeResult(route) {
  return Object.freeze({ type: 'render', view: route.kind, viewNodeId: route.viewNodeId ?? null });
}

function isInteractive(state) {
  return state.foreground?.kind === 'interactive' || state.foreground?.kind === 'route';
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze([...new Set(value.filter(item => typeof item === 'string' && item.length > 0))]);
}

function emptyHistory(entries = []) {
  const snapshot = Object.freeze(entries.slice(-HISTORY_LIMIT));
  return deepFreeze({ entries: snapshot, cursor: snapshot.length, draft: '' });
}

function normalizeStoredHistory(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || result.at(-1) === item) continue;
    result.push(item);
  }
  return result.slice(-HISTORY_LIMIT);
}

function readHistory(storage) {
  if (!storage) return [];
  try {
    const serialized = storage.getItem(HISTORY_KEY);
    return serialized === null ? [] : normalizeStoredHistory(JSON.parse(serialized));
  } catch {
    return [];
  }
}

function writeHistory(storage, entries) {
  if (!storage) return;
  try { storage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch { /* Storage is optional. */ }
}

function normalizeColorMode(value) {
  return value === 'light' ? 'light' : 'dark';
}

function readColorMode(storage) {
  if (!storage) return 'dark';
  try { return normalizeColorMode(storage.getItem(THEME_KEY)); } catch { return 'dark'; }
}

function writeColorMode(storage, mode) {
  if (!storage) return;
  try { storage.setItem(THEME_KEY, normalizeColorMode(mode)); } catch { /* Storage is optional. */ }
}

function baseInitialState(route) {
  const currentRoute = snapshotRoute(route);
  const presentation = routePresentation(currentRoute);
  return {
    schemaVersion: Number.isInteger(route?.schemaVersion) ? route.schemaVersion : 1,
    initialized: false,
    route: currentRoute,
    returnRoute: snapshotRoute(route?.returnRoute, currentRoute.kind === 'root' ? currentRoute : ROOT_ROUTE),
    cwdNodeId: 'dir:root',
    viewNodeId: currentRoute.viewNodeId ?? (currentRoute.kind === 'root' ? 'dir:root' : null),
    activeItemId: null,
    validItemIds: Object.freeze([]),
    input: { value: '', selectionStart: 0, selectionEnd: 0, isComposing: false },
    completion: null,
    indexStatus: 'idle',
    indexError: null,
    colorMode: 'dark',
    buildId: null,
    targetArticleUrl: null,
    restore: { focusTarget: null, scrollTop: 0 },
    commandHistory: emptyHistory(),
    transcript: clearTranscript(),
    foreground: presentation.foreground,
    output: presentation.output,
    nextEntryId: 1
  };
}

export function createInitialState(route) {
  return deepFreeze(baseInitialState(route));
}

function routeState(state, route, { preserveReturn = true, routeOwned = false } = {}) {
  const nextRoute = snapshotRoute(route);
  const fallbackView = nextRoute.kind === 'root' ? 'dir:root' : null;
  const nextReturn = route?.returnRoute
    ? snapshotRoute(route.returnRoute)
    : preserveReturn ? state.returnRoute : state.route;
  const base = {
    ...state,
    route: nextRoute,
    returnRoute: nextReturn,
    viewNodeId: nextRoute.viewNodeId !== undefined ? nextRoute.viewNodeId : fallbackView,
    activeItemId: null,
    completion: null,
    targetArticleUrl: null
  };
  if (!routeOwned && state.foreground?.kind === 'interactive') {
    return {
      ...base,
      output: state.output
        ? { ...state.output, result: routeResult(nextRoute) }
        : { ownerId: state.foreground.entryId, phase: 'interactive', result: routeResult(nextRoute) }
    };
  }
  return { ...base, ...routePresentation(nextRoute) };
}

function setInput(state, action) {
  if (state.foreground) return state;
  const value = String(action.value ?? '');
  const start = Number.isInteger(action.selectionStart) ? action.selectionStart : value.length;
  const end = Number.isInteger(action.selectionEnd) ? action.selectionEnd : start;
  const base = value.length > 0 ? closeSettledOutput(state) : state;
  return {
    ...base,
    completion: null,
    input: {
      ...state.input,
      value,
      selectionStart: Math.max(0, Math.min(value.length, start)),
      selectionEnd: Math.max(0, Math.min(value.length, end))
    }
  };
}

function closeSettledOutput(state) {
  return state.output?.phase === 'settled' ? { ...state, output: null } : state;
}

function historyMove(state, direction) {
  const history = state.commandHistory;
  if (history.entries.length === 0) return state;
  let draft = history.draft;
  if (history.cursor === history.entries.length) draft = state.input.value;
  const cursor = Math.max(0, Math.min(history.entries.length, history.cursor + direction));
  const value = cursor === history.entries.length ? draft : history.entries[cursor];
  const base = closeSettledOutput(state);
  return {
    ...base,
    completion: null,
    input: { ...state.input, value, selectionStart: value.length, selectionEnd: value.length },
    commandHistory: deepFreeze({ entries: history.entries, cursor, draft })
  };
}

function matchingForeground(state, runId) {
  return state.foreground?.runId === runId;
}

function nonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeHelpCommands(commands) {
  if (!Array.isArray(commands)) return null;
  const snapshot = [];
  for (const command of commands) {
    if (!command || typeof command !== 'object' || Array.isArray(command)
      || !nonBlankString(command.name)
      || !Array.isArray(command.aliases)
      || !command.aliases.every(nonBlankString)
      || typeof command.usage !== 'string'
      || typeof command.description !== 'string') return null;
    snapshot.push({
      name: command.name,
      aliases: [...command.aliases],
      usage: command.usage,
      description: command.description
    });
  }
  return snapshot;
}

function normalizeResult(result) {
  try {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return INVALID_RESULT;
    if (result.type === 'error') {
      return nonBlankString(result.code) && typeof result.message === 'string'
        ? deepFreeze({ type: 'error', code: result.code, message: result.message })
        : INVALID_RESULT;
    }
    if (result.type === 'navigate') {
      const targetValid = result.targetId === undefined
        || result.targetId === null
        || nonBlankString(result.targetId);
      if (!nonBlankString(result.url) || !targetValid) return INVALID_RESULT;
      return deepFreeze({
        type: 'navigate',
        url: result.url,
        ...(result.targetId === undefined ? {} : { targetId: result.targetId })
      });
    }
    if (result.type === 'render') {
      if (typeof result.view !== 'string' || !RENDER_VIEWS.has(result.view)) return INVALID_RESULT;
      const commands = result.view === 'help' ? normalizeHelpCommands(result.commands) : null;
      if (result.view === 'help' && commands === null) return INVALID_RESULT;
      const nodeOwned = NODE_OWNED_VIEWS.has(result.view);
      if (nodeOwned && !nonBlankString(result.viewNodeId)) return INVALID_RESULT;
      if (!nodeOwned && result.viewNodeId !== undefined) return INVALID_RESULT;
      return deepFreeze({
        type: 'render',
        view: result.view,
        ...(nodeOwned ? { viewNodeId: result.viewNodeId } : {}),
        ...(commands === null ? {} : { commands })
      });
    }
    if (result.type === 'cwd') {
      return nonBlankString(result.cwdNodeId)
        ? deepFreeze({ type: 'cwd', cwdNodeId: result.cwdNodeId })
        : INVALID_RESULT;
    }
    if (result.type === 'theme') {
      return ['dark', 'light'].includes(result.mode) && Object.keys(result).length === 2
        ? deepFreeze({ type: 'theme', mode: result.mode })
        : INVALID_RESULT;
    }
    if (result.type === 'clear' && Object.keys(result).length === 1) {
      return deepFreeze({ type: 'clear' });
    }
  } catch {
    return INVALID_RESULT;
  }
  return INVALID_RESULT;
}

function completeRun(state, action, status = 'completed') {
  if (!matchingForeground(state, action.runId)) return state;
  const keepsHistoricalResult = action.result?.type === 'error'
    || (action.result?.type === 'render' && HISTORICAL_VIEWS.has(action.result.view));
  const historicalResult = keepsHistoricalResult ? action.result : null;
  return {
    ...state,
    transcript: settleTranscriptEntry(state.transcript, state.foreground.entryId, {
      status,
      marker: action.marker ?? null,
      ...(historicalResult ? { result: historicalResult } : {})
    }),
    foreground: null,
    output: action.result && !historicalResult
      ? { ownerId: state.foreground.entryId, phase: 'settled', result: action.result }
      : null
  };
}

function settleForeground(state, action, status) {
  if (!matchingForeground(state, action.runId)) return state;
  const route = snapshotRoute(action.route, state.returnRoute);
  const output = status === 'interrupted'
    ? null
    : state.output
    ? { ...state.output, phase: 'settled' }
    : null;
  const restoredTranscript = state.foreground.entryId
    && action.clearedEntry?.id === state.foreground.entryId
    && !state.transcript.some(entry => entry.id === state.foreground.entryId)
    ? appendTranscript(state.transcript, action.clearedEntry)
    : state.transcript;
  return {
    ...state,
    route,
    viewNodeId: route.viewNodeId ?? (route.kind === 'root' ? 'dir:root' : null),
    activeItemId: null,
    completion: null,
    targetArticleUrl: null,
    transcript: state.foreground.entryId
      ? settleTranscriptEntry(restoredTranscript, state.foreground.entryId, { status, marker: action.marker ?? null })
      : restoredTranscript,
    foreground: null,
    output
  };
}

function reduce(state, action) {
  switch (action?.type) {
    case 'INIT_ROUTE': {
      if (state.initialized) return { state, effects: [] };
      const next = action.route ? routeState(state, action.route, { routeOwned: true }) : state;
      return { state: { ...next, initialized: true }, effects: [{ type: 'HISTORY_REPLACE' }] };
    }
    case 'COMPOSITION_START':
      return { state: { ...state, input: { ...state.input, isComposing: true } }, effects: [] };
    case 'COMPOSITION_END':
      return { state: { ...state, input: { ...state.input, isComposing: false } }, effects: [] };
    case 'SET_INPUT':
      return { state: setInput(state, action), effects: [] };
    case 'HISTORY_COMMIT': {
      const value = String(action.value ?? '');
      const entries = [...state.commandHistory.entries];
      if (value.trim() && entries.at(-1) !== value) entries.push(value);
      return { state: { ...state, commandHistory: emptyHistory(entries) }, effects: value.trim() ? [{ type: 'SAVE_HISTORY' }] : [] };
    }
    case 'OPEN_COMPLETION':
      return {
        state: { ...state, completion: openCompletion(action.candidates, action.replacementRange) },
        effects: []
      };
    case 'CYCLE_COMPLETION':
      return state.completion
        ? { state: { ...state, completion: cycleCompletion(state.completion, action.direction) }, effects: [] }
        : { state, effects: [] };
    case 'CONFIRM_COMPLETION': {
      if (!state.completion) return { state, effects: [] };
      const confirmed = confirmCompletion(state.input.value, state.completion);
      const base = closeSettledOutput(state);
      return {
        state: {
          ...base,
          completion: null,
          input: { ...state.input, value: confirmed.value, selectionStart: confirmed.cursor, selectionEnd: confirmed.cursor }
        },
        effects: []
      };
    }
    case 'CLOSE_COMPLETION':
      return state.completion ? { state: { ...state, completion: null }, effects: [] } : { state, effects: [] };
    case 'OPEN_ROUTE':
      return { state: routeState(state, action.route), effects: [{ type: 'HISTORY_PUSH' }] };
    case 'POP_ROUTE': {
      let next = routeState(state, action.route, { routeOwned: true });
      const historyState = action.historyState;
      if (historyState && historyState.schemaVersion === state.schemaVersion) {
        const valid = next.validItemIds;
        const active = valid.includes(historyState.activeItemId) ? historyState.activeItemId : valid[0] || null;
        next = {
          ...next,
          viewNodeId: historyState.viewNodeId ?? next.viewNodeId,
          activeItemId: active,
          restore: { ...next.restore, scrollTop: Math.max(0, Number(historyState.scrollTop) || 0) }
        };
      }
      return { state: next, effects: [] };
    }
    case 'SET_ACTIVE': {
      const requested = action.itemId ?? null;
      const itemId = requested === null || state.validItemIds.length === 0 || state.validItemIds.includes(requested)
        ? requested
        : state.validItemIds[0] || null;
      return {
        state: {
          ...state,
          activeItemId: itemId,
          restore: { ...state.restore, scrollTop: action.scrollTop === undefined ? state.restore.scrollTop : Math.max(0, Number(action.scrollTop) || 0) }
        },
        effects: []
      };
    }
    case 'ESCAPE':
      if (state.completion) return reduce(state, { type: 'CLOSE_COMPLETION' });
      return isInteractive(state) ? { state: routeState(state, state.returnRoute), effects: [] } : { state, effects: [] };
    case 'QUIT_LIST':
      return isInteractive(state) ? { state: routeState(state, state.returnRoute), effects: [] } : { state, effects: [] };
    case 'INDEX_LOADING':
      return { state: { ...state, indexStatus: 'loading', indexError: null }, effects: [] };
    case 'INDEX_READY': {
      const validItemIds = normalizeIds(action.validItemIds);
      const activeItemId = validItemIds.includes(state.activeItemId) ? state.activeItemId : validItemIds[0] || null;
      return {
        state: {
          ...state,
          indexStatus: 'ready',
          indexError: null,
          buildId: BUILD_ID.test(action.buildId || '') ? action.buildId : state.buildId,
          validItemIds,
          activeItemId
        },
        effects: []
      };
    }
    case 'INDEX_ERROR':
      return { state: { ...state, indexStatus: 'error', indexError: String(action.error || 'unknown') }, effects: [] };
    case 'START_COMMAND': {
      const value = String(action.command ?? '');
      const entries = [...state.commandHistory.entries];
      if (value.trim() && entries.at(-1) !== value) entries.push(value);
      const base = closeSettledOutput(state);
      return {
        state: {
          ...base,
          transcript: appendTranscript(state.transcript, createTranscriptEntry({
            id: action.entryId,
            submittedAt: action.submittedAt,
            cwdNodeId: state.cwdNodeId,
            command: value
          })),
          foreground: { runId: action.runId, entryId: action.entryId, kind: 'command' },
          completion: null,
          validItemIds: Object.freeze([]),
          activeItemId: null,
          commandHistory: emptyHistory(entries),
          nextEntryId: state.nextEntryId + 1,
          input: { ...state.input, value: '', selectionStart: 0, selectionEnd: 0 }
        },
        effects: value.trim() ? [{ type: 'SAVE_HISTORY' }] : []
      };
    }
    case 'SUBMIT_EMPTY': {
      const entryId = action.entryId;
      const entry = createTranscriptEntry({
        id: entryId,
        submittedAt: action.submittedAt,
        cwdNodeId: state.cwdNodeId,
        command: String(action.command ?? '')
      });
      return {
        state: {
          ...state,
          transcript: settleTranscriptEntry(appendTranscript(state.transcript, entry), entryId, { status: 'completed' }),
          completion: null,
          output: state.output?.phase === 'settled' ? null : state.output,
          nextEntryId: state.nextEntryId + 1,
          input: { ...state.input, value: '', selectionStart: 0, selectionEnd: 0 }
        },
        effects: []
      };
    }
    case 'RESOLVE_RUN': {
      if (!matchingForeground(state, action.runId)) return { state, effects: [] };
      const result = normalizeResult(action.result);
      if (result.type === 'render') {
        if (HISTORICAL_VIEWS.has(result.view)) {
          return { state: completeRun(state, { ...action, result }), effects: [] };
        }
        return {
          state: {
            ...state,
            foreground: { runId: action.runId, entryId: state.foreground.entryId, kind: 'interactive' },
            output: { ownerId: state.foreground.entryId, phase: 'interactive', result },
            viewNodeId: result.viewNodeId ?? state.viewNodeId
          },
          effects: []
        };
      }
      if (result.type === 'clear') {
        return {
          state: { ...state, transcript: clearTranscript(), foreground: null, output: null, completion: null, activeItemId: null },
          effects: []
        };
      }
      if (result.type === 'cwd') {
        const completed = completeRun(state, { ...action, result: null });
        return {
          state: { ...completed, cwdNodeId: result.cwdNodeId },
          effects: [{ type: 'WRITE_RETURN' }]
        };
      }
      if (result.type === 'theme') {
        return {
          state: { ...completeRun(state, { ...action, result: null }), colorMode: result.mode },
          effects: [{ type: 'APPLY_THEME', mode: result.mode }]
        };
      }
      return { state: completeRun(state, { ...action, result }), effects: [] };
    }
    case 'REJECT_RUN':
      if (!matchingForeground(state, action.runId)) return { state, effects: [] };
      if (action.aborted) return {
        state: completeRun(state, { ...action, marker: '^C' }, 'interrupted'),
        effects: []
      };
      return {
        state: completeRun(state, {
          ...action,
          result: {
            type: 'error',
            code: 'COMMAND_FAILED',
            message: action.error?.message || 'Command failed.'
          }
        }),
        effects: []
      };
    case 'SET_INTERACTIVE':
      if (!matchingForeground(state, action.runId) && state.foreground?.runId !== 'route') return { state, effects: [] };
      return {
        state: {
          ...state,
          foreground: { runId: action.runId, entryId: action.entryId, kind: 'interactive' },
          output: { ownerId: action.entryId, phase: 'interactive', result: action.result },
          viewNodeId: action.result?.viewNodeId ?? state.viewNodeId
        },
        effects: []
      };
    case 'COMPLETE_RUN':
      return { state: completeRun(state, action), effects: [] };
    case 'INTERRUPT_RUN':
      return { state: completeRun(state, action, 'interrupted'), effects: [] };
    case 'INTERRUPT_PROMPT': {
      const entry = createTranscriptEntry({
        id: action.entryId,
        submittedAt: action.submittedAt,
        cwdNodeId: state.cwdNodeId,
        command: state.input.value
      });
      return {
        state: {
          ...state,
          transcript: settleTranscriptEntry(appendTranscript(state.transcript, entry), action.entryId, { status: 'interrupted', marker: '^C' }),
          completion: null,
          foreground: null,
          output: null,
          input: { ...state.input, value: '', selectionStart: 0, selectionEnd: 0 },
          nextEntryId: state.nextEntryId + 1
        },
        effects: []
      };
    }
    case 'SETTLE_FOREGROUND':
      return {
        state: settleForeground(state, action, action.status),
        effects: matchingForeground(state, action.runId) ? [{ type: 'HISTORY_PUSH' }] : []
      };
    case 'CLEAR_SCREEN':
      if (action.runId && !matchingForeground(state, action.runId)) return { state, effects: [] };
      if (action.preserveForeground) {
        return {
          state: { ...state, transcript: clearTranscript(), completion: null, output: state.output, foreground: state.foreground },
          effects: []
        };
      }
      return { state: { ...state, transcript: clearTranscript(), foreground: null, output: null, completion: null, activeItemId: null }, effects: [] };
    case 'HISTORY_MOVE':
      return { state: historyMove(state, action.direction < 0 ? -1 : 1), effects: [] };
    case 'MOVE_ACTIVE': {
      const ids = state.validItemIds;
      if (ids.length === 0) return { state, effects: [] };
      const current = Math.max(0, ids.indexOf(state.activeItemId));
      const index = (current + (action.direction < 0 ? -1 : 1) + ids.length) % ids.length;
      return { state: { ...state, activeItemId: ids[index] }, effects: [] };
    }
    case 'REFRESH_RETURN_RECORD':
      return {
        state: {
          ...state,
          buildId: typeof action.buildId === 'string' ? action.buildId : state.buildId,
          targetArticleUrl: action.targetArticleUrl === undefined ? state.targetArticleUrl : action.targetArticleUrl
        },
        effects: [{ type: 'WRITE_RETURN' }]
      };
    case 'RESTORE': {
      const record = action.record && typeof action.record === 'object' ? action.record : {};
      const validItemIds = normalizeIds(action.validItemIds ?? state.validItemIds);
      const restoredId = validItemIds.includes(record.activeItemId) ? record.activeItemId : validItemIds[0] || null;
      const route = action.route || record.route;
      const routed = route ? routeState(state, route, { routeOwned: true }) : state;
      const inputDraft = typeof record.inputDraft === 'string' ? record.inputDraft : state.input.value;
      return {
        state: {
          ...routed,
          cwdNodeId: typeof record.cwdNodeId === 'string' ? record.cwdNodeId : state.cwdNodeId,
          viewNodeId: record.viewNodeId ?? routed.viewNodeId,
          activeItemId: restoredId,
          validItemIds,
          buildId: BUILD_ID.test(record.buildId || '') ? record.buildId : state.buildId,
          targetArticleUrl: null,
          input: { ...state.input, value: inputDraft, selectionStart: inputDraft.length, selectionEnd: inputDraft.length },
          transcript: Array.isArray(record.transcript) ? record.transcript : state.transcript,
          nextEntryId: Number.isSafeInteger(record.nextEntryId) && record.nextEntryId > 0
            ? Math.max(state.nextEntryId, record.nextEntryId)
            : state.nextEntryId,
          restore: { ...state.restore, scrollTop: Math.max(0, Number(record.scrollTop) || 0) }
        },
        effects: []
      };
    }
    default:
      return { state, effects: [] };
  }
}

function routeRecord(route) {
  const result = { kind: route.kind };
  if (route.viewNodeId !== undefined) result.viewNodeId = route.viewNodeId;
  if (route.canonicalUrl !== undefined) result.canonicalUrl = route.canonicalUrl;
  if (route.replace !== undefined) result.replace = route.replace;
  return result;
}

function viewUrl(state, view, routes) {
  if (routes?.[view]) return routes[view];
  const root = state.returnRoute?.canonicalUrl || state.route?.canonicalUrl || '/';
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return `${prefix}${view}/`;
}

export class TerminalController {
  #state;
  #adapters;
  #execution;
  #listeners = new Set();
  #returnFrame = null;
  #clearedForeground = null;

  constructor(initialState, adapters = {}) {
    const localStorage = adapters.localStorage ?? adapters.storage ?? null;
    const sessionStorage = adapters.sessionStorage ?? adapters.storage ?? null;
    const commandHistory = emptyHistory(readHistory(localStorage));
    const colorMode = readColorMode(localStorage);
    this.#state = deepFreeze({ ...initialState, commandHistory, colorMode });
    this.#adapters = Object.freeze({ ...adapters, localStorage, sessionStorage });
    this.#execution = new ExecutionManager({ AbortControllerImpl: adapters.AbortController });
  }

  get state() { return this.#state; }

  get adapters() { return this.#adapters; }

  dispatch(action) {
    if (action?.type === 'POP_ROUTE') this.#interruptForegroundForRoute();
    if (action?.type === 'CLEAR_SCREEN' && action.preserveForeground && this.#state.foreground?.entryId) {
      const foreground = this.#state.foreground;
      const entry = this.#state.transcript.find(value => value.id === foreground.entryId);
      if (entry) this.#clearedForeground = Object.freeze({ runId: foreground.runId, entry });
    }
    const transition = reduce(this.#state, action);
    this.#state = deepFreeze(transition.state);
    if (this.#clearedForeground
      && this.#state.foreground?.runId !== this.#clearedForeground.runId) this.#clearedForeground = null;
    for (const listener of [...this.#listeners]) {
      try { listener(this.#state, action); } catch { /* A listener cannot break the owner. */ }
    }
    for (const effect of transition.effects) this.#runEffect(effect);
    if (STABLE_ACTIONS.has(action?.type) && action.type !== 'REFRESH_RETURN_RECORD') this.#scheduleReturnRecord();
    return this.#state;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  historySnapshot() {
    return deepFreeze({
      schemaVersion: this.#state.schemaVersion,
      route: snapshotRoute(this.#state.route),
      returnRoute: snapshotRoute(this.#state.returnRoute),
      viewNodeId: this.#state.viewNodeId,
      activeItemId: this.#state.activeItemId,
      scrollTop: this.#state.restore.scrollTop
    });
  }

  dispose() {
    this.#cancelReturnFrame();
    this.#execution.dispose();
    this.#listeners.clear();
    this.#clearedForeground = null;
  }

  handleKey(event = {}) {
    if (event.isComposing || this.#state.input.isComposing) return false;
    const key = event.key;
    const interactive = isInteractive(this.#state);
    const navigable = interactive && this.#state.validItemIds.length > 0;
    const controlKey = event.ctrlKey && !event.metaKey && !event.altKey
      ? String(event.key || '').toLowerCase()
      : '';
    if (controlKey === 'c') {
      event.preventDefault?.();
      this.#interruptCurrent('^C');
      return true;
    }
    if (controlKey === 'l') {
      event.preventDefault?.();
      this.dispatch({ type: 'CLEAR_SCREEN', preserveForeground: this.#state.foreground !== null });
      return true;
    }
    if (this.#state.foreground?.kind === 'command') return false;
    if (key === 'Tab' && navigable && !this.#state.completion && this.#state.input.value.length === 0) {
      event.preventDefault?.();
      this.dispatch({ type: 'MOVE_ACTIVE', direction: event.shiftKey ? -1 : 1, focus: true });
      return true;
    }
    if (interactive && !navigable && ['Tab', 'ArrowUp', 'ArrowDown', 'Enter'].includes(key)) return false;
    if (key === 'Tab') {
      event.preventDefault?.();
      if (this.#state.completion) {
        this.dispatch({ type: 'CYCLE_COMPLETION', direction: event.shiftKey ? -1 : 1 });
        return true;
      }
      const parsed = parseCommand(this.#state.input.value, this.#state.input.selectionStart);
      let available = [];
      try {
        available = this.#adapters.registry?.complete?.({
          ...this.#commandContext(), parsed, cwdNodeId: this.#state.cwdNodeId, state: this.#state
        }) || [];
      } catch { available = []; }
      const matched = matchCandidates(parsed.activeToken?.value || '', available);
      if (matched.length > 0) {
        this.dispatch({ type: 'OPEN_COMPLETION', candidates: matched, replacementRange: parsed.activeToken?.range || [0, 0] });
        if (event.shiftKey) this.dispatch({ type: 'CYCLE_COMPLETION', direction: -1 });
      }
      return true;
    }
    if ((key === 'ArrowUp' || key === 'ArrowDown') && this.#state.completion) {
      event.preventDefault?.();
      this.dispatch({ type: 'CYCLE_COMPLETION', direction: key === 'ArrowUp' ? -1 : 1 });
      return true;
    }
    if (key === 'Enter') {
      event.preventDefault?.();
      if (this.#state.completion) this.dispatch({ type: 'CONFIRM_COMPLETION' });
      else if (navigable && !this.#state.input.value.trim()) {
        try { this.#adapters.activateItem?.(this.#state.activeItemId); } catch { /* Native controls remain available. */ }
      } else this.#executeInput();
      return true;
    }
    if (key === 'Escape') {
      if (this.#state.completion || interactive) {
        event.preventDefault?.();
        if (this.#state.completion) this.dispatch({ type: 'ESCAPE' });
        else this.#interruptCurrent();
        return true;
      }
      return false;
    }
    if (key === 'q' && interactive && this.#state.input.value.length === 0 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault?.();
      const parent = this.#parentListAction();
      if (parent) this.dispatch(parent);
      else this.#finishCurrent();
      return true;
    }
    if ((key === 'ArrowUp' || key === 'ArrowDown') && (!interactive || this.#state.input.value.length > 0)) {
      event.preventDefault?.();
      this.dispatch({ type: 'HISTORY_MOVE', direction: key === 'ArrowUp' ? -1 : 1 });
      return true;
    }
    if ((key === 'ArrowUp' || key === 'ArrowDown') && navigable) {
      event.preventDefault?.();
      this.dispatch({ type: 'MOVE_ACTIVE', direction: key === 'ArrowUp' ? -1 : 1, focus: true });
      return true;
    }
    return false;
  }

  #now() {
    try { return Number(this.#adapters.now?.() ?? Date.now()); } catch { return Date.now(); }
  }

  #commandContext() {
    try {
      const value = typeof this.#adapters.getCommandContext === 'function'
        ? this.#adapters.getCommandContext()
        : this.#adapters.commandContext;
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  #interruptForegroundForRoute() {
    const foreground = this.#state.foreground;
    if (!foreground?.entryId) return;
    this.#execution.interrupt(foreground.runId);
    this.dispatch({ type: 'INTERRUPT_RUN', runId: foreground.runId });
  }

  #interruptCurrent(marker = null) {
    const foreground = this.#state.foreground;
    if (!foreground) {
      this.dispatch({
        type: 'INTERRUPT_PROMPT',
        entryId: `entry:${this.#state.nextEntryId}`,
        submittedAt: this.#now()
      });
      return;
    }
    this.#execution.interrupt(foreground.runId);
    this.dispatch({
      type: 'SETTLE_FOREGROUND',
      runId: foreground.runId,
      status: 'interrupted',
      marker,
      clearedEntry: this.#clearedForeground?.runId === foreground.runId
        ? this.#clearedForeground.entry
        : null,
      route: this.#state.returnRoute
    });
  }

  #finishCurrent() {
    const foreground = this.#state.foreground;
    if (!foreground) return;
    this.#execution.finish(foreground.runId);
    this.dispatch({
      type: 'SETTLE_FOREGROUND',
      runId: foreground.runId,
      status: 'completed',
      route: this.#state.returnRoute
    });
  }

  #taxonomyParentRoute() {
    if (!['tag', 'category'].includes(this.#state.route.kind)) return null;
    let parent = null;
    try {
      const context = this.#commandContext();
      const current = context.tree?.nodes?.get?.(this.#state.viewNodeId);
      parent = current?.parentId ? context.tree?.nodes?.get?.(current.parentId) : null;
    } catch {
      return null;
    }
    if (!parent) return null;
    if (parent.id === 'dir:tags') return { kind: 'tags', viewNodeId: parent.id, canonicalUrl: this.#adapters.routes?.tags || viewUrl(this.#state, 'tags', this.#adapters.routes) };
    if (parent.id === 'dir:categories') return { kind: 'categories', viewNodeId: parent.id, canonicalUrl: this.#adapters.routes?.categories || viewUrl(this.#state, 'categories', this.#adapters.routes) };
    if (parent.type === 'category' && parent.url) return { kind: 'category', viewNodeId: parent.id, canonicalUrl: parent.url };
    return null;
  }

  #parentListAction() {
    const taxonomyRoute = this.#taxonomyParentRoute();
    if (taxonomyRoute) return { type: 'OPEN_ROUTE', route: taxonomyRoute };
    if (this.#state.output?.result?.view !== 'ls' || this.#state.viewNodeId === 'dir:root') return null;
    try {
      const current = this.#commandContext().tree?.nodes?.get?.(this.#state.viewNodeId);
      if (!current?.parentId || !this.#state.foreground) return null;
      return {
        type: 'SET_INTERACTIVE',
        runId: this.#state.foreground.runId,
        entryId: this.#state.foreground.entryId,
        result: { type: 'render', view: 'ls', viewNodeId: current.parentId }
      };
    } catch {
      return null;
    }
  }

  #executeInput() {
    const value = this.#state.input.value;
    if (!value.trim()) {
      this.dispatch({
        type: 'SUBMIT_EMPTY',
        entryId: `entry:${this.#state.nextEntryId}`,
        submittedAt: this.#now(),
        command: value
      });
      return;
    }
    const parsed = parseCommand(value, this.#state.input.selectionStart);
    if (parsed.error) {
      this.#runCommand(value, parsed, () => ({ type: 'error', code: parsed.error.code, message: 'Invalid command syntax.' }), []);
      return;
    }
    let definition;
    try { definition = this.#adapters.registry?.resolve?.(parsed.command); } catch { definition = null; }
    if (!definition || typeof definition.execute !== 'function') {
      this.#runCommand(value, parsed, () => ({ type: 'error', code: 'COMMAND_NOT_FOUND', message: `Unknown command: ${parsed.command}` }), []);
      return;
    }
    this.#runCommand(value, parsed, definition.execute, parsed.args);
  }

  #runCommand(value, parsed, execute, args) {
    const entryId = `entry:${this.#state.nextEntryId}`;
    const context = { ...this.#commandContext(), parsed, cwdNodeId: this.#state.cwdNodeId, state: this.#state };
    this.#execution.run(execute, context, args, {
      started: ({ runId }) => this.dispatch({
        type: 'START_COMMAND', runId, entryId, command: value, submittedAt: this.#now()
      }),
      resolved: ({ runId, result }) => this.#consumeResult(runId, result),
      rejected: ({ runId, error, aborted }) => {
        if (!matchingForeground(this.#state, runId)) return;
        this.dispatch({ type: 'REJECT_RUN', runId, error, aborted });
        if (!aborted) this.#execution.finish(runId);
        if (!aborted) {
          try { this.#adapters.announce?.(error?.message || 'Command failed.'); } catch { /* Announcement is optional. */ }
        }
      }
    });
  }

  #consumeResult(runId, result) {
    if (!matchingForeground(this.#state, runId)) return;
    let snapshot = normalizeResult(result);
    if (snapshot.type === 'cwd') {
      let node = null;
      try { node = this.#commandContext().tree?.nodes?.get?.(snapshot.cwdNodeId); } catch { node = null; }
      if (!isDirectoryNode(node)) {
        snapshot = {
          type: 'error',
          code: 'INVALID_CWD_RESULT',
          message: 'Command returned an unavailable working directory.'
        };
      }
    }
    if (snapshot.type === 'render') {
      const routable = ['posts', 'archives', 'tags', 'categories', 'tag', 'category'].includes(snapshot.view);
      if (routable) {
        let indexed = null;
        try { indexed = snapshot.viewNodeId ? this.#commandContext().tree?.nodes?.get?.(snapshot.viewNodeId) : null; } catch { indexed = null; }
        if (['tag', 'category'].includes(snapshot.view) && (!indexed || typeof indexed.url !== 'string' || indexed.url.length === 0)) {
          snapshot = { type: 'error', code: 'VIEW_NOT_FOUND', message: `Indexed ${snapshot.view} view is unavailable.` };
        } else {
          this.dispatch({ type: 'RESOLVE_RUN', runId, result: snapshot });
          this.dispatch({
            type: 'OPEN_ROUTE',
            route: {
              kind: snapshot.view,
              viewNodeId: snapshot.viewNodeId ?? null,
              canonicalUrl: indexed?.url || viewUrl(this.#state, snapshot.view, this.#adapters.routes)
            }
          });
          return;
        }
      } else {
        this.dispatch({ type: 'RESOLVE_RUN', runId, result: snapshot });
        if (!matchingForeground(this.#state, runId)) this.#execution.finish(runId);
        return;
      }
    }
    this.dispatch({ type: 'RESOLVE_RUN', runId, result: snapshot });
    this.#execution.finish(runId);
    if (snapshot.type === 'error') {
      try { this.#adapters.announce?.(snapshot.message); } catch { /* Announcement is optional. */ }
    }
    if (snapshot.type === 'navigate') {
      this.dispatch({ type: 'REFRESH_RETURN_RECORD', targetArticleUrl: snapshot.url });
      try { this.#adapters.location?.assign?.(snapshot.url); } catch { /* Native fallback remains available. */ }
    }
  }

  #runEffect(effect) {
    try {
      if (effect.type === 'HISTORY_REPLACE') this.#adapters.history?.replaceState?.(this.historySnapshot(), '', this.#state.route.canonicalUrl);
      else if (effect.type === 'HISTORY_PUSH') this.#adapters.history?.pushState?.(this.historySnapshot(), '', this.#state.route.canonicalUrl);
      else if (effect.type === 'SAVE_HISTORY') writeHistory(this.#adapters.localStorage, this.#state.commandHistory.entries);
      else if (effect.type === 'APPLY_THEME') {
        writeColorMode(this.#adapters.localStorage, effect.mode);
        this.#adapters.applyTheme?.(effect.mode);
      }
      else if (effect.type === 'WRITE_RETURN') {
        this.#cancelReturnFrame();
        this.#writeReturnRecord();
      }
    } catch {
      // History, Storage, and host adapters can be unavailable.
    }
  }

  #scheduleReturnRecord() {
    if (this.#returnFrame !== null || !this.#adapters.sessionStorage || !BUILD_ID.test(this.#state.buildId || '')) return;
    const request = this.#adapters.requestAnimationFrame || globalThis.requestAnimationFrame || (callback => setTimeout(callback, 0));
    try {
      this.#returnFrame = request(() => {
        this.#returnFrame = null;
        this.#writeReturnRecord();
      });
    } catch {
      this.#returnFrame = null;
    }
  }

  #cancelReturnFrame() {
    if (this.#returnFrame === null) return;
    const cancel = this.#adapters.cancelAnimationFrame || globalThis.cancelAnimationFrame || clearTimeout;
    try { cancel(this.#returnFrame); } catch { /* Best-effort cancellation. */ }
    this.#returnFrame = null;
  }

  #writeReturnRecord() {
    try {
      const state = this.#state;
      if (!this.#adapters.sessionStorage || !BUILD_ID.test(state.buildId || '')) return false;
      const now = this.#now();
      return writeReturnRecord(this.#adapters.sessionStorage, {
        schemaVersion: state.schemaVersion,
        buildId: state.buildId,
        createdAt: Math.max(0, Math.trunc(Number(now) || 0)),
        terminalUrl: state.route.canonicalUrl,
        route: routeRecord(state.route),
        cwdNodeId: state.cwdNodeId,
        viewNodeId: state.viewNodeId,
        activeItemId: state.activeItemId,
        scrollTop: state.restore.scrollTop,
        inputDraft: state.input.value,
        transcript: state.transcript,
        nextEntryId: state.nextEntryId,
        targetArticleUrl: state.targetArticleUrl
      });
    } catch {
      return false;
    }
  }
}
