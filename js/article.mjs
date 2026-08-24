import { validateIndex, validateNavigationUrl } from './terminal/model.mjs';
import { readReturnRecord, writeReturnRecord } from './terminal/session.mjs';

const BUILD_ID = /^[0-9a-f]{16}$/u;
const ARTICLE_ID = /^post:[0-9a-f]{12}$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const articleMounts = new WeakMap();
let controlSequence = 0;

function integer(value) {
  const input = String(value ?? '');
  if (!UNSIGNED_INTEGER.test(input)) return null;
  const result = Number(input);
  return Number.isSafeInteger(result) ? result : null;
}

export function normalizedDisplayMathText(childNodes) {
  const parts = [];
  let hasBreak = false;
  for (const node of Array.from(childNodes || [])) {
    if (node?.nodeType === 3) {
      parts.push(String(node.data ?? node.textContent ?? ''));
      continue;
    }
    if (node?.nodeType === 1 && String(node.tagName || '').toUpperCase() === 'BR') {
      parts.push('\n');
      hasBreak = true;
      continue;
    }
    return null;
  }
  if (!hasBreak) return null;

  const source = parts.join('').trim();
  if (!source.startsWith('$$') || !source.endsWith('$$')) return null;
  const expression = source.slice(2, -2).trim();
  if (!expression || expression.includes('$$')) return null;
  return `$$\n${expression}\n$$`;
}

export function normalizeDisplayMathParagraphs(root) {
  if (!root?.querySelectorAll) return 0;
  let normalized = 0;
  for (const paragraph of root.querySelectorAll('p')) {
    if (paragraph.closest?.('pre, code, .no-math')) continue;
    const text = normalizedDisplayMathText(paragraph.childNodes);
    if (text === null) continue;
    paragraph.textContent = text;
    normalized += 1;
  }
  return normalized;
}

export function renderArticleMath(documentObject, renderMath, options = {}) {
  const content = documentObject?.querySelector?.('.post-content');
  if (!content || typeof renderMath !== 'function') return 0;

  normalizeDisplayMathParagraphs(content);
  const roots = [content];
  const toc = documentObject.querySelector('.article-toc');
  if (toc) roots.push(toc);

  for (const root of roots) {
    renderMath(root, {
      ...options,
      macros: { ...(options.macros || {}) }
    });
  }
  return roots.length;
}

export function validateArticleMetadata(dataset, { origin, currentUrl }) {
  try {
    const schemaVersion = integer(dataset?.schemaVersion);
    const returnTtlMs = integer(dataset?.returnTtlMs);
    if (schemaVersion === null
      || returnTtlMs === null
      || !BUILD_ID.test(String(dataset?.buildId || ''))
      || !ARTICLE_ID.test(String(dataset?.articleId || ''))) return null;

    const rootUrl = validateNavigationUrl(dataset.rootUrl, { origin, root: dataset.rootUrl });
    const root = new URL(rootUrl);
    if (root.search || root.hash) return null;
    const rootPath = root.pathname.endsWith('/') ? root.pathname : `${root.pathname}/`;
    const articleUrl = validateNavigationUrl(dataset.articleUrl, { origin: root.origin, root: rootPath });
    const article = new URL(articleUrl);
    if (article.search || article.hash) return null;

    const current = new URL(currentUrl);
    if (current.origin !== article.origin || current.pathname !== article.pathname) return null;

    return Object.freeze({
      schemaVersion,
      buildId: String(dataset.buildId),
      articleId: String(dataset.articleId),
      articleUrl,
      rootUrl,
      rootPath,
      returnTtlMs
    });
  } catch {
    return null;
  }
}

function indexedArticle(index, metadata, articleUrl = metadata.articleUrl) {
  if (!index
    || index.schemaVersion !== metadata.schemaVersion
    || index.buildId !== metadata.buildId
    || !Array.isArray(index.posts)) return null;
  return index.posts.find(post => post?.type === 'post'
    && post.id === (articleUrl === metadata.articleUrl ? metadata.articleId : post.id)
    && post.url === articleUrl) || null;
}

export function resolveArticleReturn({ storage, metadata, now, index }) {
  if (!metadata || !storage) return null;
  const record = readReturnRecord(storage, {
    now,
    ttlMs: metadata.returnTtlMs,
    schemaVersion: metadata.schemaVersion,
    buildId: metadata.buildId,
    origin: new URL(metadata.rootUrl).origin,
    root: metadata.rootPath
  });
  if (!record) return null;

  if (record.targetArticleUrl === metadata.articleUrl) return record;
  if (record.targetArticleUrl !== null) return null;
  if (!indexedArticle(index, metadata)) return null;

  const bound = { ...record, targetArticleUrl: metadata.articleUrl };
  return writeReturnRecord(storage, bound) ? bound : null;
}

export function isPlainPrimaryClick(event) {
  return Boolean(event)
    && event.defaultPrevented !== true
    && event.button === 0
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey;
}

export function updateArticleChainRecord({ storage, record, metadata, index, href, event }) {
  if (!isPlainPrimaryClick(event) || !storage || !record || !metadata) return false;
  if (record.schemaVersion !== metadata.schemaVersion
    || record.buildId !== metadata.buildId
    || record.targetArticleUrl !== metadata.articleUrl) return false;
  try {
    const targetUrl = validateNavigationUrl(href, {
      origin: new URL(metadata.rootUrl).origin,
      root: metadata.rootPath
    });
    if (!indexedArticle(index, metadata, targetUrl)) return false;
    return writeReturnRecord(storage, { ...record, targetArticleUrl: targetUrl });
  } catch {
    return false;
  }
}

function directChild(element, className) {
  return Array.from(element?.children || []).find(child => child.classList?.contains(className)) || null;
}

function codeLanguage(figure) {
  const language = Array.from(figure.classList || [])
    .find(className => className !== 'highlight' && className !== 'article-code-enhanced');
  return !language || language === 'plain' || language === 'text' ? 'code' : language;
}

function button(documentObject, className, label, text) {
  const control = documentObject.createElement('button');
  control.className = className;
  control.type = 'button';
  control.textContent = text;
  control.setAttribute('aria-label', label);
  return control;
}

function ensureControlId(element, prefix) {
  const existing = element.getAttribute('id');
  if (existing) return existing;
  controlSequence += 1;
  const id = `${prefix}-${controlSequence}`;
  element.setAttribute('id', id);
  return id;
}

export function enhanceCodeBlocks(root, {
  clipboard = globalThis.navigator?.clipboard,
  collapseHeight = 320,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout
} = {}) {
  const documentObject = root?.ownerDocument || root;
  if (!documentObject?.createElement || !root?.querySelectorAll) return () => {};
  const listeners = [];
  const timers = new Set();
  let active = true;

  for (const figure of root.querySelectorAll('figure.highlight')) {
    if (figure.dataset.articleCodeMounted === 'true') continue;
    figure.dataset.articleCodeMounted = 'true';
    const language = codeLanguage(figure);
    let copy = directChild(figure, 'highlight-bar');
    if (!copy) {
      copy = button(documentObject, 'highlight-bar', `复制 ${language} 代码`, language);
      copy.dataset.lang = language;
      figure.appendChild(copy);
    }

    let body = directChild(figure, 'code-body');
    let measuredHeight = 0;
    if (!body) {
      const table = figure.querySelector('table');
      if (table?.parentNode) {
        measuredHeight = table.scrollHeight;
        body = documentObject.createElement('div');
        body.className = 'code-body';
        const scroll = documentObject.createElement('div');
        scroll.className = 'code-scroll';
        table.parentNode.replaceChild(body, table);
        body.appendChild(scroll);
        scroll.appendChild(table);
      }
    }

    let expand = directChild(figure, 'code-expand');
    if (!expand) {
      expand = button(documentObject, 'code-expand', '展开代码块', '▼');
      expand.setAttribute('aria-expanded', 'false');
      figure.appendChild(expand);
    }
    if (body) {
      expand.setAttribute('aria-controls', ensureControlId(body, 'article-code'));
      if (measuredHeight === 0) measuredHeight = body.scrollHeight;
      body.classList.toggle('collapsible', measuredHeight > collapseHeight);
      expand.hidden = measuredHeight <= collapseHeight;
    } else {
      expand.hidden = true;
    }

    const onCopy = () => {
      const code = figure.querySelector('.code') || figure.querySelector('pre');
      if (!active || !code || typeof clipboard?.writeText !== 'function') return;
      Promise.resolve().then(() => clipboard.writeText(code.innerText)).then(() => {
        if (!active) return;
        copy.textContent = 'done';
        copy.classList.add('copied');
        copy.setAttribute('aria-label', '代码已复制');
        if (typeof setTimeoutImpl !== 'function') return;
        const timer = setTimeoutImpl(() => {
          timers.delete(timer);
          copy.textContent = copy.dataset.lang || 'code';
          copy.classList.remove('copied');
          copy.setAttribute('aria-label', `复制 ${copy.dataset.lang || 'code'} 代码`);
        }, 1500);
        timers.add(timer);
      }).catch(() => {});
    };
    const onExpand = () => {
      if (!body || expand.hidden) return;
      const expanded = body.classList.toggle('expanded');
      expand.textContent = expanded ? '▲' : '▼';
      expand.setAttribute('aria-expanded', String(expanded));
      expand.setAttribute('aria-label', expanded ? '收起代码块' : '展开代码块');
    };
    copy.addEventListener('click', onCopy);
    expand.addEventListener('click', onExpand);
    listeners.push([copy, onCopy], [expand, onExpand], [figure, null]);
  }

  return () => {
    active = false;
    for (const [element, listener] of listeners) {
      if (listener) element.removeEventListener('click', listener);
      else delete element.dataset.articleCodeMounted;
    }
    if (typeof clearTimeoutImpl === 'function') {
      for (const timer of timers) clearTimeoutImpl(timer);
    }
    timers.clear();
  };
}

export function enhanceArticleToc(root, {
  IntersectionObserverImpl = globalThis.IntersectionObserver,
  matchMediaImpl = globalThis.matchMedia
} = {}) {
  const tocRoot = root?.matches?.('.article-toc') ? root : root?.querySelector?.('.article-toc');
  if (!tocRoot || tocRoot.dataset.articleTocMounted === 'true') return () => {};
  tocRoot.dataset.articleTocMounted = 'true';
  const documentObject = tocRoot.ownerDocument || root;
  const listeners = [];
  let scrollBehavior = 'smooth';
  try {
    if (typeof matchMediaImpl === 'function' && matchMediaImpl('(prefers-reduced-motion: reduce)').matches) {
      scrollBehavior = 'auto';
    }
  } catch {
    scrollBehavior = 'auto';
  }

  const buildTree = (list, prefix = '') => {
    const items = Array.from(list?.children || []).filter(item => item.classList?.contains('toc-item'));
    items.forEach((item, index) => {
      const link = directChild(item, 'toc-link');
      const childList = directChild(item, 'toc-child');
      const hasChildren = Boolean(childList?.children?.length);
      const isLast = index === items.length - 1;
      let line = directChild(item, 'tree-line');
      if (!line) {
        line = documentObject.createElement('span');
        line.className = 'tree-line';
        item.insertBefore(line, link || item.children[0] || null);
      }
      line.textContent = `${prefix}${isLast ? '└── ' : '├── '}`;
      if (!hasChildren || !link) return;

      let toggle = directChild(item, 'tree-toggle');
      if (!toggle) {
        toggle = button(documentObject, 'tree-toggle', '收起子目录', '▼');
        toggle.setAttribute('aria-expanded', 'true');
        item.insertBefore(toggle, link);
      }
      toggle.setAttribute('aria-controls', ensureControlId(childList, 'article-toc-branch'));
      const onBranchTransitionEnd = event => {
        if (event.target !== childList || event.propertyName !== 'max-height') return;
        if (!childList.classList.contains('collapsed')) childList.style.maxHeight = '';
      };
      const onToggle = event => {
        event.preventDefault();
        event.stopPropagation();
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        childList.hidden = false;
        childList.style.maxHeight = `${Math.max(0, Number(childList.scrollHeight) || 0)}px`;
        if (expanded) void childList.offsetHeight;
        childList.classList.toggle('collapsed', expanded);
        childList.inert = expanded;
        if (expanded) childList.setAttribute('aria-hidden', 'true');
        else childList.removeAttribute('aria-hidden');
        toggle.textContent = expanded ? '▶' : '▼';
        toggle.setAttribute('aria-expanded', String(!expanded));
        toggle.setAttribute('aria-label', expanded ? '展开子目录' : '收起子目录');
      };
      toggle.addEventListener('click', onToggle);
      childList.addEventListener('transitionend', onBranchTransitionEnd);
      listeners.push([toggle, 'click', onToggle], [childList, 'transitionend', onBranchTransitionEnd]);
      buildTree(childList, prefix + (isLast ? '    ' : '│   '));
    });
  };
  buildTree(tocRoot.querySelector('.toc'));

  const tocViewport = tocRoot.querySelector('.sidebar-right-inner');
  let tocToggle = directChild(tocRoot, 'article-toc-toggle');
  if (tocViewport) {
    if (!tocToggle) {
      tocToggle = button(documentObject, 'article-toc-toggle', '隐藏文章目录', '›');
      tocRoot.insertBefore(tocToggle, tocViewport);
    }
    tocToggle.setAttribute('aria-controls', ensureControlId(tocViewport, 'article-toc'));
    const setTocHidden = hidden => {
      tocRoot.classList.toggle('article-toc-hidden', hidden);
      tocViewport.inert = hidden;
      if (hidden) tocViewport.setAttribute('aria-hidden', 'true');
      else tocViewport.removeAttribute('aria-hidden');
      tocToggle.textContent = hidden ? '‹' : '›';
      tocToggle.setAttribute('aria-expanded', String(!hidden));
      tocToggle.setAttribute('aria-label', hidden ? '显示文章目录' : '隐藏文章目录');
    };
    const onTocToggle = () => {
      const hidden = !tocRoot.classList.contains('article-toc-hidden');
      setTocHidden(hidden);
      if (!hidden) {
        const activeLink = Array.from(tocRoot.querySelectorAll('.toc-link'))
          .find(link => link.classList.contains('active'));
        if (activeLink) centerTocLink(tocViewport, activeLink, scrollBehavior);
      }
    };
    setTocHidden(tocRoot.classList.contains('article-toc-hidden'));
    tocToggle.addEventListener('click', onTocToggle);
    listeners.push([tocToggle, 'click', onTocToggle]);
  }

  const content = documentObject.querySelector?.('.post-content');
  if (content) {
    const topHeadings = Array.from(content.querySelectorAll('h1'));
    for (const link of tocRoot.querySelectorAll('.toc-link')) {
      if (link.getAttribute('href') || !link.closest?.('.toc-level-1')) continue;
      const label = (link.querySelector('.toc-text') || link).textContent.trim();
      const heading = topHeadings.find(candidate => candidate.textContent.trim() === label);
      if (!heading) continue;
      if (!heading.getAttribute('id')) heading.setAttribute('id', label);
      link.setAttribute('href', `#${encodeURIComponent(heading.getAttribute('id'))}`);
    }
  }

  const headings = [];
  for (const link of tocRoot.querySelectorAll('.toc-link')) {
    const href = link.getAttribute('href');
    if (!href?.startsWith('#')) continue;
    try {
      const target = documentObject.getElementById(decodeURIComponent(href.slice(1)));
      if (target) headings.push({ link, target });
    } catch {
      // Invalid fragments stay ordinary native links.
    }
  }

  let observer = null;
  if (typeof IntersectionObserverImpl === 'function' && headings.length > 0) {
    observer = new IntersectionObserverImpl(entries => {
      const active = entries.find(entry => entry.isIntersecting);
      if (!active) return;
      for (const heading of headings) {
        const selected = heading.target === active.target;
        heading.link.classList.toggle('active', selected);
        if (selected) {
          heading.link.setAttribute('aria-current', 'location');
          if (!tocRoot.classList.contains('article-toc-hidden')) {
            centerTocLink(tocViewport, heading.link, scrollBehavior);
          }
        }
        else heading.link.removeAttribute('aria-current');
      }
    }, { rootMargin: '-64px 0px -75% 0px', threshold: 0 });
    headings.forEach(({ target }) => observer.observe(target));
  }

  return () => {
    for (const [element, eventName, listener] of listeners) element.removeEventListener(eventName, listener);
    observer?.disconnect();
    delete tocRoot.dataset.articleTocMounted;
  };
}

function centerTocLink(container, link, behavior) {
  if (!container || !link || typeof container.scrollTo !== 'function') return;
  const viewportHeight = Math.max(0, Number(container.clientHeight) || 0);
  const contentHeight = Math.max(0, Number(container.scrollHeight) || 0);
  if (viewportHeight === 0 || contentHeight <= viewportHeight) return;
  let linkTop = Math.max(0, Number(link.offsetTop) || 0);
  let linkHeight = Math.max(0, Number(link.offsetHeight) || 0);
  try {
    const viewportRect = container.getBoundingClientRect?.();
    const linkRect = link.getBoundingClientRect?.();
    if (viewportRect && linkRect) {
      linkTop = (Number(container.scrollTop) || 0) + linkRect.top - viewportRect.top;
      linkHeight = Math.max(0, Number(linkRect.height) || 0);
    }
  } catch {
    // Offset geometry remains a safe fallback for lightweight DOM implementations.
  }
  const maximum = Math.max(0, contentHeight - viewportHeight);
  const top = Math.max(0, Math.min(maximum, linkTop - (viewportHeight - linkHeight) / 2));
  try { container.scrollTo({ top, behavior }); } catch { container.scrollTop = top; }
}

async function loadArticleIndex(fetchImpl, metadata, {
  timeoutMs,
  AbortControllerImpl,
  setTimeoutImpl,
  clearTimeoutImpl
}) {
  if (typeof fetchImpl !== 'function') return null;
  let timer;
  const abort = typeof AbortControllerImpl === 'function' ? new AbortControllerImpl() : null;
  try {
    const indexUrl = validateNavigationUrl(new URL('terminal-index.json', metadata.rootUrl).href, {
      origin: new URL(metadata.rootUrl).origin,
      root: metadata.rootPath
    });
    const request = Promise.resolve()
      .then(() => fetchImpl(indexUrl, abort ? { signal: abort.signal } : {}))
      .then(async response => {
        if (!response?.ok) return null;
        const index = validateIndex(await response.json(), {
          schemaVersion: metadata.schemaVersion,
          origin: new URL(metadata.rootUrl).origin,
          root: metadata.rootPath
        });
        return index.buildId === metadata.buildId ? index : null;
      })
      .catch(() => null);
    if (typeof setTimeoutImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
      return await request;
    }
    const timeout = new Promise(resolve => {
      timer = setTimeoutImpl(() => {
        abort?.abort();
        resolve(null);
      }, timeoutMs);
    });
    return await Promise.race([request, timeout]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined && typeof clearTimeoutImpl === 'function') clearTimeoutImpl(timer);
  }
}

async function mountArticlePage({
  document: documentObject = globalThis.document,
  window: windowObject = globalThis.window,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  indexTimeoutMs = 8000,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout
} = {}) {
  const cleanups = [
    enhanceCodeBlocks(documentObject),
    enhanceArticleToc(documentObject, {
      IntersectionObserverImpl: windowObject?.IntersectionObserver,
      matchMediaImpl: windowObject?.matchMedia?.bind?.(windowObject)
    })
  ];
  const cleanup = () => cleanups.splice(0).forEach(dispose => dispose());
  const shell = documentObject?.querySelector?.('.article-shell');
  const returnLink = documentObject?.querySelector?.('.article-return');
  if (!shell || !returnLink || !windowObject?.location) return cleanup;

  const metadata = validateArticleMetadata(shell.dataset, {
    origin: windowObject.location.origin,
    currentUrl: windowObject.location.href
  });
  if (!metadata) return cleanup;

  let storage;
  try {
    storage = windowObject.sessionStorage;
  } catch {
    return cleanup;
  }

  let currentRecord = null;
  const revalidateCurrentReturn = index => {
    currentRecord = resolveArticleReturn({ storage, metadata, now: now(), index });
    if (currentRecord) returnLink.href = currentRecord.terminalUrl;
    else returnLink.setAttribute('href', metadata.rootPath);
    return currentRecord;
  };
  revalidateCurrentReturn(null);

  const index = await loadArticleIndex(fetchImpl, metadata, {
    timeoutMs: indexTimeoutMs,
    AbortControllerImpl,
    setTimeoutImpl,
    clearTimeoutImpl
  });
  revalidateCurrentReturn(index);

  const onClick = event => {
    const anchor = event.target?.closest?.('[data-article-link]');
    if (!anchor || anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download')) return;
    revalidateCurrentReturn(index);
    if (updateArticleChainRecord({
      storage,
      record: currentRecord,
      metadata,
      index,
      href: anchor.getAttribute('href'),
      event
    })) {
      currentRecord = { ...currentRecord, targetArticleUrl: new URL(anchor.href, metadata.rootUrl).href };
    }
  };
  const onReturnClick = () => {
    revalidateCurrentReturn(index);
  };
  const onPageShow = () => {
    revalidateCurrentReturn(index);
  };
  documentObject.addEventListener('click', onClick);
  returnLink.addEventListener('click', onReturnClick);
  windowObject.addEventListener?.('pageshow', onPageShow);
  cleanups.push(() => documentObject.removeEventListener('click', onClick));
  cleanups.push(() => returnLink.removeEventListener('click', onReturnClick));
  cleanups.push(() => windowObject.removeEventListener?.('pageshow', onPageShow));
  return cleanup;
}

export function initializeArticlePage(options = {}) {
  const documentObject = options.document || globalThis.document;
  if (!documentObject || typeof documentObject !== 'object') return mountArticlePage(options);
  const existing = articleMounts.get(documentObject);
  if (existing) return existing;

  let operation;
  operation = mountArticlePage(options).then(dispose => {
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      dispose();
      if (articleMounts.get(documentObject) === operation) articleMounts.delete(documentObject);
    };
  }, error => {
    if (articleMounts.get(documentObject) === operation) articleMounts.delete(documentObject);
    throw error;
  });
  articleMounts.set(documentObject, operation);
  return operation;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  initializeArticlePage().catch(() => {});
}
