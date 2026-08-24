import {
  activeBatchRange,
  batchRanges,
  createViewModel,
  shouldHandleInlineNavigation,
  TERMINAL_BRAND
} from './views.mjs';
import { destinationDescription } from './copy.mjs';
import { DEFAULT_LANGUAGE, translate } from '../i18n.mjs';

const ROW_BATCH = 200;
const COMPLETION_BATCH = 100;
const ABOUT_PALETTE = Object.freeze([
  ['background-normal', '背景 · 常规'],
  ['surface-normal', '表面 · 常规'],
  ['code-normal', '代码 · 常规'],
  ['structure-normal', '结构 · 常规'],
  ['muted-normal', '次要文字 · 常规'],
  ['text-normal', '主要文字 · 常规'],
  ['accent-normal', '强调 · 常规'],
  ['error-normal', '错误 · 常规'],
  ['background-bright', '背景 · 强调'],
  ['surface-bright', '表面 · 强调'],
  ['code-bright', '代码 · 强调'],
  ['structure-bright', '结构 · 强调'],
  ['muted-bright', '次要文字 · 强调'],
  ['text-bright', '主要文字 · 强调'],
  ['accent-bright', '强调 · 强调'],
  ['error-bright', '错误 · 强调']
]);
const PROMPT_ROOT = Object.freeze({ id: 'dir:root', name: 'blog', parentId: null });
const PROMPT_DIRECTORIES = Object.freeze(['posts', 'tags', 'categories']);
const PROMPT_NODE_CACHE = new WeakMap();
const VIEWPORT_FOLLOW_GUTTER = 16;
const CARET_WIDTH = 2;
const CARET_TRAIL_DECAY_FAST = 0.1;
const CARET_TRAIL_DECAY_SLOW = 0.4;
const CARET_TRAIL_START_CELLS = 2;
const CARET_TRAIL_STOP_DISTANCE = 0.5;
const WELCOME_ASCII_LINES = Object.freeze([
  ' _____                   __                 ____    ___',
  '/\\  __`\\                /\\ \\               /\\  _`\\ /\\_ \\',
  '\\ \\ \\/\\ \\    ___      __\\ \\/      ____     \\ \\ \\L\\ \\//\\ \\     ___      __',
  " \\ \\ \\ \\ \\ /' _ `\\  /'__`\\/      /',__\\     \\ \\  _ <'\\ \\ \\   / __`\\  /'_ `\\",
  '  \\ \\ \\_\\ \\/\\ \\/\\ \\/\\  __/      /\\__, `\\     \\ \\ \\L\\ \\\\_\\ \\_/\\ \\L\\ \\/\\ \\L\\ \\',
  '   \\ \\_____\\ \\_\\ \\_\\ \\____\\     \\/\\____/      \\ \\____//\\____\\ \\____/\\ \\____ \\',
  '    \\/_____/\\/_/\\/_/\\/____/      \\/___/        \\/___/ \\/____/\\/___/  \\/___L\\ \\',
  '                                                                       /\\____/',
  '                                                                       \\_/__/'
]);
const WELCOME_ASCII_WIDE = WELCOME_ASCII_LINES.join('\n');
const WELCOME_ASCII_COMPACT = (() => {
  const first = WELCOME_ASCII_LINES.map(line => line.slice(0, 42).trimEnd());
  while (first.at(-1) === '') first.pop();
  const second = WELCOME_ASCII_LINES.map(line => line.slice(43).trimEnd());
  return [...first, '', ...second].join('\n');
})();
const WELCOME_DESTINATIONS = Object.freeze(['posts', 'categories', 'tags']);

function languageOf(state) {
  return state?.language || DEFAULT_LANGUAGE;
}

function message(state, key, values) {
  return translate(languageOf(state), key, values);
}

function element(documentRef, name, className, text) {
  const node = documentRef.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function timeText(date = new Date()) {
  return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function promptNodeName(value) {
  const target = String(value?.target || '').split('/').filter(Boolean).at(-1);
  return String(value?.label || value?.title || value?.name || value?.slug || target || value?.id || '');
}

function buildPromptNodes(index) {
  const nodes = new Map([[PROMPT_ROOT.id, PROMPT_ROOT]]);
  for (const name of PROMPT_DIRECTORIES) {
    nodes.set(`dir:${name}`, { id: `dir:${name}`, name, parentId: PROMPT_ROOT.id });
  }
  for (const post of Array.isArray(index?.posts) ? index.posts : []) {
    if (typeof post?.id === 'string' && post.id) {
      nodes.set(post.id, { id: post.id, name: promptNodeName(post), parentId: 'dir:posts' });
    }
  }
  for (const value of Array.isArray(index?.nodes) ? index.nodes : []) {
    if (typeof value?.id !== 'string' || !value.id) continue;
    const parentId = value.parentId
      || (value.type === 'tag' ? 'dir:tags' : value.type === 'category' ? 'dir:categories' : PROMPT_ROOT.id);
    nodes.set(value.id, { id: value.id, name: promptNodeName(value), parentId });
  }
  return nodes;
}

function promptNodes(index) {
  if (!index || (typeof index !== 'object' && typeof index !== 'function')) return buildPromptNodes(index);
  let nodes = PROMPT_NODE_CACHE.get(index);
  if (nodes) return nodes;
  nodes = buildPromptNodes(index);
  PROMPT_NODE_CACHE.set(index, nodes);
  return nodes;
}

function promptPath(cwdNodeId, index) {
  const nodes = promptNodes(index);
  const names = [];
  const seen = new Set();
  let current = nodes.get(cwdNodeId) || PROMPT_ROOT;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.name) names.unshift(current.name);
    if (current.id === PROMPT_ROOT.id) return `${names.join('/')}/`;
    current = nodes.get(current.parentId);
  }
  return `${PROMPT_ROOT.name}/`;
}

function promptDate(value) {
  const date = value === undefined ? new Date() : new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}

function syncPromptPath(parentPath, currentPath, pathValue) {
  const segments = String(pathValue || `${PROMPT_ROOT.name}/`).split('/').filter(Boolean);
  const current = segments.pop() || PROMPT_ROOT.name;
  parentPath.textContent = segments.length ? `${segments.join('/')}/` : '';
  currentPath.textContent = `${current}/`;
}

function renderWelcome(documentRef, handlers) {
  const welcome = element(documentRef, 'section', 'terminal-welcome');
  welcome.setAttribute('aria-labelledby', 'terminal-welcome-title');
  const title = element(documentRef, 'h1', 'sr-only');
  title.id = 'terminal-welcome-title';
  const kicker = element(documentRef, 'p', 'terminal-welcome-kicker');
  const wide = element(documentRef, 'pre', 'terminal-welcome-ascii terminal-welcome-ascii-wide', WELCOME_ASCII_WIDE);
  const compact = element(documentRef, 'pre', 'terminal-welcome-ascii terminal-welcome-ascii-compact', WELCOME_ASCII_COMPACT);
  wide.setAttribute('aria-hidden', 'true');
  compact.setAttribute('aria-hidden', 'true');
  const actions = element(documentRef, 'ul', 'terminal-results terminal-welcome-actions');
  for (const kind of WELCOME_DESTINATIONS) {
    const item = element(documentRef, 'li', 'terminal-row terminal-welcome-item');
    const button = element(documentRef, 'button', 'terminal-row-button terminal-welcome-button');
    button.type = 'button';
    button.dataset.welcomeDestination = kind;
    button.append(
      element(documentRef, 'span', 'terminal-row-label', kind),
      element(documentRef, 'span', 'terminal-row-meta')
    );
    button.addEventListener('click', () => handlers.welcomeNavigate?.(kind));
    item.append(button);
    actions.append(item);
  }
  actions.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...actions.querySelectorAll('.terminal-welcome-button')];
    if (!buttons.length) return;
    const current = Math.max(0, buttons.indexOf(event.target));
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus?.({ preventScroll: true });
  });
  welcome.append(title, kicker, wide, compact, actions);
  syncWelcome(welcome, DEFAULT_LANGUAGE);
  return welcome;
}

function syncWelcome(welcome, language) {
  const state = { language };
  const title = welcome.querySelector('#terminal-welcome-title');
  const kicker = welcome.querySelector('.terminal-welcome-kicker');
  if (title) title.textContent = message(state, 'renderer.welcomeTitle');
  if (kicker) kicker.textContent = message(state, 'renderer.welcomeKicker');
  for (const button of welcome.querySelectorAll('[data-welcome-destination]')) {
    const kind = button.dataset.welcomeDestination;
    const meta = button.querySelector('.terminal-row-meta');
    if (meta) meta.textContent = destinationDescription(kind, language);
  }
}

function renderBreadcrumb(documentRef, values, state) {
  if (!Array.isArray(values) || values.length <= 3) return null;
  const nav = element(documentRef, 'nav', 'terminal-breadcrumb');
  nav.setAttribute('aria-label', message(state, 'renderer.terminalPath'));
  nav.textContent = [values[2].toUpperCase(), ...values.slice(3)].join(' › ');
  return nav;
}

function renderSummary(documentRef, value) {
  const summary = element(documentRef, 'p', 'terminal-summary');
  const separator = value.indexOf(' · ');
  if (separator < 0) {
    summary.textContent = value;
    if (value.startsWith('one:')) summary.classList.add('terminal-summary-error');
    return summary;
  }
  summary.append(
    element(documentRef, 'strong', 'terminal-summary-title', value.slice(0, separator)),
    element(documentRef, 'span', 'terminal-summary-detail', value.slice(separator))
  );
  return summary;
}

function renderAbout(documentRef, model, state) {
  const about = element(documentRef, 'section', 'terminal-about');
  about.setAttribute('aria-label', message(state, 'renderer.blogOverview'));
  const identity = element(documentRef, 'div', 'terminal-about-identity');
  if (model.avatarUrl) {
    const avatar = element(documentRef, 'img', 'terminal-about-avatar');
    avatar.src = model.avatarUrl;
    avatar.alt = message(state, 'renderer.avatar', { title: model.title });
    avatar.loading = 'eager';
    avatar.decoding = 'async';
    identity.append(avatar);
  }
  identity.append(element(documentRef, 'span', 'terminal-about-badge', model.badge));

  const details = element(documentRef, 'div', 'terminal-about-details');
  details.append(element(documentRef, 'h2', 'terminal-about-title', model.title));
  const facts = element(documentRef, 'dl', 'terminal-about-facts');
  for (const fact of model.facts) {
    facts.append(element(documentRef, 'dt', 'terminal-about-label', fact.label));
    const value = element(documentRef, 'dd', 'terminal-about-value');
    if (fact.href) {
      const link = element(documentRef, 'a', 'terminal-about-link', fact.value);
      link.href = fact.href;
      if (fact.href.startsWith('https://')) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      value.append(link);
    } else {
      value.textContent = fact.value;
    }
    facts.append(value);
  }
  const palette = element(documentRef, 'div', 'terminal-about-palette');
  palette.setAttribute('role', 'img');
  palette.setAttribute('aria-label', message(state, 'renderer.palette'));
  for (const [name, label] of ABOUT_PALETTE) {
    const swatch = element(documentRef, 'span', `terminal-about-swatch terminal-about-swatch-${name}`);
    swatch.title = languageOf(state) === 'en' ? name.replace('-', ' · ') : label;
    palette.append(swatch);
  }
  details.append(facts, palette);
  about.append(identity, details);
  return about;
}

function renderRowControl(documentRef, value, state, handlers, interactive) {
  const isActive = value.id === state.activeItemId;
  let control;
  if (value.href) {
    control = element(documentRef, 'a', 'terminal-row-link');
    control.href = value.href;
    control.addEventListener('click', event => {
      if (interactive) handlers.setActive?.(value.id);
      if (value.kind === 'article') {
        handlers.prepareArticleNavigation?.(control.href);
        return;
      }
      if (interactive && ['tag', 'category'].includes(value.kind) && shouldHandleInlineNavigation(event)) {
        event.preventDefault();
        handlers.openInline?.(value);
      }
    });
  } else {
    control = element(documentRef, 'button', 'terminal-row-button');
    control.type = 'button';
    control.disabled = !interactive;
    control.addEventListener('click', () => {
      if (!interactive) return;
      handlers.setActive?.(value.id);
      handlers.activateRow?.(value);
    });
  }
  if (interactive) {
    control.dataset.rowNavigation = 'true';
    control.addEventListener('pointerenter', () => handlers.setActive?.(value.id));
    control.tabIndex = isActive ? 0 : -1;
  }
  else if (!value.href) control.tabIndex = -1;
  control.dataset.rowId = value.id;
  control.append(element(documentRef, 'span', 'terminal-row-label', value.label));
  if (value.meta) control.append(element(documentRef, 'span', 'terminal-row-meta', value.meta));
  return control;
}

function renderStaticRow(documentRef, value) {
  const line = element(documentRef, 'div', 'terminal-row-static');
  line.append(element(documentRef, 'span', 'terminal-row-label', value.label));
  if (value.meta) line.append(element(documentRef, 'span', 'terminal-row-meta', value.meta));
  return line;
}

function renderRows(documentRef, model, state, handlers, interactive) {
  const list = element(documentRef, 'ul', 'terminal-results');
  const activeIndex = Math.max(0, model.rows.findIndex(value => value.id === state.activeItemId));
  let visibleCount = 0;
  const append = (start, end) => {
    const fragment = documentRef.createDocumentFragment();
    for (const value of model.rows.slice(start, end)) {
      const item = element(documentRef, 'li', `terminal-row terminal-row-${value.kind}`);
      item.append(model.rowNavigation
        ? renderRowControl(documentRef, value, state, handlers, interactive)
        : renderStaticRow(documentRef, value));
      fragment.append(item);
    }
    list.append(fragment);
    visibleCount = end;
  };
  const ranges = model.rowNavigation
    ? batchRanges(model.rows.length, activeIndex, ROW_BATCH)
    : [[0, model.rows.length]];
  for (const [start, end] of ranges) append(start, end);
  if (visibleCount < model.rows.length && interactive && model.rowNavigation) {
    const item = element(documentRef, 'li', 'terminal-row terminal-load-more');
    const button = element(
      documentRef,
      'button',
      'terminal-load-more-button',
      message(state, 'renderer.more', { count: model.rows.length - visibleCount })
    );
    button.type = 'button';
    button.addEventListener('click', () => {
      append(visibleCount, Math.min(model.rows.length, visibleCount + ROW_BATCH));
      if (visibleCount >= model.rows.length) item.remove();
    });
    item.append(button);
    list.append(item);
  }
  return list;
}

function renderCompletion(documentRef, completion, handlers) {
  if (!completion) return null;
  const list = element(documentRef, 'ul', 'terminal-completion');
  list.id = 'terminal-completion';
  list.setAttribute('role', 'listbox');
  const active = Math.max(0, completion.activeIndex);
  const [start, end] = activeBatchRange(completion.candidates.length, active, COMPLETION_BATCH);
  const fragment = documentRef.createDocumentFragment();
  for (let index = start; index < end; index += 1) {
    const candidate = completion.candidates[index];
    const option = element(documentRef, 'li', 'terminal-completion-option');
    option.id = `terminal-option-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(index === active));
    option.append(element(documentRef, 'span', 'terminal-completion-label', candidate.label));
    if (candidate.description) option.append(element(documentRef, 'span', 'terminal-completion-description', candidate.description));
    option.addEventListener('mousedown', event => event.preventDefault());
    option.addEventListener('click', () => handlers.confirmCandidate?.(index));
    fragment.append(option);
  }
  list.append(fragment);
  return list;
}

export function syncCompletionAccessibility(input, completion) {
  if (!input?.setAttribute || !input?.removeAttribute) return;
  if (completion?.activeIndex >= 0) {
    input.setAttribute('aria-activedescendant', `terminal-option-${completion.activeIndex}`);
    input.setAttribute('aria-controls', 'terminal-completion');
    input.setAttribute('aria-expanded', 'true');
    return;
  }
  input.removeAttribute('aria-activedescendant');
  input.removeAttribute('aria-controls');
  input.setAttribute('aria-expanded', 'false');
}

function caretGeometry(caret, fallbackOffset = null) {
  const rect = caret.getBoundingClientRect?.();
  const left = Number(rect?.left);
  const right = Number(rect?.right);
  const top = Number(rect?.top);
  const bottom = Number(rect?.bottom);
  if (
    Number.isFinite(left) && Number.isFinite(right) && right > left
    && Number.isFinite(top) && Number.isFinite(bottom) && bottom > top
  ) return { left, right, top, bottom };
  if (!Number.isFinite(fallbackOffset)) return null;
  return { left: fallbackOffset, right: fallbackOffset + CARET_WIDTH, top: 0, bottom: 20 };
}

function geometryCorners(geometry) {
  return [
    { x: geometry.right, y: geometry.top },
    { x: geometry.right, y: geometry.bottom },
    { x: geometry.left, y: geometry.bottom },
    { x: geometry.left, y: geometry.top }
  ];
}

function centerOf(corners) {
  return corners.reduce((center, corner) => ({
    x: center.x + corner.x / corners.length,
    y: center.y + corner.y / corners.length
  }), { x: 0, y: 0 });
}

function createCaretTrail(documentRef, caret, trail) {
  const view = documentRef.defaultView;
  const requestFrame = typeof view?.requestAnimationFrame === 'function'
    ? callback => view.requestAnimationFrame(callback)
    : callback => setTimeout(() => callback(Date.now()), 16);
  const cancelFrame = typeof view?.cancelAnimationFrame === 'function'
    ? id => view.cancelAnimationFrame(id)
    : id => clearTimeout(id);
  const reducedMotion = Boolean(view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  let target = null;
  let corners = null;
  let frameId = null;
  let lastTimestamp = null;
  let initialized = false;
  let destroyed = false;

  const hide = () => {
    trail.hidden = true;
    trail.removeAttribute('data-direction');
  };
  const render = () => {
    const xValues = corners.map(corner => corner.x);
    const yValues = corners.map(corner => corner.y);
    const left = Math.min(...xValues);
    const right = Math.max(...xValues);
    const top = Math.min(...yValues);
    const bottom = Math.max(...yValues);
    trail.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    trail.style.inlineSize = `${Math.max(1, right - left)}px`;
    trail.style.blockSize = `${Math.max(1, bottom - top)}px`;
    trail.style.clipPath = `polygon(${corners.map(corner => `${corner.x - left}px ${corner.y - top}px`).join(', ')})`;
  };
  const stepFor = (dt, decay) => 1 - Math.pow(2, -10 * dt / decay);
  const tick = timestamp => {
    frameId = null;
    if (destroyed || trail.hidden) return;
    const liveGeometry = caretGeometry(caret);
    if (liveGeometry) target = geometryCorners(liveGeometry);
    const currentTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
    const dt = lastTimestamp === null
      ? 1 / 60
      : Math.max(0.001, Math.min(0.05, (currentTimestamp - lastTimestamp) / 1000));
    lastTimestamp = currentTimestamp;
    const targetCenter = centerOf(target);
    const halfDiagonal = Math.max(0.001, Math.hypot(
      Math.abs(target[0].x - target[2].x),
      Math.abs(target[0].y - target[2].y)
    ) * 0.5);
    const vectors = target.map((corner, index) => {
      const dx = corner.x - corners[index].x;
      const dy = corner.y - corners[index].y;
      const distance = Math.hypot(dx, dy);
      const dot = distance < 1e-6
        ? 0
        : (dx * (corner.x - targetCenter.x) + dy * (corner.y - targetCenter.y)) / halfDiagonal / distance;
      return { dx, dy, dot };
    });
    const moving = vectors.filter(vector => Math.abs(vector.dx) >= 1e-6 || Math.abs(vector.dy) >= 1e-6);
    const dots = moving.map(vector => vector.dot);
    const minDot = dots.length ? Math.min(...dots) : 0;
    const maxDot = dots.length ? Math.max(...dots) : 0;
    vectors.forEach((vector, index) => {
      if (Math.abs(vector.dx) < 1e-6 && Math.abs(vector.dy) < 1e-6) return;
      const decay = minDot === maxDot
        ? CARET_TRAIL_DECAY_SLOW
        : CARET_TRAIL_DECAY_SLOW
          + (CARET_TRAIL_DECAY_FAST - CARET_TRAIL_DECAY_SLOW) * (vector.dot - minDot) / (maxDot - minDot);
      const step = stepFor(dt, decay);
      corners[index].x += vector.dx * step;
      corners[index].y += vector.dy * step;
    });
    render();
    if (corners.every((corner, index) => (
      Math.abs(target[index].x - corner.x) < CARET_TRAIL_STOP_DISTANCE
      && Math.abs(target[index].y - corner.y) < CARET_TRAIL_STOP_DISTANCE
    ))) {
      corners = target.map(corner => ({ ...corner }));
      hide();
      return;
    }
    frameId = requestFrame(tick);
  };
  const schedule = () => {
    if (frameId === null) frameId = requestFrame(tick);
  };

  return Object.freeze({
    moveTo(geometry, cellWidth, cellHeight) {
      const next = geometryCorners(geometry);
      if (!initialized) {
        initialized = true;
        target = next;
        corners = next.map(corner => ({ ...corner }));
        hide();
        return;
      }
      const previousCenter = centerOf(target);
      const nextCenter = centerOf(next);
      const dx = nextCenter.x - previousCenter.x;
      const dy = nextCenter.y - previousCenter.y;
      if (dx === 0 && dy === 0) return;
      const previousTarget = target;
      target = next;
      const withinThreshold = Math.abs(dx) <= Math.max(1, cellWidth) * CARET_TRAIL_START_CELLS
        && Math.abs(dy) <= Math.max(1, cellHeight) * CARET_TRAIL_START_CELLS;
      if (reducedMotion || (trail.hidden && withinThreshold)) {
        corners = target.map(corner => ({ ...corner }));
        hide();
        return;
      }
      if (trail.hidden) corners = previousTarget.map(corner => ({ ...corner }));
      trail.dataset.direction = Math.abs(dy) > Math.abs(dx)
        ? dy < 0 ? 'up' : 'down'
        : dx < 0 ? 'left' : 'right';
      trail.hidden = false;
      lastTimestamp = null;
      render();
      schedule();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      hide();
    }
  });
}

function syncVisualCaret(input, caret, measure, motion) {
  const cursor = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
  measure.textContent = '0';
  const cellWidth = Number(measure.getBoundingClientRect?.().width) || 8;
  measure.textContent = input.value.slice(0, cursor);
  const measured = Number(measure.getBoundingClientRect?.().width) || 0;
  const width = Math.max(0, (Number(input.clientWidth) || measured + 2) - 2);
  const offset = Math.max(0, Math.min(width, measured - (Number(input.scrollLeft) || 0)));
  caret.dataset.offset = String(offset);
  caret.style.transform = `translate3d(${offset}px, 0, 0)`;
  const geometry = caretGeometry(caret, offset);
  motion.moveTo(geometry, cellWidth, geometry.bottom - geometry.top);
}

function scrollCompletionOption(documentRef, index) {
  const option = documentRef.getElementById(`terminal-option-${index}`);
  const list = option?.parentElement;
  if (!option || !list || typeof option.offsetTop !== 'number') return;
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

function scrollViewportWithinAnchor(documentRef, anchor, tail) {
  const view = documentRef.defaultView;
  const viewportHeight = Number(view?.innerHeight);
  if (!anchor || !tail || !Number.isFinite(viewportHeight) || viewportHeight <= 0 || typeof view.scrollBy !== 'function') return;
  const tailBottom = Number(tail.getBoundingClientRect?.().bottom);
  const anchorTop = Number(anchor.getBoundingClientRect?.().top);
  if (!Number.isFinite(tailBottom) || !Number.isFinite(anchorTop)) return;
  const overflow = tailBottom - (viewportHeight - VIEWPORT_FOLLOW_GUTTER);
  const anchorLimit = anchorTop - VIEWPORT_FOLLOW_GUTTER;
  const distance = Math.min(overflow, anchorLimit);
  if (distance <= 0) return;
  view.scrollBy({ top: distance, left: 0 });
}

function scrollCompletionViewport(documentRef, prompt) {
  scrollViewportWithinAnchor(documentRef, prompt.node, prompt.completion);
}

function scrollPromptLineToViewportBottom(documentRef, line) {
  const view = documentRef.defaultView;
  const viewportHeight = Number(view?.innerHeight);
  if (!line || !Number.isFinite(viewportHeight) || viewportHeight <= 0 || typeof view.scrollBy !== 'function') return;
  const rect = line.getBoundingClientRect?.();
  const top = Number(rect?.top);
  const bottom = Number(rect?.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;
  const safeBottom = viewportHeight - VIEWPORT_FOLLOW_GUTTER;
  if (bottom > VIEWPORT_FOLLOW_GUTTER && top < safeBottom) return;
  const distance = bottom - safeBottom;
  if (distance === 0) return;
  view.scrollBy({ top: distance, left: 0 });
}

function promptContext(documentRef, { active, date = promptDate(), pathValue = `${PROMPT_ROOT.name}/` }) {
  const context = element(documentRef, 'div', 'terminal-prompt-context');
  const fontFallback = documentRef.documentElement?.classList.contains('font-fallback');
  const path = element(documentRef, 'span', 'terminal-path');
  const parentPath = element(documentRef, 'span', 'terminal-path-parent');
  const currentPath = element(documentRef, 'strong', 'terminal-path-current');
  syncPromptPath(parentPath, currentPath, pathValue);
  path.append(element(documentRef, 'span', 'terminal-path-root', ' ~/'), parentPath, currentPath);
  const clockModule = element(documentRef, 'span', 'terminal-clock');
  const glyph = element(documentRef, 'span', 'terminal-clock-glyph', fontFallback ? 'time' : '');
  glyph.setAttribute('aria-hidden', 'true');
  const clock = element(documentRef, 'time', 'terminal-clock-text', timeText(date));
  clock.dateTime = date.toISOString();
  if (active) clock.dataset.terminalClock = 'true';
  clockModule.append(glyph, clock);
  context.append(path, clockModule);
  return { context, glyph, fontFallback, parentPath, currentPath };
}

function promptArrow(documentRef, fontFallback) {
  const arrow = element(documentRef, 'span', 'terminal-prompt-arrow', fontFallback ? ' >' : ' ➤');
  arrow.setAttribute('aria-hidden', 'true');
  return arrow;
}

function renderHistoryEntry(documentRef, entry, index, state) {
  const history = element(documentRef, 'section', 'terminal-history-entry');
  history.dataset.entryId = entry.id;
  history.dataset.entryStatus = entry.status;
  const prompt = element(documentRef, 'section', 'terminal-prompt terminal-prompt-echo');
  const { context, fontFallback } = promptContext(documentRef, {
    active: false,
    date: promptDate(entry.prompt?.submittedAt),
    pathValue: promptPath(entry.prompt?.cwdNodeId, index)
  });
  const line = element(documentRef, 'div', 'terminal-input-line');
  line.append(promptArrow(documentRef, fontFallback), element(documentRef, 'span', 'terminal-command-echo', entry.command));
  prompt.append(context, line);
  history.append(prompt);
  syncHistoryMarker(documentRef, history, entry.marker);
  syncHistoryResult(documentRef, history, entry, index, state);
  return history;
}

function syncHistoryMarker(documentRef, history, marker) {
  const current = history.querySelector('.terminal-command-marker');
  if (marker === null || marker === undefined || marker === '') {
    current?.remove();
    return;
  }
  if (current) { current.textContent = marker; return; }
  history.querySelector('.terminal-input-line')?.append(element(documentRef, 'span', 'terminal-command-marker', marker));
}

function syncHistoryFont(history, fontFallback) {
  const glyph = history.querySelector('.terminal-clock-glyph');
  const arrow = history.querySelector('.terminal-prompt-arrow');
  if (glyph) glyph.textContent = fontFallback ? 'time' : '';
  if (arrow) arrow.textContent = fontFallback ? ' >' : ' ➤';
}

function syncHistoryResult(documentRef, history, entry, index, currentState) {
  const current = history.querySelector('.terminal-history-result');
  current?.remove();
  if (!entry.result) return;
  const state = {
    route: { kind: 'root', canonicalUrl: '/' },
    viewNodeId: entry.result.viewNodeId ?? 'dir:root',
    activeItemId: null,
    indexStatus: 'ready',
    indexError: null,
    language: languageOf(currentState),
    output: { ownerId: entry.id, phase: 'settled', result: entry.result }
  };
  const region = element(documentRef, 'div', 'terminal-history-result');
  const model = createViewModel(state, index);
  region.append(renderOutput(documentRef, state, { ...model, rowNavigation: false }, {}));
  history.append(region);
}

function syncTranscript(documentRef, transcript, nodes, entries, index, state) {
  const fontFallback = documentRef.documentElement?.classList.contains('font-fallback');
  const remaining = new Set(entries.map(entry => entry.id));
  for (const [id, record] of nodes) {
    if (remaining.has(id)) continue;
    record.node.remove();
    nodes.delete(id);
  }
  for (const entry of entries) {
    const current = nodes.get(entry.id);
    if (!current) {
      const node = renderHistoryEntry(documentRef, entry, index, state);
      transcript.append(node);
      nodes.set(entry.id, {
        node,
        status: entry.status,
        marker: entry.marker,
        result: entry.result,
        fontFallback
      });
      continue;
    }
    if (current.fontFallback !== fontFallback) {
      syncHistoryFont(current.node, fontFallback);
      current.fontFallback = fontFallback;
    }
    if (current.status !== entry.status || current.marker !== entry.marker) {
      current.node.dataset.entryStatus = entry.status;
      syncHistoryMarker(documentRef, current.node, entry.marker);
      current.status = entry.status;
      current.marker = entry.marker;
    }
    if (current.result !== entry.result) {
      syncHistoryResult(documentRef, current.node, entry, index, state);
      current.result = entry.result;
    }
  }
}

function renderResultHint(documentRef, state, handlers) {
  const hint = element(documentRef, 'p', 'terminal-result-hint');
  const action = (key, label, keyLabel = key) => {
    const button = element(documentRef, 'button', 'terminal-result-key');
    button.type = 'button';
    button.append(element(documentRef, 'kbd', '', keyLabel), element(documentRef, 'span', 'terminal-result-key-label', label));
    button.addEventListener('click', () => handlers.resultKey?.(key));
    return button;
  };
  hint.append(
    action('q', message(state, 'renderer.back')),
    element(documentRef, 'span', 'terminal-result-hint-separator', '·'),
    action('Escape', message(state, 'renderer.interrupt'), 'esc')
  );
  return hint;
}

function renderOutput(documentRef, state, model, handlers) {
  const fragment = documentRef.createDocumentFragment();
  if (!state.output) return fragment;
  const preview = element(documentRef, 'section', 'terminal-current-preview');
  const breadcrumb = renderBreadcrumb(documentRef, model.breadcrumb, state);
  const interactive = state.output.phase === 'interactive';
  if (breadcrumb) preview.append(breadcrumb);
  if (model.summary !== TERMINAL_BRAND) preview.append(renderSummary(documentRef, model.summary));
  if (model.emptyMessage) preview.append(element(documentRef, 'p', 'terminal-empty', model.emptyMessage));
  if (state.indexStatus === 'error') {
    const retry = element(documentRef, 'button', 'terminal-retry', message(state, 'renderer.retry'));
    retry.type = 'button';
    retry.disabled = !interactive;
    retry.addEventListener('click', () => { if (interactive) handlers.retryIndex?.(); });
    preview.append(retry);
  }
  if (model.about) preview.append(renderAbout(documentRef, model.about, state));
  if (model.rows.length) preview.append(renderRows(documentRef, model, state, handlers, interactive));
  if (interactive) preview.append(renderResultHint(documentRef, state, handlers));
  fragment.append(preview);
  return fragment;
}

function outputIdentity(state) {
  return JSON.stringify([
    state.output?.ownerId ?? null, state.output?.phase ?? null, state.output?.result ?? null,
    state.route?.kind ?? null, state.viewNodeId ?? null, state.indexStatus, state.indexError, state.buildId,
    languageOf(state)
  ]);
}

function syncActiveControls(output, state, { scroll = false, focus = false } = {}) {
  if (state.output?.phase !== 'interactive') return false;
  let found = false;
  for (const control of output.querySelectorAll('[data-row-id]')) {
    const active = control.dataset.rowId === state.activeItemId;
    control.tabIndex = active ? 0 : -1;
    if (!active) continue;
    found = true;
    if (scroll) control.scrollIntoView?.({ block: 'nearest' });
    if (focus) {
      try { control.focus({ preventScroll: true }); } catch { /* Focus is progressive enhancement. */ }
    }
  }
  return found;
}

function createActivePrompt(documentRef, handlers) {
  const node = element(documentRef, 'section', 'terminal-prompt terminal-prompt-active');
  const { context, glyph, fontFallback, parentPath, currentPath } = promptContext(documentRef, { active: true });
  const line = element(documentRef, 'div', 'terminal-input-line');
  const label = element(documentRef, 'label', 'sr-only', translate(DEFAULT_LANGUAGE, 'renderer.commandLabel'));
  label.htmlFor = 'terminal-command-input';
  const inputWrap = element(documentRef, 'span', 'terminal-input-wrap');
  const input = element(documentRef, 'input', 'terminal-command-input');
  input.id = 'terminal-command-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.placeholder = translate(DEFAULT_LANGUAGE, 'renderer.placeholder');
  input.dataset.terminalInput = 'true';
  const trail = element(documentRef, 'span', 'terminal-caret-trail');
  trail.setAttribute('aria-hidden', 'true');
  trail.hidden = true;
  const caret = element(documentRef, 'span', 'terminal-visual-caret');
  caret.setAttribute('aria-hidden', 'true');
  const measure = element(documentRef, 'span', 'terminal-caret-measure');
  measure.setAttribute('aria-hidden', 'true');
  const caretMotion = createCaretTrail(documentRef, caret, trail);
  let destroyed = false;
  const listeners = [];
  const listen = (eventName, listener) => {
    input.addEventListener(eventName, listener);
    listeners.push([eventName, listener]);
  };
  const updateCaret = () => {
    if (!destroyed && !node.hidden) syncVisualCaret(input, caret, measure, caretMotion);
  };
  listen('input', () => {
    handlers.setInput?.(input.value, input.selectionStart, input.selectionEnd);
    updateCaret();
    scrollPromptLineToViewportBottom(documentRef, line);
  });
  listen('compositionstart', () => handlers.composition?.(true));
  listen('compositionend', () => handlers.composition?.(false));
  listen('keydown', event => { handlers.handleKey?.(event); queueMicrotask(updateCaret); });
  const syncSelection = () => { handlers.setInput?.(input.value, input.selectionStart, input.selectionEnd); updateCaret(); };
  for (const eventName of ['click', 'keyup', 'select']) listen(eventName, syncSelection);
  for (const eventName of ['focus', 'scroll', 'terminal-caret-sync']) listen(eventName, updateCaret);
  inputWrap.append(label, input, trail, caret, measure);
  const arrow = promptArrow(documentRef, fontFallback);
  line.append(arrow, inputWrap);
  node.append(context, line);
  return {
    node, input, label, caret, trail, measure, glyph, arrow, parentPath, currentPath, fontFallback, completion: null, updateCaret,
    rendered: false, pathReady: false, pathIndex: null, pathNodeId: null,
    get destroyed() { return destroyed; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const [eventName, listener] of listeners) input.removeEventListener(eventName, listener);
      listeners.length = 0;
      caretMotion.destroy();
    }
  };
}

function syncPrompt(documentRef, prompt, state, index, handlers) {
  if (prompt.destroyed) return;
  const firstRender = !prompt.rendered;
  const wasHidden = prompt.node.hidden;
  const hidden = state.foreground !== null;
  const becameVisible = !firstRender && wasHidden && !hidden;
  const activeElement = documentRef.activeElement;
  const shouldFocus = !hidden && (
    becameVisible
    || (firstRender && (!activeElement || activeElement === documentRef.body || activeElement === prompt.input))
  );
  prompt.node.hidden = hidden;
  prompt.label.textContent = message(state, 'renderer.commandLabel');
  prompt.input.placeholder = message(state, 'renderer.placeholder');
  const fontFallback = documentRef.documentElement?.classList.contains('font-fallback');
  if (fontFallback !== prompt.fontFallback) {
    prompt.glyph.textContent = fontFallback ? 'time' : '';
    prompt.arrow.textContent = fontFallback ? ' >' : ' ➤';
    prompt.fontFallback = fontFallback;
  }
  if (!prompt.pathReady || prompt.pathIndex !== index || prompt.pathNodeId !== state.cwdNodeId) {
    syncPromptPath(prompt.parentPath, prompt.currentPath, promptPath(state.cwdNodeId, index));
    prompt.pathReady = true;
    prompt.pathIndex = index;
    prompt.pathNodeId = state.cwdNodeId;
  }
  if (prompt.input.value !== state.input.value) prompt.input.value = state.input.value;
  syncCompletionAccessibility(prompt.input, state.completion);
  prompt.completion?.remove();
  prompt.completion = renderCompletion(documentRef, state.completion, handlers);
  if (prompt.completion) prompt.node.append(prompt.completion);
  try { prompt.input.setSelectionRange(state.input.selectionStart, state.input.selectionEnd); } catch { /* Optional input API. */ }
  prompt.rendered = true;
  prompt.updateCaret();
  scrollCompletionOption(documentRef, state.completion?.activeIndex);
  if (shouldFocus) {
    queueMicrotask(() => {
      if (prompt.destroyed) return;
      try {
        prompt.input.focus({ preventScroll: true });
        prompt.input.scrollIntoView?.({ block: 'nearest' });
        prompt.updateCaret();
      } catch { /* Focus is progressive enhancement. */ }
    });
  }
  if (prompt.completion) {
    queueMicrotask(() => {
      if (prompt.destroyed) return;
      try { scrollCompletionViewport(documentRef, prompt); } catch { /* Viewport following is progressive enhancement. */ }
    });
  }
}

export function createTerminalRenderer(root, handlers = {}) {
  if (!root?.ownerDocument) throw new TypeError('Terminal root is required');
  const documentRef = root.ownerDocument;
  const runtime = element(documentRef, 'div', 'terminal-runtime');
  const brand = element(documentRef, 'strong', 'terminal-brand', TERMINAL_BRAND);
  const welcome = renderWelcome(documentRef, handlers);
  const transcript = element(documentRef, 'div', 'terminal-transcript');
  const output = element(documentRef, 'div', 'terminal-output');
  const prompt = createActivePrompt(documentRef, handlers);
  brand.setAttribute('aria-label', translate(DEFAULT_LANGUAGE, 'renderer.brandLabel'));
  brand.setAttribute('translate', 'no');
  runtime.append(brand, welcome, transcript, output, prompt.node);
  root.replaceChildren(runtime);
  let lastModel = null;
  let lastIndex = null;
  let outputKey;
  let followedHistoryEntryId = null;
  let followedHistoryResult = null;
  let welcomeDismissed = false;
  const transcriptNodes = new Map();

  return Object.freeze({
    render(state, index) {
      try {
        if (index) void index.posts;
        const model = createViewModel(state, index);
        brand.setAttribute('aria-label', message(state, 'renderer.brandLabel'));
        syncWelcome(welcome, languageOf(state));
        const entries = state.transcript || [];
        if (!welcomeDismissed && (
          state.route?.kind !== 'root' || entries.length > 0 || state.foreground !== null || state.output !== null
        )) welcomeDismissed = true;
        welcome.hidden = welcomeDismissed;
        syncTranscript(documentRef, transcript, transcriptNodes, entries, index, state);
        const nextKey = outputIdentity(state);
        if (nextKey !== outputKey) {
          const nextOutput = renderOutput(documentRef, state, model, handlers);
          output.replaceChildren(nextOutput);
          outputKey = nextKey;
        }
        syncPrompt(documentRef, prompt, state, index, handlers);
        const latestEntry = entries.at(-1);
        if (latestEntry?.result && (
          latestEntry.id !== followedHistoryEntryId || latestEntry.result !== followedHistoryResult
        )) {
          followedHistoryEntryId = latestEntry.id;
          followedHistoryResult = latestEntry.result;
          const anchor = transcriptNodes.get(latestEntry.id)?.node;
          const tail = prompt.node.hidden ? anchor : prompt.node;
          queueMicrotask(() => {
            if (prompt.destroyed) return;
            try { scrollViewportWithinAnchor(documentRef, anchor, tail); } catch { /* Viewport following is progressive enhancement. */ }
          });
        }
        lastModel = model;
        lastIndex = index;
        return model;
      } catch (error) {
        handlers.renderError?.(error);
        if (lastModel) return lastModel;
        throw error;
      }
    },
    syncActiveRow(state, options = {}) {
      if (syncActiveControls(output, state, options) || !state.activeItemId || !lastIndex) return;
      try {
        const model = createViewModel(state, lastIndex);
        const nextOutput = renderOutput(documentRef, state, model, handlers);
        output.replaceChildren(nextOutput);
        lastModel = model;
        syncActiveControls(output, state, options);
      } catch (error) {
        handlers.renderError?.(error);
      }
    },
    inputNode() { return prompt.input; },
    destroy() { prompt.destroy(); prompt.completion?.remove(); transcriptNodes.clear(); }
  });
}
