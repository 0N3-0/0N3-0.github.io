const DIRECTORY_NAMES = ['posts', 'tags', 'categories'];
const BUILTIN_IDS = ['dir:root', ...DIRECTORY_NAMES.map(name => `dir:${name}`)];
const INDEX_NODE_TYPES = new Set(['tag', 'category', 'page']);
const TARGET_NODE_CACHE = new WeakMap();

export function isReservedAboutNode(node) {
  return node?.type === 'page' && (
    String(node.label || node.slug || '').trim().toLowerCase() === 'about'
    || /(?:^|\/)about(?:~|\/|$)/iu.test(String(node.target || ''))
  );
}

export function isDirectoryNode(node) {
  return ['root', 'directory', 'tag', 'category'].includes(node?.type);
}

function invalid(path, expectation) {
  throw new TypeError(`Invalid terminal index: ${path} must be ${expectation}`);
}

function readProperty(value, property, path) {
  try {
    return value[property];
  } catch {
    invalid(`${path}.${property}`, 'readable');
  }
}

function requiredString(value, path, { nonEmpty = false } = {}) {
  if (typeof value !== 'string' || (nonEmpty && value.length === 0)) {
    invalid(path, nonEmpty ? 'a non-empty string' : 'a string');
  }
  return value;
}

function nullableString(value, path) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') invalid(path, 'a string or null');
  return value;
}

function stringArray(value, path) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) invalid(path, 'an array of strings');
  let length;
  try {
    length = value.length;
  } catch {
    invalid(path, 'a readable array of strings');
  }
  const snapshot = new Array(length);
  for (let index = 0; index < length; index += 1) {
    let item;
    try {
      item = value[index];
    } catch {
      invalid(`${path}[${index}]`, 'readable');
    }
    if (typeof item !== 'string') invalid(`${path}[${index}]`, 'a string');
    snapshot[index] = item;
  }
  return Object.freeze(snapshot);
}

function snapshotPost(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'an object');
  const id = readProperty(value, 'id', path);
  const type = readProperty(value, 'type', path);
  const source = readProperty(value, 'source', path);
  const title = readProperty(value, 'title', path);
  const target = readProperty(value, 'target', path);
  const date = readProperty(value, 'date', path);
  const url = readProperty(value, 'url', path);
  const tagIds = readProperty(value, 'tagIds', path);
  const categoryIds = readProperty(value, 'categoryIds', path);
  if (type !== undefined && type !== 'post') invalid(`${path}.type`, '"post"');
  return Object.freeze({
    id: requiredString(id, `${path}.id`, { nonEmpty: true }),
    type: 'post',
    source: nullableString(source, `${path}.source`),
    title: requiredString(title, `${path}.title`),
    target: requiredString(target, `${path}.target`, { nonEmpty: true }),
    date: nullableString(date, `${path}.date`),
    url: nullableString(url, `${path}.url`),
    tagIds: stringArray(tagIds, `${path}.tagIds`),
    categoryIds: stringArray(categoryIds, `${path}.categoryIds`)
  });
}

function snapshotIndexNode(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'an object');
  const id = readProperty(value, 'id', path);
  const type = readProperty(value, 'type', path);
  const label = readProperty(value, 'label', path);
  const slug = readProperty(value, 'slug', path);
  const url = readProperty(value, 'url', path);
  const target = readProperty(value, 'target', path);
  const parentId = readProperty(value, 'parentId', path);
  if (typeof type !== 'string' || !INDEX_NODE_TYPES.has(type)) invalid(`${path}.type`, '"tag", "category", or "page"');
  return Object.freeze({
    id: requiredString(id, `${path}.id`, { nonEmpty: true }),
    type,
    label: requiredString(label, `${path}.label`),
    slug: nullableString(slug, `${path}.slug`),
    url: nullableString(url, `${path}.url`),
    target: requiredString(target, `${path}.target`, { nonEmpty: true }),
    parentId: nullableString(parentId, `${path}.parentId`)
  });
}

function snapshotCollection(value, path, snapshotItem) {
  if (!Array.isArray(value)) invalid(path, 'an array');
  let length;
  try {
    length = value.length;
  } catch {
    invalid(path, 'a readable array');
  }
  const snapshot = new Array(length);
  for (let index = 0; index < length; index += 1) {
    let item;
    try {
      item = value[index];
    } catch {
      invalid(`${path}[${index}]`, 'readable');
    }
    snapshot[index] = snapshotItem(item, `${path}[${index}]`);
  }
  return Object.freeze(snapshot);
}

function snapshotIndex(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) invalid('index', 'an object');
  const posts = readProperty(index, 'posts', 'index');
  const nodes = readProperty(index, 'nodes', 'index');
  return Object.freeze({
    posts: snapshotCollection(posts, 'posts', snapshotPost),
    nodes: snapshotCollection(nodes, 'nodes', snapshotIndexNode)
  });
}

function freezeNode(node) {
  const snapshot = {};
  for (const [key, value] of Object.entries(node)) {
    snapshot[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  return Object.freeze(snapshot);
}

function assertUniqueIds(posts, indexNodes) {
  const seen = new Set(BUILTIN_IDS);
  for (const item of [...posts, ...indexNodes]) {
    if (!item?.id) continue;
    if (seen.has(item.id)) throw new Error(`Duplicate virtual node ID: ${item.id}`);
    seen.add(item.id);
  }
}

function fallbackParentId(item) {
  if (item.type === 'tag') return 'dir:tags';
  if (item.type === 'category') return 'dir:categories';
  if (item.type === 'page') return 'dir:root';
  return null;
}

function nodeName(item) {
  if (item.type === 'post') return String(item.title || item.id);
  if (item.type === 'page') return String(item.label || item.slug || item.id);
  return String(item.label || item.title || item.id);
}

function readOnlyMap(map) {
  const rejectMutation = () => { throw new TypeError('Virtual tree is read-only'); };
  let facade;
  facade = Object.freeze({
    get size() { return map.size; },
    get(key) { return map.get(key); },
    has(key) { return map.has(key); },
    *keys() {
      for (const [key] of map) yield key;
    },
    *values() {
      for (const value of map.values()) yield value;
    },
    *entries() {
      for (const [key, value] of map) yield [key, value];
    },
    *[Symbol.iterator]() {
      for (const [key, value] of map) yield [key, value];
    },
    forEach(callback, thisArg) {
      if (typeof callback !== 'function') throw new TypeError('Callback must be a function');
      for (const [key, value] of map) callback.call(thisArg, value, key, facade);
    },
    set: rejectMutation,
    delete: rejectMutation,
    clear: rejectMutation
  });
  return facade;
}

function createPostNode(post) {
  return {
    ...post,
    name: nodeName(post),
    parentId: 'dir:posts',
    children: []
  };
}

function createIndexNode(item, parentId) {
  return {
    ...item,
    name: nodeName(item),
    parentId,
    children: []
  };
}

function createBuiltinNodes() {
  const nodes = new Map();
  nodes.set('dir:root', {
    id: 'dir:root',
    type: 'root',
    name: 'blog',
    parentId: null,
    children: []
  });
  for (const name of DIRECTORY_NAMES) {
    const id = `dir:${name}`;
    nodes.set(id, { id, type: 'directory', name, parentId: 'dir:root', children: [] });
    nodes.get('dir:root').children.push(id);
  }
  return nodes;
}

export function createVirtualTree(index) {
  const { posts, nodes: indexNodes } = snapshotIndex(index);
  assertUniqueIds(posts, indexNodes);

  const mutableNodes = createBuiltinNodes();

  for (const post of posts) {
    if (!post?.id) continue;
    mutableNodes.set(post.id, createPostNode(post));
    mutableNodes.get('dir:posts').children.push(post.id);
  }

  let pending = indexNodes
    .filter(item => item?.id)
    .map(item => ({ item, parentId: item.parentId || fallbackParentId(item) }));

  let attached = true;
  while (pending.length > 0 && attached) {
    attached = false;
    const remaining = [];
    for (const { item, parentId } of pending) {
      const parent = mutableNodes.get(parentId);
      if (!parent) {
        remaining.push({ item, parentId });
        continue;
      }
      mutableNodes.set(item.id, createIndexNode(item, parentId));
      parent.children.push(item.id);
      attached = true;
    }
    pending = remaining;
  }

  const nodes = readOnlyMap(new Map([...mutableNodes].map(([id, node]) => [id, freezeNode(node)])));
  const tree = Object.freeze({ cwdNodeId: 'dir:root', nodes });
  TARGET_NODE_CACHE.set(tree, new Map(
    [...nodes.values()].filter(node => node.target).map(node => [node.target, node])
  ));
  return tree;
}

export function getChildren(tree, nodeId) {
  const node = tree?.nodes?.get(nodeId);
  if (!node) return [];
  return node.children.map(id => tree.nodes.get(id)).filter(Boolean);
}

function pathResult(node, error = null) {
  return Object.freeze({ node, error });
}

function pathInput(path) {
  const raw = String(path ?? '');
  const absolute = raw === '~' || raw === '~/blog' || raw.startsWith('~/blog/') || raw.startsWith('/');
  if (raw === '~' || raw === '~/blog') return { absolute, value: '' };
  if (raw.startsWith('~/blog/')) return { absolute, value: raw.slice('~/blog/'.length) };
  if (raw.startsWith('/')) return { absolute, value: raw.replace(/^\/+/u, '') };
  return { absolute, value: raw };
}

function childNamed(tree, parent, name) {
  for (const childId of parent.children || []) {
    const child = tree.nodes.get(childId);
    const canonicalName = String(child?.target || '').split('/').filter(Boolean).at(-1);
    if (canonicalName === name) return child;
  }
  let match = null;
  for (const childId of parent.children || []) {
    const child = tree.nodes.get(childId);
    if (child?.name !== name) continue;
    if (match) return null;
    match = child;
  }
  return match;
}

export function resolvePathResult(tree, path, cwdNodeId = tree?.cwdNodeId) {
  if (!tree?.nodes || !tree.nodes.has(cwdNodeId)) return pathResult(null, 'not-found');
  const root = tree.nodes.get('dir:root');
  if (!root) return pathResult(null, 'not-found');

  const { absolute, value } = pathInput(path);
  let current = absolute ? root : tree.nodes.get(cwdNodeId);
  for (const segment of value.split('/')) {
    if (!segment) continue;
    if (!isDirectoryNode(current)) return pathResult(null, 'not-directory');
    if (segment === '.') continue;
    if (segment === '..') {
      if (current.id === root.id) return pathResult(null, 'outside-root');
      current = tree.nodes.get(current.parentId);
      if (!current) return pathResult(null, 'not-found');
      continue;
    }
    current = childNamed(tree, current, segment);
    if (!current) return pathResult(null, 'not-found');
  }
  return pathResult(current, null);
}

export function resolvePath(tree, path, cwdNodeId = tree?.cwdNodeId) {
  return resolvePathResult(tree, path, cwdNodeId).node;
}

export function resolveTarget(tree, target) {
  return TARGET_NODE_CACHE.get(tree)?.get(String(target ?? '')) || null;
}
