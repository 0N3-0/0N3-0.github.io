import { translate } from '../i18n.mjs';

export const TAB_STORAGE_KEY = 'one-terminal:tab:v1';

const DEFAULT_METRICS = Object.freeze({ radius: 26, margin: 12 });
const CLICK_DISTANCE = 6;

const finite = value => Number.isFinite(value);
const numberOr = (value, fallback) => finite(Number(value)) ? Number(value) : fallback;
const nonNegative = value => Math.max(0, numberOr(value, 0));

function normalizedViewport(viewport = {}) {
  return {
    offsetLeft: numberOr(viewport.offsetLeft, 0),
    offsetTop: numberOr(viewport.offsetTop, 0),
    width: nonNegative(viewport.width),
    height: nonNegative(viewport.height)
  };
}

function normalizedMetrics(metrics = DEFAULT_METRICS) {
  return {
    radius: nonNegative(metrics.radius ?? DEFAULT_METRICS.radius),
    margin: nonNegative(metrics.margin ?? DEFAULT_METRICS.margin),
    safeLeft: nonNegative(metrics.safeLeft),
    safeRight: nonNegative(metrics.safeRight),
    safeTop: nonNegative(metrics.safeTop),
    safeBottom: nonNegative(metrics.safeBottom)
  };
}

function axisBounds(offset, size, before, after) {
  const minimum = offset + before;
  const maximum = offset + size - after;
  if (minimum <= maximum) return { minimum, maximum };
  const center = offset + size / 2;
  return { minimum: center, maximum: center };
}

function positionBounds(viewport, metrics) {
  const value = normalizedViewport(viewport);
  const measure = normalizedMetrics(metrics);
  const padding = measure.radius + measure.margin;
  return {
    viewport: value,
    x: axisBounds(
      value.offsetLeft,
      value.width,
      padding + measure.safeLeft,
      padding + measure.safeRight
    ),
    y: axisBounds(
      value.offsetTop,
      value.height,
      padding + measure.safeTop,
      padding + measure.safeBottom
    )
  };
}

export function classifyPointerGesture(start, current, cancelled = false) {
  if (cancelled) return 'cancel';
  const dx = Number(current?.x) - Number(start?.x);
  const dy = Number(current?.y) - Number(start?.y);
  if (!finite(dx) || !finite(dy)) return 'cancel';
  return Math.hypot(dx, dy) <= CLICK_DISTANCE ? 'click' : 'drag';
}

export function clampTabPosition(position, viewport, metrics = DEFAULT_METRICS) {
  const bounds = positionBounds(viewport, metrics);
  const requestedX = finite(Number(position?.x)) ? Number(position.x) : bounds.x.maximum;
  const requestedY = finite(Number(position?.y)) ? Number(position.y) : bounds.y.maximum;
  return {
    x: Math.min(bounds.x.maximum, Math.max(bounds.x.minimum, requestedX)),
    y: Math.min(bounds.y.maximum, Math.max(bounds.y.minimum, requestedY))
  };
}

export function serializeTabPosition(position, viewport, metrics = DEFAULT_METRICS) {
  const bounds = positionBounds(viewport, metrics);
  const x = Number(position?.x);
  const y = Number(position?.y);
  if (!finite(x) || !finite(y)) return { xRatio: 1, yRatio: 1 };
  const ratio = (coordinate, axis) => {
    const size = axis.maximum - axis.minimum;
    if (size <= 0) return 1;
    return Math.min(1, Math.max(0, (coordinate - axis.minimum) / size));
  };
  return {
    xRatio: ratio(x, bounds.x),
    yRatio: ratio(y, bounds.y)
  };
}

function parseSavedPosition(saved) {
  if (typeof saved === 'string') {
    try { return JSON.parse(saved); } catch { return null; }
  }
  return saved;
}

export function restoreTabPosition(saved, viewport, metrics = DEFAULT_METRICS) {
  const value = normalizedViewport(viewport);
  const bounds = positionBounds(value, metrics);
  const parsed = parseSavedPosition(saved);
  const xRatio = Number(parsed?.xRatio);
  const yRatio = Number(parsed?.yRatio);
  const valid = finite(xRatio)
    && finite(yRatio)
    && xRatio >= 0
    && xRatio <= 1
    && yRatio >= 0
    && yRatio <= 1;
  if (!valid) return clampTabPosition(null, value, metrics);
  return clampTabPosition({
    x: bounds.x.minimum + (bounds.x.maximum - bounds.x.minimum) * xRatio,
    y: bounds.y.minimum + (bounds.y.maximum - bounds.y.minimum) * yRatio
  }, value, metrics);
}

function intersects(first, second) {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}

function positionRect(position, radius) {
  return {
    left: position.x - radius,
    right: position.x + radius,
    top: position.y - radius,
    bottom: position.y + radius
  };
}

function viewportFrom(visualViewport, windowRef) {
  if (visualViewport) {
    return normalizedViewport(visualViewport);
  }
  return normalizedViewport({
    offsetLeft: 0,
    offsetTop: 0,
    width: windowRef?.innerWidth,
    height: windowRef?.innerHeight
  });
}

function safeAreaMetrics(windowRef, button) {
  const computed = windowRef?.getComputedStyle?.(button);
  const cssNumber = name => nonNegative(Number.parseFloat(computed?.getPropertyValue?.(name) || '0'));
  return {
    ...DEFAULT_METRICS,
    safeLeft: cssNumber('--mobile-safe-left'),
    safeRight: cssNumber('--mobile-safe-right'),
    safeTop: cssNumber('--mobile-safe-top'),
    safeBottom: cssNumber('--mobile-safe-bottom')
  };
}

export function mountFloatingControl({
  root,
  storage = null,
  visualViewport = null,
  className = 'mobile-tab',
  text = '',
  ariaLabel = '',
  onActivate,
  subscribe = null,
  findObstacle = null
} = {}) {
  if (!root?.ownerDocument || typeof onActivate !== 'function') return () => {};
  const documentRef = root.ownerDocument;
  const windowRef = documentRef.defaultView;
  const button = documentRef.createElement('button');
  button.setAttribute('type', 'button');
  button.setAttribute('translate', 'no');
  const syncLabel = () => button.setAttribute(
    'aria-label',
    String(typeof ariaLabel === 'function' ? ariaLabel() : ariaLabel)
  );
  syncLabel();
  button.className = className;
  button.textContent = text;
  root.append(button);

  const currentMetrics = () => safeAreaMetrics(windowRef, button);
  let saved = null;
  try { saved = storage?.getItem?.(TAB_STORAGE_KEY) ?? null; } catch { saved = null; }
  let savedRatio = parseSavedPosition(saved);
  let committed = restoreTabPosition(savedRatio, viewportFrom(visualViewport, windowRef), currentMetrics());
  let displayed = committed;
  let pointer = null;
  let frameQueued = false;
  let removed = false;
  let suppressPointerClick = false;

  const requestFrame = windowRef?.requestAnimationFrame?.bind(windowRef) ?? (callback => callback());
  const render = () => {
    if (removed) return;
    const metrics = currentMetrics();
    button.position = { ...displayed };
    button.style.transform = `translate3d(${displayed.x - metrics.radius}px, ${displayed.y - metrics.radius}px, 0)`;
  };
  const scheduleRender = () => {
    if (frameQueued) return;
    frameQueued = true;
    requestFrame(() => {
      frameQueued = false;
      render();
    });
  };

  const focusedObstacle = () => {
    try { return typeof findObstacle === 'function' ? findObstacle() : null; } catch { return null; }
  };

  const avoidFocusedOverlap = (viewport, metrics) => {
    const obstacle = focusedObstacle();
    if (!obstacle?.getBoundingClientRect) return;
    let obstacleRect = obstacle.getBoundingClientRect();
    if (!intersects(positionRect(displayed, metrics.radius), obstacleRect)) return;
    obstacle.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    obstacleRect = obstacle.getBoundingClientRect();
    if (!intersects(positionRect(displayed, metrics.radius), obstacleRect)) return;
    const bounds = positionBounds(viewport, metrics);
    const choices = [bounds.x.minimum, bounds.x.maximum]
      .map(x => ({ x, distance: Math.abs(x - displayed.x) }))
      .sort((left, right) => left.distance - right.distance);
    const free = choices.find(choice => !intersects(
      positionRect({ x: choice.x, y: displayed.y }, metrics.radius),
      obstacleRect
    ));
    displayed = clampTabPosition({ x: (free ?? choices[0]).x, y: displayed.y }, viewport, metrics);
  };

  const restoreForViewport = () => {
    const viewport = viewportFrom(visualViewport, windowRef);
    const metrics = currentMetrics();
    committed = restoreTabPosition(savedRatio, viewport, metrics);
    displayed = committed;
    avoidFocusedOverlap(viewport, metrics);
    scheduleRender();
  };

  const restoreCommitted = () => {
    const viewport = viewportFrom(visualViewport, windowRef);
    const metrics = currentMetrics();
    displayed = clampTabPosition(committed, viewport, metrics);
    avoidFocusedOverlap(viewport, metrics);
    scheduleRender();
  };

  const releaseCapture = pointerId => {
    try { button.releasePointerCapture?.(pointerId); } catch { /* Capture may already be gone. */ }
  };

  const cancelPointer = () => {
    if (!pointer) return;
    const pointerId = pointer.id;
    pointer = null;
    suppressPointerClick = true;
    releaseCapture(pointerId);
    restoreCommitted();
  };

  const onPointerDown = event => {
    if (pointer) cancelPointer();
    if (!event.isPrimary || event.button !== 0) return;
    suppressPointerClick = false;
    const start = { x: Number(event.clientX), y: Number(event.clientY) };
    if (!finite(start.x) || !finite(start.y)) return;
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      suppressPointerClick = true;
      restoreCommitted();
      return;
    }
    pointer = { id: event.pointerId, start, origin: displayed, current: start };
    event.preventDefault?.();
  };

  const onPointerMove = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    pointer.current = { x: Number(event.clientX), y: Number(event.clientY) };
    const metrics = currentMetrics();
    displayed = clampTabPosition({
      x: pointer.origin.x + pointer.current.x - pointer.start.x,
      y: pointer.origin.y + pointer.current.y - pointer.start.y
    }, viewportFrom(visualViewport, windowRef), metrics);
    scheduleRender();
    event.preventDefault?.();
  };

  const onPointerUp = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const activePointer = pointer;
    pointer = null;
    suppressPointerClick = true;
    releaseCapture(activePointer.id);
    const current = { x: Number(event.clientX), y: Number(event.clientY) };
    const gesture = classifyPointerGesture(activePointer.start, current, false);
    if (gesture === 'click') {
      restoreCommitted();
      onActivate();
    } else if (gesture === 'drag') {
      const viewport = viewportFrom(visualViewport, windowRef);
      const metrics = currentMetrics();
      committed = clampTabPosition(displayed, viewport, metrics);
      savedRatio = serializeTabPosition(committed, viewport, metrics);
      try { storage?.setItem?.(TAB_STORAGE_KEY, JSON.stringify(savedRatio)); } catch { /* Persistence is optional. */ }
      restoreCommitted();
    } else {
      restoreCommitted();
    }
    event.preventDefault?.();
  };

  const onClick = event => {
    if (suppressPointerClick && event.detail !== 0) {
      suppressPointerClick = false;
      event.preventDefault?.();
      return;
    }
    suppressPointerClick = false;
    onActivate();
  };

  const onFocusChange = () => restoreForViewport();
  const onStateChange = () => {
    syncLabel();
    queueMicrotask(() => {
      if (!removed) restoreForViewport();
    });
  };
  const unsubscribe = typeof subscribe === 'function' ? subscribe(onStateChange) : (() => {});
  const listeners = [
    [button, 'pointerdown', onPointerDown],
    [button, 'pointermove', onPointerMove],
    [button, 'pointerup', onPointerUp],
    [button, 'pointercancel', cancelPointer],
    [button, 'lostpointercapture', cancelPointer],
    [button, 'click', onClick],
    [visualViewport, 'resize', restoreForViewport],
    [visualViewport, 'scroll', restoreForViewport],
    [windowRef, 'orientationchange', restoreForViewport],
    [windowRef, 'resize', restoreForViewport],
    [documentRef, 'focusin', onFocusChange],
    [documentRef, 'focusout', onFocusChange]
  ].filter(([target]) => target?.addEventListener);

  for (const [target, type, listener] of listeners) target.addEventListener(type, listener);
  restoreCommitted();

  return () => {
    removed = true;
    cancelPointer();
    unsubscribe?.();
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
    button.remove();
  };
}

export function mountMobileTab({ root, controller, storage = null, visualViewport = null } = {}) {
  if (!root?.ownerDocument || typeof controller?.handleKey !== 'function') return () => {};
  const documentRef = root.ownerDocument;
  const findObstacle = () => {
    const active = documentRef.activeElement;
    if (active?.matches?.('[data-terminal-input], .terminal-completion-option[aria-selected="true"], [data-row-id][tabindex="0"]')) return active;
    return root.querySelector?.('.terminal-completion-option[aria-selected="true"], [data-row-id][tabindex="0"]') ?? null;
  };
  return mountFloatingControl({
    root,
    storage,
    visualViewport,
    text: 'Tab',
    ariaLabel: () => translate(controller.state?.language, 'mobileTab.next'),
    onActivate: () => controller.handleKey({ key: 'Tab', preventDefault() {} }),
    subscribe: listener => controller.subscribe?.(listener) ?? (() => {}),
    findObstacle
  });
}
