import { registerBuiltins } from './commands.mjs';
import { TerminalController, createInitialState } from './controller.mjs';
import { mountMobileTab } from './mobile-tab.mjs';
import { createIndexLoader, validateAboutProfile } from './model.mjs';
import { CommandRegistry } from './registry.mjs';
import { createRouter } from './router.mjs';
import { consumeReturnRecord, hasReturnRecord } from './session.mjs';
import { createVirtualTree } from './tree.mjs';
import { createViewModel } from './views.mjs';
import { createTerminalRenderer } from './renderer.mjs';

const RETURN_TTL_MS = 43_200_000;
const THEME_COLORS = Object.freeze({ dark: '#0b1419', light: '#c1c4c5' });

export function applyColorMode(documentRef, value) {
  const mode = value === 'light' ? 'light' : 'dark';
  documentRef.documentElement.dataset.theme = mode;
  const meta = documentRef.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLORS[mode];
  return mode;
}

function optionalStorage(windowRef, name) {
  try { return windowRef[name]; } catch { return null; }
}

function provisionalRoute(initial) {
  const directories = {
    root: 'dir:root',
    posts: 'dir:posts',
    tags: 'dir:tags',
    categories: 'dir:categories'
  };
  return {
    kind: initial.kind,
    viewNodeId: directories[initial.kind] ?? null,
    canonicalUrl: initial.url,
    rootUrl: initial.routes.root,
    returnRoute: { kind: 'root', viewNodeId: 'dir:root', canonicalUrl: initial.routes.root }
  };
}

function sameIds(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validRowIds(model) {
  return model.rowNavigation ? model.rows.map(value => value.id) : [];
}

function clockText(date = new Date()) {
  return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function startClock(documentRef, windowRef) {
  let stopped = false;
  let timeoutId = null;
  let intervalId = null;
  const update = () => {
    if (stopped) return;
    const now = new Date();
    for (const node of documentRef.querySelectorAll('[data-terminal-clock]')) {
      node.textContent = clockText(now);
      node.dateTime = now.toISOString();
    }
  };
  update();
  const delay = 60_000 - Date.now() % 60_000;
  timeoutId = windowRef.setTimeout(() => {
    timeoutId = null;
    if (stopped) return;
    update();
    intervalId = windowRef.setInterval(update, 60_000);
  }, delay);
  return () => {
    if (stopped) return;
    stopped = true;
    if (timeoutId !== null) windowRef.clearTimeout?.(timeoutId);
    if (intervalId !== null) windowRef.clearInterval?.(intervalId);
    timeoutId = null;
    intervalId = null;
  };
}

function setStatus(status, message, isLive = () => true) {
  if (!status) return;
  status.textContent = '';
  queueMicrotask(() => { if (isLive()) status.textContent = message; });
}

function keySnapshot(event) {
  return {
    key: event.key,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    isComposing: event.isComposing,
    preventDefault() {}
  };
}

function inputSnapshot(input) {
  return {
    value: input.value,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd
  };
}

function sameInputSnapshot(left, right) {
  return left.value === right.value
    && left.selectionStart === right.selectionStart
    && left.selectionEnd === right.selectionEnd;
}

function previousCodePoint(value, index) {
  if (index <= 0) return 0;
  const tail = value.charCodeAt(index - 1);
  return tail >= 0xdc00 && tail <= 0xdfff && index > 1 ? index - 2 : index - 1;
}

function nextCodePoint(value, index) {
  if (index >= value.length) return value.length;
  const head = value.charCodeAt(index);
  return head >= 0xd800 && head <= 0xdbff && index + 1 < value.length ? index + 2 : index + 1;
}

export function editCommandInput(input, key) {
  const value = String(input?.value ?? '');
  const start = Math.max(0, Math.min(value.length, Number(input?.selectionStart) || 0));
  const end = Math.max(start, Math.min(value.length, Number(input?.selectionEnd) || start));
  if (typeof key === 'string' && [...key].length === 1) {
    const next = `${value.slice(0, start)}${key}${value.slice(end)}`;
    const cursor = start + key.length;
    return { value: next, selectionStart: cursor, selectionEnd: cursor };
  }
  if (key === 'Backspace') {
    const from = start === end ? previousCodePoint(value, start) : start;
    const next = `${value.slice(0, from)}${value.slice(end)}`;
    return { value: next, selectionStart: from, selectionEnd: from };
  }
  if (key === 'Delete') {
    const to = start === end ? nextCodePoint(value, end) : end;
    const next = `${value.slice(0, start)}${value.slice(to)}`;
    return { value: next, selectionStart: start, selectionEnd: start };
  }
  return null;
}

export function isTerminalControlKey(event) {
  return Boolean(event?.ctrlKey)
    && !event?.metaKey
    && !event?.altKey
    && ['c', 'l'].includes(String(event?.key || '').toLowerCase());
}

function closestTarget(target, selector) {
  try { return target?.closest?.(selector) ?? null; } catch { return null; }
}

function isEditableTarget(target) {
  if (closestTarget(target, 'input, textarea, select')) return true;
  const editable = closestTarget(target, '[contenteditable]');
  if (!editable) return false;
  const contentEditable = editable?.getAttribute?.('contenteditable');
  return contentEditable !== 'false';
}

function hasNativeKeyOwnership(event, state) {
  if (isEditableTarget(event.target)) return true;
  const anchor = closestTarget(event.target, 'a');
  if (anchor && event.key === 'Enter') return true;
  if (anchor && event.key === 'Tab' && state.foreground === null) return true;
  const button = closestTarget(event.target, 'button');
  if (!button) return false;
  if (['Enter', ' '].includes(event.key)) return true;
  return state.foreground === null
    && (event.key === 'Tab' || isTerminalControlKey(event));
}

export async function detectNerdFont(fonts) {
  try {
    await fonts?.ready;
    return Boolean(fonts?.check?.('16px HackNF'));
  } catch {
    return false;
  }
}

export async function startTerminal({ documentRef = document, windowRef = window, adapters = {} } = {}) {
  const fallback = documentRef.querySelector('.terminal-fallback');
  const enhanced = documentRef.querySelector('.terminal-enhanced');
  const initialNode = documentRef.getElementById('terminal-initial-state');
  const status = documentRef.getElementById('terminal-status');
  if (!enhanced || !initialNode) return null;

  const rendererFactory = adapters.createTerminalRenderer ?? createTerminalRenderer;

  let initial;
  try { initial = JSON.parse(initialNode.textContent); } catch { throw new Error('invalid terminal initial state'); }
  const validation = {
    origin: windowRef.location.origin,
    root: initial.routes.root,
    schemaVersion: initial.schemaVersion
  };
  const aboutProfile = validateAboutProfile(initial.about, validation);
  const router = createRouter({
    origin: windowRef.location.origin,
    routes: initial.routes,
    paginationDir: initial.paginationDir
  });
  const loader = createIndexLoader({
    url: initial.indexUrl,
    timeoutMs: initial.indexTimeoutMs,
    validation,
    fetchImpl: windowRef.fetch.bind(windowRef)
  });
  const registry = new CommandRegistry();
  registerBuiltins(registry);

  let index = null;
  let tree = null;
  let activated = false;
  let clockStarted = false;
  let fontChecked = false;
  let navigationInstalled = false;
  let restoreAttempted = false;
  let cleanedUp = false;
  let announcedSummary = null;
  let clockCleanup = null;
  let controllerUnsubscribe = null;
  let mobileTabCleanup = null;
  let inputCaptureCleanup = null;
  let navigationCleanup = null;
  let renderer = null;
  let controller;
  let deferredIndexAction = null;
  let welcomeNavigationRequest = 0;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    welcomeNavigationRequest += 1;
    deferredIndexAction = null;
    renderQueued = false;
    renderScheduled = false;
    controllerUnsubscribe?.();
    navigationCleanup?.();
    clockCleanup?.();
    mobileTabCleanup?.();
    inputCaptureCleanup?.();
    renderer?.destroy();
    loader.dispose?.();
    controller?.dispose();
  };

  const localStorage = optionalStorage(windowRef, 'localStorage');
  const sessionStorage = optionalStorage(windowRef, 'sessionStorage');
  const getCommandContext = () => ({ index, tree });
  controller = new TerminalController(createInitialState(provisionalRoute(initial)), {
    history: windowRef.history,
    location: windowRef.location,
    registry,
    routes: initial.routes,
    localStorage,
    sessionStorage,
    applyTheme: adapters.applyTheme ?? (mode => applyColorMode(documentRef, mode)),
    getCommandContext,
    requestAnimationFrame: windowRef.requestAnimationFrame?.bind(windowRef),
    cancelAnimationFrame: windowRef.cancelAnimationFrame?.bind(windowRef),
    activateItem: activateItemById,
    announce(message) { if (!cleanedUp) setStatus(status, message, () => !cleanedUp); }
  });
  applyColorMode(documentRef, controller.state.colorMode);

  const activate = () => {
    if (cleanedUp) return;
    enhanced.hidden = false;
    if (fallback) {
      fallback.hidden = true;
      fallback.inert = true;
    }
    if (!activated) {
      documentRef.documentElement.dataset.terminalReady = 'true';
      activated = true;
    }
    if (!clockStarted) {
      clockCleanup = startClock(documentRef, windowRef);
      clockStarted = true;
    }
  };

  const showRecoverableError = () => {
    enhanced.hidden = false;
    if (fallback) {
      fallback.hidden = false;
      fallback.inert = false;
    }
  };

  let renderQueued = false;
  let renderScheduled = false;
  let lastRenderedModel = null;
  const renderCurrent = () => {
    if (cleanedUp) return lastRenderedModel;
    renderer ??= rendererFactory(enhanced, handlers);
    const model = renderer.render(controller.state, index);
    if (model.summary !== announcedSummary) {
      announcedSummary = model.summary;
      setStatus(status, model.summary, () => !cleanedUp);
    }
    const ids = validRowIds(model);
    if (index && !sameIds(ids, controller.state.validItemIds) && !renderQueued) {
      renderQueued = true;
      queueMicrotask(() => {
        if (cleanedUp || !renderQueued) return;
        renderQueued = false;
        controller.dispatch({ type: 'INDEX_READY', buildId: index.buildId, validItemIds: ids });
      });
    }
    lastRenderedModel = model;
    return model;
  };

  const scheduleRender = () => {
    if (cleanedUp || renderScheduled) return;
    renderScheduled = true;
    queueMicrotask(() => {
      if (cleanedUp || !renderScheduled) return;
      renderScheduled = false;
      renderCurrent();
    });
  };

  const flushRender = () => {
    renderScheduled = false;
    return renderCurrent();
  };

  const ensureIndex = async ({ syncRoute = false } = {}) => {
    if (cleanedUp) throw new Error('terminal startup disposed');
    if (index) return index;
    controller.dispatch({ type: 'INDEX_LOADING' });
    try {
      const loadedIndex = await loader.load();
      if (cleanedUp) throw new Error('terminal startup disposed');
      const loadedTree = createVirtualTree(loadedIndex);
      const route = syncRoute ? router.fromUrl(windowRef.location.href, loadedIndex) : null;
      index = Object.freeze({ ...loadedIndex, about: aboutProfile });
      tree = loadedTree;
      if (route) controller.dispatch({ type: 'POP_ROUTE', route });
      const model = createViewModel({
        ...controller.state,
        indexStatus: 'ready',
        indexError: null
      }, index);
      controller.dispatch({ type: 'INDEX_READY', buildId: index.buildId, validItemIds: validRowIds(model) });
      return index;
    } catch (error) {
      if (cleanedUp) throw error;
      controller.dispatch({ type: 'INDEX_ERROR', error: error?.message || 'unavailable' });
      showRecoverableError();
      throw error;
    }
  };

  const handleKey = event => {
    if (cleanedUp) return;
    const input = event.currentTarget;
    if (input?.dataset?.terminalInput === 'true'
      && (input.value !== controller.state.input.value
        || input.selectionStart !== controller.state.input.selectionStart
        || input.selectionEnd !== controller.state.input.selectionEnd)) {
      controller.dispatch({
        type: 'SET_INPUT',
        value: input.value,
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd
      });
    }
    const requiresIndex = !index
      && ['Tab', 'Enter'].includes(event.key)
      && controller.state.input.value.trim().length > 0;
    if (!requiresIndex) {
      controller.handleKey(event);
      return;
    }
    event.preventDefault();
    const inputIdentity = inputSnapshot(controller.state.input);
    if (deferredIndexAction && sameInputSnapshot(deferredIndexAction.input, inputIdentity)) return;
    const deferred = { event: keySnapshot(event), input: inputIdentity };
    deferredIndexAction = deferred;
    ensureIndex().then(() => {
      if (cleanedUp
        || deferredIndexAction !== deferred
        || !sameInputSnapshot(controller.state.input, deferred.input)) return;
      deferredIndexAction = null;
      controller.handleKey(deferred.event);
    }).catch(() => {
      if (deferredIndexAction === deferred) deferredIndexAction = null;
    });
  };

  function activateValue(value) {
    if (cleanedUp || !value) return;
    if (value.kind === 'article' && value.href) {
      controller.dispatch({
        type: 'REFRESH_RETURN_RECORD',
        targetArticleUrl: value.href,
        buildId: index?.buildId || controller.state.buildId
      });
      windowRef.location.assign(value.href);
      return;
    }
    if (value.kind === 'page' && value.href) {
      windowRef.location.assign(value.href);
      return;
    }
    if (value.action?.type === 'route') {
      controller.dispatch({
        type: 'OPEN_ROUTE',
        route: {
          kind: value.action.kind,
          viewNodeId: value.action.viewNodeId,
          canonicalUrl: value.action.url
        }
      });
      return;
    }
    if (value.action?.type === 'view') {
      const foreground = controller.state.foreground;
      if (!foreground) return;
      controller.dispatch({
        type: 'SET_INTERACTIVE',
        runId: foreground.runId,
        entryId: foreground.entryId,
        result: {
          type: 'render',
          view: value.action.view,
          viewNodeId: value.action.viewNodeId
        }
      });
      return;
    }
    if (value.action?.type === 'command') {
      const command = `${value.action.value} `;
      controller.dispatch({
        type: 'SET_INPUT',
        value: command,
        selectionStart: command.length,
        selectionEnd: command.length
      });
    }
  }

  function activateItemById(itemId) {
    if (cleanedUp) return;
    const model = createViewModel(controller.state, index);
    const value = model.rows.find(rowValue => rowValue.id === itemId);
    if (value) activateValue(value);
    else if (model.rows.length === 0
      && controller.state.foreground !== null
      && controller.state.output?.phase === 'interactive') goBack();
  }

  function goBack() {
    if (cleanedUp) return;
    if (controller.state.completion) controller.dispatch({ type: 'CLOSE_COMPLETION' });
    controller.handleKey({ key: 'Escape', preventDefault() {} });
  }

  const handlers = {
    async welcomeNavigate(kind) {
      if (cleanedUp || !['posts', 'categories', 'tags'].includes(kind)) return;
      const request = ++welcomeNavigationRequest;
      try {
        await ensureIndex();
        if (cleanedUp || request !== welcomeNavigationRequest) return;
        controller.dispatch({
          type: 'OPEN_ROUTE',
          route: {
            kind,
            viewNodeId: `dir:${kind}`,
            canonicalUrl: initial.routes[kind]
          }
        });
      } catch { /* Index errors remain recoverable through the existing fallback. */ }
    },
    setInput(value, selectionStart, selectionEnd) {
      if (cleanedUp) return;
      if (value === controller.state.input.value
        && selectionStart === controller.state.input.selectionStart
        && selectionEnd === controller.state.input.selectionEnd) return;
      controller.dispatch({ type: 'SET_INPUT', value, selectionStart, selectionEnd });
    },
    composition(active) {
      if (cleanedUp) return;
      controller.dispatch({ type: active ? 'COMPOSITION_START' : 'COMPOSITION_END' });
    },
    handleKey,
    setActive(itemId) {
      if (cleanedUp) return;
      controller.dispatch({ type: 'SET_ACTIVE', itemId, scrollTop: enhanced.scrollTop });
    },
    confirmCandidate(indexValue) {
      if (cleanedUp) return;
      const completion = controller.state.completion;
      if (!completion?.candidates.length) return;
      let remaining = (indexValue - completion.activeIndex + completion.candidates.length) % completion.candidates.length;
      while (remaining > 0) {
        controller.dispatch({ type: 'CYCLE_COMPLETION', direction: 1 });
        remaining -= 1;
      }
      controller.dispatch({ type: 'CONFIRM_COMPLETION' });
      queueMicrotask(() => {
        if (cleanedUp) return;
        try { renderer?.inputNode()?.focus({ preventScroll: true }); } catch { /* Focus is progressive enhancement. */ }
      });
    },
    activateRow(value) {
      if (cleanedUp) return;
      activateValue(value);
    },
    resultKey(key) {
      if (cleanedUp) return;
      controller.handleKey({ key, preventDefault() {} });
    },
    openInline(value) {
      if (cleanedUp) return;
      controller.dispatch({
        type: 'OPEN_ROUTE',
        route: {
          kind: value.action.kind,
          viewNodeId: value.action.viewNodeId,
          canonicalUrl: value.action.url
        }
      });
    },
    prepareArticleNavigation(url) {
      if (cleanedUp) return;
      controller.dispatch({
        type: 'REFRESH_RETURN_RECORD',
        targetArticleUrl: url,
        buildId: index?.buildId || controller.state.buildId
      });
    },
    async retryIndex() {
      if (cleanedUp) return;
      try {
        await ensureIndex({ syncRoute: true });
        if (!cleanedUp) {
          try { completeStartup(); } catch { cleanup(); }
        }
      } catch { /* The retry button remains available. */ }
    },
    renderError(error) {
      if (!cleanedUp) setStatus(status, `Terminal render unavailable: ${error.message}`, () => !cleanedUp);
    }
  };

  const installInputCapture = () => {
    const promptInput = () => renderer?.inputNode() ?? null;
    const onKeyDown = event => {
      if (event.defaultPrevented || event.isComposing || event.target?.dataset?.terminalInput === 'true') return;
      if (hasNativeKeyOwnership(event, controller.state)) return;
      if (isTerminalControlKey(event)) {
        handleKey(event);
        return;
      }
      if (controller.state.foreground !== null) {
        handleKey(event);
        return;
      }
      const input = promptInput();
      if (!input) return;
      const editable = !event.ctrlKey && !event.metaKey && !event.altKey
        ? editCommandInput(controller.state.input, event.key)
        : null;
      if (editable) {
        event.preventDefault();
        try { input.focus({ preventScroll: true }); } catch { /* Focus is progressive enhancement. */ }
        controller.dispatch({ type: 'SET_INPUT', ...editable });
        return;
      }
      if (['Tab', 'Enter', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) {
        try { input.focus({ preventScroll: true }); } catch { /* Focus is progressive enhancement. */ }
        handleKey(event);
      }
    };
    const onNeutralClick = event => {
      if (cleanedUp || controller.state.foreground !== null) return;
      const input = promptInput();
      if (!input
        || closestTarget(event.target, 'a, button, input, textarea, select')
        || isEditableTarget(event.target)) return;
      queueMicrotask(() => {
        if (cleanedUp) return;
        try { input.focus({ preventScroll: true }); } catch { /* Focus is progressive enhancement. */ }
      });
    };
    documentRef.addEventListener('keydown', onKeyDown);
    documentRef.addEventListener('click', onNeutralClick);
    return () => {
      documentRef.removeEventListener('keydown', onKeyDown);
      documentRef.removeEventListener('click', onNeutralClick);
    };
  };

  const checkFont = () => {
    if (cleanedUp || fontChecked) return;
    fontChecked = true;
    detectNerdFont(documentRef.fonts).then(available => {
      if (cleanedUp) return;
      const root = documentRef.documentElement;
      const fallback = !available;
      if (root.classList.contains('font-fallback') === fallback) return;
      root.classList.toggle('font-fallback', fallback);
      scheduleRender();
    });
  };

  const syncBrowserRoute = async historyState => {
    if (cleanedUp) return;
    let route = router.fromUrl(windowRef.location.href, index);
    const hintedKind = historyState?.route?.kind || route.kind;
    if (!index && !['root', 'page', 'document'].includes(hintedKind)) {
      try {
        await ensureIndex();
        if (cleanedUp) return;
        route = router.fromUrl(windowRef.location.href, index);
      } catch {
        return;
      }
    }
    if (!cleanedUp) controller.dispatch({ type: 'POP_ROUTE', route, historyState });
  };

  const installNavigation = () => {
    if (cleanedUp || navigationInstalled) return;
    navigationInstalled = true;
    const onPopState = event => {
      syncBrowserRoute(event.state).catch(() => {});
    };
    const onPageShow = event => {
      if (event.persisted) syncBrowserRoute(windowRef.history.state).catch(() => {});
    };
    windowRef.addEventListener('popstate', onPopState);
    windowRef.addEventListener('pageshow', onPageShow);
    navigationCleanup = () => {
      windowRef.removeEventListener('popstate', onPopState);
      windowRef.removeEventListener('pageshow', onPageShow);
      navigationInstalled = false;
      navigationCleanup = null;
    };
  };

  const restoreReturnRecord = () => {
    if (!index || restoreAttempted) return;
    restoreAttempted = true;
    const restored = consumeReturnRecord(sessionStorage, {
      now: Date.now(),
      ttlMs: RETURN_TTL_MS,
      schemaVersion: initial.schemaVersion,
      buildId: index.buildId,
      origin: windowRef.location.origin,
      root: initial.routes.root,
      currentUrl: windowRef.location.href
    });
    if (!restored) return;
    const model = createViewModel({
      ...controller.state,
      route: restored.route,
      viewNodeId: restored.viewNodeId
    }, index);
    controller.dispatch({ type: 'RESTORE', record: restored, validItemIds: validRowIds(model) });
  };

  function completeStartup() {
    if (cleanedUp) return;
    if (!controller.state.initialized) controller.dispatch({ type: 'INIT_ROUTE' });
    restoreReturnRecord();
    installNavigation();
    if (!inputCaptureCleanup) inputCaptureCleanup = installInputCapture();
    flushRender();
    activate();
    if (!mobileTabCleanup && enhanced.parentElement) {
      const mobileTabOptions = {
        root: enhanced.parentElement,
        controller,
        storage: localStorage,
        visualViewport: windowRef.visualViewport
      };
      mobileTabCleanup = adapters.mountMobileTab
        ? adapters.mountMobileTab(mobileTabOptions)
        : mountMobileTab({
          root: enhanced.parentElement,
          controller,
          storage: localStorage,
          visualViewport: windowRef.visualViewport
        });
    }
    checkFont();
  }

  controllerUnsubscribe = controller.subscribe((state, action) => {
    if (cleanedUp) return;
    if (deferredIndexAction && !sameInputSnapshot(state.input, deferredIndexAction.input)) {
      deferredIndexAction = null;
    }
    if (['COMPOSITION_START', 'COMPOSITION_END', 'REFRESH_RETURN_RECORD'].includes(action?.type)) return;
    if (action?.type === 'SET_ACTIVE' || action?.type === 'MOVE_ACTIVE') {
      renderer?.syncActiveRow(state, {
        scroll: action.type === 'MOVE_ACTIVE',
        focus: Boolean(action.focus)
      });
      return;
    }
    scheduleRender();
  });
  try {
    renderCurrent();
  } catch (error) {
    cleanup();
    throw error;
  }

  const needsIndex = !['root', 'page', 'document'].includes(initial.kind)
    || hasReturnRecord(sessionStorage);
  if (needsIndex) {
    try { await ensureIndex({ syncRoute: true }); } catch { return { controller, retry: handlers.retryIndex, cleanup }; }
  }

  try {
    completeStartup();
  } catch (error) {
    cleanup();
    throw error;
  }
  return {
    controller,
    ensureIndex,
    render: renderCurrent,
    cleanup
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const root = document.documentElement;
  if (root.dataset.terminalBootstrap !== 'started') {
    root.dataset.terminalBootstrap = 'started';
    startTerminal().catch(error => {
      const enhanced = document.querySelector('.terminal-enhanced');
      const fallback = document.querySelector('.terminal-fallback');
      if (enhanced) enhanced.hidden = true;
      if (fallback) {
        fallback.hidden = false;
        fallback.inert = false;
      }
      setStatus(document.getElementById('terminal-status'), `Terminal enhancement unavailable: ${error.message}`);
    });
  }
}
