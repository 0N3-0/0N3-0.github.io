const INDEX_ID = /^(post|page|tag|category):[0-9a-f]{12}$/u;
const BUILD_ID = /^[0-9a-f]{16}$/u;

function unsafeNavigation() {
  throw new Error('unsafe navigation URL');
}

function assertNoUrlPreprocessing(value) {
  if (typeof value !== 'string' || value.length === 0) unsafeNavigation();
  const first = value.codePointAt(0);
  const last = value.codePointAt(value.length - 1);
  if (first <= 0x20
    || last <= 0x20
    || /[\t\n\r]/u.test(value)
    || /^[\\/]{2}/u.test(value)) {
    unsafeNavigation();
  }
}

function rawLocator(value) {
  return String(value).split('#', 1)[0].split('?', 1)[0];
}

function rawPath(locator) {
  const authority = locator.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(.*)$/iu);
  return authority ? authority[1] || '/' : locator;
}

function assertUnambiguousPath(value) {
  const locator = rawLocator(value);
  if (/\\/u.test(locator)) unsafeNavigation();
  let candidate = rawPath(locator);
  for (let depth = 0; depth < 4; depth += 1) {
    if (/\\/u.test(candidate) || /%(?:2f|5c)/iu.test(candidate)) unsafeNavigation();
    if (candidate.split(/[\\/]/u).some(segment => segment === '.' || segment === '..')) unsafeNavigation();
    if (!/%[0-9a-f]{2}/iu.test(candidate)) return;
    let decoded;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      unsafeNavigation();
    }
    if (decoded === candidate) return;
    candidate = decoded;
  }
  if (/%[0-9a-f]{2}/iu.test(candidate)) unsafeNavigation();
}

function normalizeOrigin(origin) {
  assertNoUrlPreprocessing(origin);
  assertUnambiguousPath(origin);
  let url;
  try {
    url = new URL(origin);
  } catch {
    unsafeNavigation();
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) unsafeNavigation();
  return url.origin;
}

function normalizeRoot(root, origin) {
  assertNoUrlPreprocessing(root);
  assertUnambiguousPath(root);
  let url;
  try {
    url = new URL(root, origin);
  } catch {
    unsafeNavigation();
  }
  if (url.origin !== origin || url.username || url.password || url.search || url.hash) unsafeNavigation();
  return url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
}

export function validateNavigationUrl(value, { origin, root }) {
  assertNoUrlPreprocessing(value);
  const normalizedOrigin = normalizeOrigin(origin);
  const prefix = normalizeRoot(root, normalizedOrigin);
  assertUnambiguousPath(value);

  let url;
  try {
    url = new URL(value, normalizedOrigin);
  } catch {
    unsafeNavigation();
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.origin !== normalizedOrigin
    || url.username
    || url.password
    || (url.pathname !== prefix.slice(0, -1) && !url.pathname.startsWith(prefix))) {
    unsafeNavigation();
  }
  return url.href;
}

function invalid(message) {
  throw new Error(message);
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`invalid ${path}`);
  return value;
}

function string(value, path, { empty = true } = {}) {
  if (typeof value !== 'string' || (!empty && value.length === 0)) invalid(`invalid ${path}`);
  return value;
}

function profileText(value, path, { empty = false } = {}) {
  const result = string(value, path, { empty });
  if (result.length > 254 || /[\u0000-\u001f\u007f]/u.test(result)) invalid(`invalid ${path}`);
  return result;
}

function githubUrl(value) {
  assertNoUrlPreprocessing(value);
  assertUnambiguousPath(value);
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid('invalid about github URL');
  }
  if (url.protocol !== 'https:'
    || !['github.com', 'www.github.com'].includes(url.hostname)
    || url.username
    || url.password
    || url.search
    || url.hash) invalid('invalid about github URL');
  return url.href;
}

export function validateAboutProfile(value, options) {
  if (value === undefined || value === null) {
    return Object.freeze({
      title: "One's Blog", author: '', theme: 'one-terminal', avatarUrl: null,
      github: null, email: null
    });
  }
  const input = record(value, 'about profile');
  const email = profileText(input.email, 'about email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) invalid('invalid about email');
  const github = record(input.github, 'about github');
  return Object.freeze({
    title: profileText(input.title, 'about title'),
    author: profileText(input.author, 'about author'),
    theme: profileText(input.theme, 'about theme'),
    avatarUrl: validateNavigationUrl(input.avatarUrl, options),
    github: Object.freeze({
      label: profileText(github.label, 'about github label'),
      url: githubUrl(github.url)
    }),
    email
  });
}

function nullableString(value, path) {
  if (value === undefined || value === null) return null;
  return string(value, path);
}

function stringList(value, path) {
  if (!Array.isArray(value)) invalid(`invalid ${path}`);
  const result = value.map((item, index) => string(item, `${path}[${index}]`, { empty: false }));
  if (new Set(result).size !== result.length) invalid(`duplicate ${path} reference`);
  return Object.freeze(result);
}

function identifier(value, type, path) {
  const id = string(value, path, { empty: false });
  if (!INDEX_ID.test(id) || !id.startsWith(`${type}:`)) invalid(`invalid ${path}`);
  return id;
}

function target(value, path) {
  const result = string(value, path, { empty: false });
  const segments = result.split('/');
  if (result.startsWith('/')
    || result.endsWith('/')
    || /[\\\u0000-\u001f\u007f]/u.test(result)
    || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    invalid(`invalid ${path}`);
  }
  return result;
}

function isoDate(value, path) {
  const result = string(value, path, { empty: false });
  let normalized;
  try {
    normalized = new Date(result).toISOString();
  } catch {
    invalid(`invalid ${path}`);
  }
  if (normalized !== result) invalid(`invalid ${path}`);
  return result;
}

function snapshotPost(value, index, options) {
  const item = record(value, `post at ${index}`);
  const type = item.type;
  if (type !== 'post') invalid(`invalid post type at ${index}`);
  return Object.freeze({
    id: identifier(item.id, type, `post ID at ${index}`),
    type,
    source: string(item.source, `post source at ${index}`, { empty: false }),
    title: string(item.title, `post title at ${index}`),
    target: target(item.target, `post target at ${index}`),
    date: isoDate(item.date, `post date at ${index}`),
    url: validateNavigationUrl(item.url, options),
    tagIds: stringList(item.tagIds, `post tagIds at ${index}`),
    categoryIds: stringList(item.categoryIds, `post categoryIds at ${index}`)
  });
}

function snapshotNode(value, index, options) {
  const item = record(value, `node at ${index}`);
  const type = item.type;
  if (!['page', 'tag', 'category'].includes(type)) invalid(`invalid node type at ${index}`);
  const snapshot = {
    id: identifier(item.id, type, `node ID at ${index}`),
    type,
    label: string(item.label, `node label at ${index}`),
    url: validateNavigationUrl(item.url, options),
    target: target(item.target, `node target at ${index}`),
    parentId: nullableString(item.parentId, `node parentId at ${index}`)
  };
  if (item.slug !== undefined) snapshot.slug = string(item.slug, `node slug at ${index}`);
  return Object.freeze(snapshot);
}

function snapshotList(value, path, mapper) {
  if (!Array.isArray(value)) invalid(`invalid terminal index ${path}`);
  return Object.freeze(value.map(mapper));
}

export function validateIndex(value, options) {
  const input = record(value, 'terminal index');
  const schemaVersion = input.schemaVersion;
  const buildId = input.buildId;
  if (schemaVersion !== options.schemaVersion || typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    invalid('invalid terminal index header');
  }
  if (typeof buildId !== 'string' || !BUILD_ID.test(buildId)) invalid('invalid terminal index header');

  const posts = snapshotList(input.posts, 'posts', (post, index) => snapshotPost(post, index, options));
  const nodes = snapshotList(input.nodes, 'nodes', (node, index) => snapshotNode(node, index, options));
  const ids = new Set();
  const targets = new Set();
  for (const item of [...posts, ...nodes]) {
    if (ids.has(item.id)) invalid(`duplicate node ID: ${item.id}`);
    if (targets.has(item.target)) invalid(`duplicate canonical target: ${item.target}`);
    ids.add(item.id);
    targets.add(item.target);
  }

  const nodesById = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    if (node.type !== 'category' && node.parentId !== null) invalid(`invalid parent type: ${node.id}`);
    if (node.parentId !== null) {
      const parent = nodesById.get(node.parentId);
      if (!parent) invalid(`missing parent node: ${node.parentId}`);
      if (parent.type !== 'category') invalid(`invalid parent type: ${node.parentId}`);
    }
  }
  for (const node of nodes) {
    const seen = new Set([node.id]);
    let current = node;
    while (current.parentId !== null) {
      if (seen.has(current.parentId)) invalid(`cyclic node graph: ${node.id}`);
      seen.add(current.parentId);
      current = nodesById.get(current.parentId);
    }
  }
  for (const post of posts) {
    if (post.tagIds.some(id => nodesById.get(id)?.type !== 'tag')) invalid(`invalid tag reference: ${post.id}`);
    if (post.categoryIds.some(id => nodesById.get(id)?.type !== 'category')) invalid(`invalid category reference: ${post.id}`);
  }

  return Object.freeze({ schemaVersion, buildId, posts, nodes });
}

export function createIndexLoader({ url, timeoutMs, fetchImpl = globalThis.fetch, validation }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError('timeoutMs must be non-negative');
  const requestUrl = validateNavigationUrl(url, validation);
  let cached = null;
  let inFlight = null;
  let activeAbort = null;
  let activeCancel = null;
  let disposed = false;

  return Object.freeze({
    load() {
      if (disposed) return Promise.reject(new Error('index loader disposed'));
      if (cached !== null) return Promise.resolve(cached);
      if (inFlight !== null) return inFlight;

      const abort = new AbortController();
      activeAbort = abort;
      let timer;
      let cancel;
      const operation = Promise.resolve()
        .then(() => fetchImpl(requestUrl, { signal: abort.signal }))
        .then(response => {
          if (!response || response.ok !== true) {
            throw new Error(`index request failed: ${response?.status || 'unknown'}`);
          }
          return response.json();
        })
        .then(value => validateIndex(value, validation));
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('index request timed out'));
          abort.abort();
        }, timeoutMs);
      });
      const cancelled = new Promise((resolve, reject) => { cancel = reject; });
      activeCancel = () => cancel(new Error('index loader disposed'));

      let pending;
      pending = Promise.race([operation, timeout, cancelled])
        .then(index => {
          if (disposed) throw new Error('index loader disposed');
          if (inFlight === pending) cached = index;
          return index;
        })
        .finally(() => {
          clearTimeout(timer);
          if (inFlight === pending) {
            inFlight = null;
            activeAbort = null;
            activeCancel = null;
          }
        });
      inFlight = pending;
      return pending;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cached = null;
      try { activeAbort?.abort(); } catch { /* Abort is best effort. */ }
      activeCancel?.();
      activeAbort = null;
      activeCancel = null;
    }
  });
}
