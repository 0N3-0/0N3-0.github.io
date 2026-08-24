import { isReservedAboutNode } from './tree.mjs';

export const TERMINAL_BRAND = "One's Blog";

export function batchRanges(total, activeIndex, batchSize) {
  const length = Math.max(0, Math.trunc(Number(total) || 0));
  const size = Math.trunc(Number(batchSize));
  if (size <= 0) throw new RangeError('batchSize must be positive');
  if (length === 0) return [];
  const active = Math.max(0, Math.min(length - 1, Math.trunc(Number(activeIndex) || 0)));
  const visibleEnd = Math.min(length, (Math.floor(active / size) + 1) * size);
  const ranges = [];
  for (let start = 0; start < visibleEnd; start += size) {
    ranges.push(Object.freeze([start, Math.min(visibleEnd, start + size)]));
  }
  return Object.freeze(ranges);
}

export function activeBatchRange(total, activeIndex, batchSize) {
  return batchRanges(total, activeIndex, batchSize).at(-1) || Object.freeze([0, 0]);
}

function row(id, kind, label, meta = '', href = null, action = null) {
  return Object.freeze({
    id: String(id),
    kind,
    label: String(label ?? ''),
    meta: String(meta ?? ''),
    href: typeof href === 'string' ? href : null,
    action
  });
}

function dateLabel(value) {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

function postRow(post) {
  return row(post.id, 'article', post.title, dateLabel(post.date), post.url, {
    type: 'article',
    targetId: post.id
  });
}

function pageRow(page) {
  return row(page.id, 'page', page.label, 'page', page.url, {
    type: 'document',
    targetId: page.id
  });
}

function directoryRow(id, label) {
  return row(id, 'directory', label, 'directory', null, {
    type: 'view',
    view: 'ls',
    viewNodeId: id
  });
}

function nodesOf(index, type) {
  return (index?.nodes || []).filter(node => node.type === type);
}

function postsOf(index) {
  return Array.isArray(index?.posts) ? index.posts : [];
}

function postsFor(index, field, id) {
  return postsOf(index).filter(post => Array.isArray(post[field]) && post[field].includes(id));
}

function descendants(categories, parentId, seen = new Set()) {
  if (seen.has(parentId)) return [];
  const nextSeen = new Set(seen).add(parentId);
  const direct = categories.filter(node => node.parentId === parentId);
  return direct.flatMap(node => [node, ...descendants(categories, node.id, nextSeen)]);
}

function categoryCounts(index, category) {
  const categories = nodesOf(index, 'category');
  const ids = new Set([category.id, ...descendants(categories, category.id).map(node => node.id)]);
  return {
    direct: postsFor(index, 'categoryIds', category.id).length,
    total: postsOf(index).filter(post => post.categoryIds?.some(id => ids.has(id))).length
  };
}

function categoryRow(index, category) {
  const counts = categoryCounts(index, category);
  return row(
    category.id,
    'category',
    category.label,
    `${counts.direct} direct · ${counts.total} total`,
    category.url,
    { type: 'route', kind: 'category', viewNodeId: category.id, url: category.url }
  );
}

function taxonomyBreadcrumb(index, node, rootName) {
  const values = ['~', 'blog', rootName];
  if (!node) return values;
  const byId = new Map((index?.nodes || []).map(item => [item.id, item]));
  const chain = [];
  const seen = new Set();
  let current = node;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current.label);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return [...values, ...chain];
}

function collectionModel(kind, index) {
  const posts = postsOf(index);
  if (kind === 'posts' || kind === 'archives') {
    const title = kind === 'posts' ? 'POSTS' : 'ARCHIVES';
    return {
      breadcrumb: ['~', 'blog', kind],
      summary: `${title} · ${posts.length} entries`,
      emptyMessage: posts.length ? null : 'No posts found.',
      rows: posts.map(postRow)
    };
  }
  if (kind === 'tags') {
    const tags = nodesOf(index, 'tag');
    return {
      breadcrumb: ['~', 'blog', 'tags'],
      summary: `TAGS · ${tags.length} entries`,
      emptyMessage: tags.length ? null : 'No tags found.',
      rows: tags.map(tag => row(
        tag.id,
        'tag',
        tag.label,
        `${postsFor(index, 'tagIds', tag.id).length} posts`,
        tag.url,
        { type: 'route', kind: 'tag', viewNodeId: tag.id, url: tag.url }
      ))
    };
  }
  const categories = nodesOf(index, 'category');
  const roots = categories.filter(category => !category.parentId);
  return {
    breadcrumb: ['~', 'blog', 'categories'],
    summary: `CATEGORIES · ${roots.length} directories · ${posts.length} posts`,
    emptyMessage: roots.length || posts.length ? null : 'No categories found.',
    rows: roots.map(category => categoryRow(index, category))
  };
}

function detailModel(kind, state, index) {
  const node = (index?.nodes || []).find(item => item.id === state.viewNodeId && item.type === kind);
  if (!node) {
    return {
      breadcrumb: ['~', 'blog', `${kind}s`],
      summary: `one: ${kind}: indexed view unavailable`,
      emptyMessage: 'No posts found.',
      rows: []
    };
  }
  if (kind === 'tag') {
    const posts = postsFor(index, 'tagIds', node.id);
    return {
      breadcrumb: taxonomyBreadcrumb(index, node, 'tags'),
      summary: `${node.label} · ${posts.length} entries`,
      emptyMessage: posts.length ? null : 'No posts found.',
      rows: posts.map(postRow)
    };
  }
  const children = nodesOf(index, 'category').filter(item => item.parentId === node.id);
  const directPosts = postsFor(index, 'categoryIds', node.id);
  const counts = categoryCounts(index, node);
  return {
    breadcrumb: taxonomyBreadcrumb(index, node, 'categories'),
    summary: `${node.label} · ${counts.direct} direct · ${counts.total} total`,
    emptyMessage: children.length || directPosts.length ? null : 'No posts found.',
    rows: [...children.map(child => categoryRow(index, child)), ...directPosts.map(postRow)]
  };
}

function helpModel(result) {
  const commands = Array.isArray(result?.commands) ? result.commands : [];
  return {
    rowNavigation: false,
    breadcrumb: ['~', 'blog', 'help'],
    summary: `HELP · ${commands.length} commands`,
    emptyMessage: commands.length ? null : 'No commands registered.',
    rows: commands.map(command => row(
      `command:${command.name}`,
      'command',
      command.usage || command.name,
      command.description || '',
      null,
      { type: 'command', value: command.name }
    ))
  };
}

function aboutModel(index) {
  const posts = postsOf(index);
  const profile = index?.about || {};
  const latest = posts.reduce((value, post) => (
    typeof post.date === 'string' && post.date > value ? post.date : value
  ), '');
  const facts = [
    { label: '作者', value: profile.author || '—' },
    { label: '主题', value: profile.theme || 'one-terminal' },
    { label: '文章', value: String(posts.length) },
    { label: '分类', value: String(nodesOf(index, 'category').length) },
    { label: '标签', value: String(nodesOf(index, 'tag').length) },
    { label: '最近更新', value: dateLabel(latest) || '—' },
    profile.github ? { label: 'GitHub', value: profile.github.label, href: profile.github.url } : null,
    profile.email ? { label: '邮箱', value: profile.email, href: `mailto:${profile.email}` } : null
  ].filter(Boolean);
  return {
    rowNavigation: false,
    breadcrumb: ['~', 'blog'],
    summary: TERMINAL_BRAND,
    emptyMessage: null,
    rows: [],
    about: {
      title: profile.title || TERMINAL_BRAND,
      avatarUrl: profile.avatarUrl || null,
      badge: 'ONE/BLOG',
      facts
    }
  };
}

function navigableModel(model) {
  return { ...model, rowNavigation: true };
}

function lsModel(state, index) {
  if (state.viewNodeId === 'dir:root') {
    const pages = nodesOf(index, 'page').filter(page => !isReservedAboutNode(page));
    const rows = [
      directoryRow('dir:posts', 'posts'),
      directoryRow('dir:tags', 'tags'),
      directoryRow('dir:categories', 'categories'),
      ...pages.map(pageRow)
    ];
    return {
      breadcrumb: ['~', 'blog'],
      summary: `BLOG · ${rows.length} directories`,
      emptyMessage: null,
      rows
    };
  }
  if (state.viewNodeId === 'dir:posts') return collectionModel('posts', index);
  if (state.viewNodeId === 'dir:tags') return collectionModel('tags', index);
  if (state.viewNodeId === 'dir:categories') return collectionModel('categories', index);
  const post = postsOf(index).find(item => item.id === state.viewNodeId);
  if (post) {
    return {
      breadcrumb: ['~', 'blog', 'posts', post.title],
      summary: 'POST · 1 entry',
      emptyMessage: null,
      rows: [postRow(post)]
    };
  }
  const node = index?.nodes?.find(item => item.id === state.viewNodeId);
  if (node?.type === 'page') {
    return {
      breadcrumb: ['~', 'blog', 'pages', node.label],
      summary: 'PAGE · 1 entry',
      emptyMessage: null,
      rows: [pageRow(node)]
    };
  }
  if (node?.type === 'tag' || node?.type === 'category') return detailModel(node.type, state, index);
  return {
    breadcrumb: ['~', 'blog'],
    summary: 'one: ls: indexed path unavailable',
    emptyMessage: 'No entries found.',
    rows: []
  };
}

export function createViewModel(state, index) {
  if (state?.indexStatus === 'loading') {
    return navigableModel({ breadcrumb: ['~', 'blog'], summary: 'loading terminal-index.json…', emptyMessage: null, rows: [] });
  }
  if (state?.indexStatus === 'error') {
    return navigableModel({
      breadcrumb: ['~', 'blog'],
      summary: `one: terminal-index: ${state.indexError || 'unavailable'}`,
      emptyMessage: 'Use the native links below or retry.',
      rows: []
    });
  }
  const result = state?.output?.result ?? null;
  if (result?.type === 'error') {
    return navigableModel({ breadcrumb: ['~', 'blog'], summary: `one: ${result.message}`, emptyMessage: null, rows: [] });
  }
  const requested = result?.type === 'render' ? result.view : null;
  const routeKind = state?.route?.kind || 'root';
  const kind = requested ?? routeKind;
  if (kind === 'help') return helpModel(result);
  if (kind === 'about') return aboutModel(index);
  if (kind === 'posts' || kind === 'archives' || kind === 'tags' || kind === 'categories') {
    return navigableModel(collectionModel(kind, index));
  }
  if (kind === 'tag' || kind === 'category') return navigableModel(detailModel(kind, state, index));
  if (kind === 'ls') return navigableModel(lsModel(state, index));
  if (kind === 'page' || kind === 'document') {
    return navigableModel({ breadcrumb: ['~', 'blog', 'page'], summary: 'DOCUMENT', emptyMessage: null, rows: [] });
  }
  return navigableModel({ breadcrumb: ['~', 'blog'], summary: TERMINAL_BRAND, emptyMessage: null, rows: [] });
}

export function terminalPresentation(state) {
  return Object.freeze({
    transcript: state?.transcript || Object.freeze([]),
    output: state?.output || null,
    commandRunning: state?.foreground !== null
  });
}

export function shouldHandleInlineNavigation(event) {
  return event?.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && !event.defaultPrevented;
}
