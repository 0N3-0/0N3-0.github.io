import {
  getChildren,
  isDirectoryNode,
  isReservedAboutNode,
  resolvePath,
  resolvePathResult,
  resolveTarget
} from './tree.mjs';
import { DEFAULT_LANGUAGE, normalizeLanguage, parseLanguage, translate } from '../i18n.mjs';

const VIEW_TARGETS = Object.freeze({
  posts: { view: 'posts', viewNodeId: 'dir:posts' },
  archives: { view: 'archives' },
  tags: { view: 'tags', viewNodeId: 'dir:tags' },
  categories: { view: 'categories', viewNodeId: 'dir:categories' }
});

function candidate(id, type, label, value, description = '') {
  return { id, type, label: String(label), value: String(value), description };
}

function error(code, message) {
  return { type: 'error', code, message };
}

function renderView(target) {
  const view = VIEW_TARGETS[target];
  return view ? { type: 'render', ...view } : null;
}

function requireIndexContext(context) {
  return context?.index && context?.tree
    ? null
    : error('INDEX_UNAVAILABLE', translate(context?.state?.language, 'error.indexUnavailable'));
}

function languageOf(context) {
  return context?.state?.language || DEFAULT_LANGUAGE;
}

function message(context, key, values) {
  return translate(languageOf(context), key, values);
}

function resolveCanonical(context, target) {
  return resolveTarget(context.tree, String(target).replace(/^\/+|\/+$/gu, ''));
}

function canonicalSegment(node) {
  return String(node?.target || '').split('/').filter(Boolean).at(-1) || String(node?.name || node?.id || '');
}

function safeDisplaySegment(value) {
  const segment = String(value || '');
  return segment && !['.', '..', '~'].includes(segment) && !segment.includes('/');
}

function commandPathSegment(context, node) {
  const name = String(node?.name || '');
  const siblings = getChildren(context.tree, node?.parentId);
  const unique = siblings.filter(sibling => sibling.name === name).length === 1;
  return safeDisplaySegment(name) && unique ? name : canonicalSegment(node);
}

function taxonomyPath(context, node, rootId) {
  const segments = [];
  const seen = new Set();
  let current = node;
  while (current && current.id !== rootId && !seen.has(current.id)) {
    seen.add(current.id);
    segments.unshift(commandPathSegment(context, current));
    current = current.parentId ? context.tree.nodes.get(current.parentId) : null;
  }
  return current?.id === rootId ? segments.join('/') : canonicalSegment(node);
}

function resolvePost(context, target) {
  const canonical = resolveCanonical(context, target);
  if (canonical?.type === 'post') return canonical;
  const matches = context.index.posts.filter(post => post.title === target);
  return matches.length === 1 ? context.tree.nodes.get(matches[0].id) : null;
}

function resolveTaxonomy(context, target, type) {
  const canonical = resolveCanonical(context, target);
  if (canonical?.type === type) return canonical;
  const rootId = type === 'tag' ? 'dir:tags' : 'dir:categories';
  const relative = resolvePath(context.tree, target, rootId);
  if (relative?.type === type) return relative;
  const absolute = resolvePath(context.tree, target, 'dir:root');
  return absolute?.type === type ? absolute : null;
}

function openCandidates(context) {
  if (!context?.index) return [];
  return context.index.posts.map(post => {
    const date = typeof post.date === 'string' ? post.date.slice(0, 10) : '';
    const duplicate = context.index.posts.some(other => other.id !== post.id && other.title === post.title);
    const value = duplicate ? post.target : commandArgument(post.title);
    return candidate(
      post.id,
      'post',
      post.title,
      value,
      message(context, date ? 'completion.articleDate' : 'completion.article', { date })
    );
  });
}

function taxonomyCandidates(context, type) {
  if (!context?.index) return [];
  const rootId = type === 'tag' ? 'dir:tags' : 'dir:categories';
  return context.index.nodes
    .filter(node => node.type === type)
    .map(node => {
      const treeNode = context.tree?.nodes?.get(node.id);
      const value = treeNode ? commandArgument(taxonomyPath(context, treeNode, rootId)) : node.target;
      return candidate(node.id, type, node.label, value, node.url || '');
    });
}

function commandArgument(value) {
  return String(value).replace(/[\\\t\n\v\f\r "']/gu, character => `\\${character}`);
}

function themeCandidates(context) {
  return [
    candidate('theme:dark', 'theme', 'dark', 'dark', message(context, 'completion.theme.dark')),
    candidate('theme:light', 'theme', 'light', 'light', message(context, 'completion.theme.light'))
  ];
}

function languageCandidates(context) {
  return [
    candidate('language:zh-CN', 'language', 'zh-CN', 'zh-CN', message(context, 'completion.language.zh-CN')),
    candidate('language:en', 'language', 'en', 'en', message(context, 'completion.language.en'))
  ];
}

function pathCandidate(node, value = node.name) {
  const type = node.type === 'root' || node.type === 'directory' || node.type === 'category' ? 'directory' : node.type;
  return candidate(node.id, type, node.label || node.title || node.name, commandArgument(value), node.url || '');
}

function completePath(context, value) {
  const raw = String(value || '');
  const boundary = raw.lastIndexOf('/');
  const prefix = boundary < 0 ? '' : raw.slice(0, boundary + 1);
  const parent = prefix
    ? resolvePath(context.tree, prefix, context.cwdNodeId)
    : context.tree.nodes.get(context.cwdNodeId || context.tree.cwdNodeId);
  if (!parent) return [];
  return getChildren(context.tree, parent.id)
    .filter(node => !isReservedAboutNode(node))
    .map(node => pathCandidate(node, `${prefix}${commandPathSegment(context, node)}`));
}

function completeDirectoryPath(context, value) {
  return completePath(context, value)
    .filter(item => isDirectoryNode(context.tree.nodes.get(item.id)))
    .map(item => ({ ...item, type: 'directory', description: '' }));
}

function register(registry, definition) {
  const descriptionKey = definition.descriptionKey;
  registry.register({
    aliases: [],
    complete() { return []; },
    ...definition,
    ...(descriptionKey ? { description: translate(DEFAULT_LANGUAGE, descriptionKey) } : {})
  });
}

export function registerBuiltins(registry) {
  register(registry, {
    name: 'help',
    order: 10,
    usage: 'help',
    descriptionKey: 'command.help',
    execute(context) {
      const language = languageOf(context);
      return {
        type: 'render',
        view: 'help',
        commands: registry.list().map(({ name, aliases, usage, description, descriptionKey }) => ({
          name,
          aliases: [...aliases],
          usage,
          description: descriptionKey ? translate(language, descriptionKey) : description
        }))
      };
    }
  });

  register(registry, {
    name: 'clear',
    order: 20,
    usage: 'clear',
    descriptionKey: 'command.clear',
    execute(context, args) {
      return args.length === 0 ? { type: 'clear' } : error('INVALID_ARGUMENTS', 'Usage: clear');
    }
  });

  register(registry, {
    name: 'ls',
    order: 30,
    usage: 'ls [path]',
    descriptionKey: 'command.ls',
    complete(context, args) {
      if (!context?.tree || args.length > 1) return [];
      return completePath(context, args[0]);
    },
    execute(context, args) {
      const unavailable = requireIndexContext(context);
      if (unavailable) return unavailable;
      if (args.length > 1) return error('INVALID_ARGUMENTS', 'Usage: ls [path]');
      const node = args.length === 0
        ? context.tree.nodes.get(context.cwdNodeId || context.tree.cwdNodeId)
        : resolvePath(context.tree, args[0], context.cwdNodeId);
      if (isReservedAboutNode(node)) return error('ABOUT_RESERVED', message(context, 'error.aboutReserved'));
      return node
        ? { type: 'render', view: 'ls', viewNodeId: node.id }
        : error('PATH_NOT_FOUND', message(context, 'error.pathNotFound', { path: args[0] }));
    }
  });

  register(registry, {
    name: 'cd',
    order: 40,
    usage: 'cd [path]',
    descriptionKey: 'command.cd',
    complete(context, args) {
      if (!context?.tree || args.length > 1) return [];
      return completeDirectoryPath(context, args[0]);
    },
    execute(context, args) {
      const unavailable = requireIndexContext(context);
      if (unavailable) return unavailable;
      if (args.length > 1) return error('INVALID_ARGUMENTS', 'Usage: cd [path]');
      const path = args.length === 0 ? '~' : args[0];
      const resolved = resolvePathResult(context.tree, path, context.cwdNodeId);
      if (resolved.error === 'outside-root') return error('CWD_BOUNDARY', message(context, 'error.cwdBoundary'));
      if (resolved.error === 'not-directory') return error('NOT_A_DIRECTORY', message(context, 'error.notDirectory', { path }));
      const node = resolved.node;
      if (resolved.error || !node) return error('PATH_NOT_FOUND', message(context, 'error.noDirectory', { path }));
      if (!isDirectoryNode(node)) return error('NOT_A_DIRECTORY', message(context, 'error.notDirectory', { path }));
      return { type: 'cwd', cwdNodeId: node.id };
    }
  });

  register(registry, {
    name: 'open',
    order: 50,
    usage: 'open <post>',
    descriptionKey: 'command.open',
    complete(context) {
      return openCandidates(context);
    },
    execute(context, args) {
      if (args.length !== 1 || !args[0]) return error('INVALID_ARGUMENTS', 'Usage: open <post>');
      const unavailable = requireIndexContext(context);
      if (unavailable) return unavailable;
      const node = resolvePost(context, args[0]);
      if (!node) return error('TARGET_NOT_FOUND', message(context, 'error.postNotFound', { target: args[0] }));
      return { type: 'navigate', url: node.url, targetId: node.id };
    }
  });

  register(registry, {
    name: 'posts',
    order: 60,
    usage: 'posts',
    descriptionKey: 'command.posts',
    execute(context, args) {
      if (args.length > 0) return error('INVALID_ARGUMENTS', 'Usage: posts');
      const unavailable = requireIndexContext(context);
      return unavailable || renderView('posts');
    }
  });

  register(registry, {
    name: 'tags',
    order: 70,
    usage: 'tags [tag]',
    descriptionKey: 'command.tags',
    complete(context) {
      return taxonomyCandidates(context, 'tag');
    },
    execute(context, args) {
      if (args.length > 1) return error('INVALID_ARGUMENTS', 'Usage: tags [tag]');
      const unavailable = requireIndexContext(context);
      if (unavailable) return unavailable;
      if (args.length === 0) return renderView('tags');
      const node = resolveTaxonomy(context, args[0], 'tag');
      return node?.type === 'tag'
        ? { type: 'render', view: 'tag', viewNodeId: node.id }
        : error('TARGET_NOT_FOUND', message(context, 'error.tagNotFound', { target: args[0] }));
    }
  });

  register(registry, {
    name: 'categories',
    order: 80,
    usage: 'categories [category]',
    descriptionKey: 'command.categories',
    complete(context) {
      return taxonomyCandidates(context, 'category');
    },
    execute(context, args) {
      if (args.length > 1) return error('INVALID_ARGUMENTS', 'Usage: categories [category]');
      const unavailable = requireIndexContext(context);
      if (unavailable) return unavailable;
      if (args.length === 0) return renderView('categories');
      const node = resolveTaxonomy(context, args[0], 'category');
      return node?.type === 'category'
        ? { type: 'render', view: 'category', viewNodeId: node.id }
        : error('TARGET_NOT_FOUND', message(context, 'error.categoryNotFound', { target: args[0] }));
    }
  });

  register(registry, {
    name: 'theme',
    order: 90,
    usage: 'theme [dark|light]',
    descriptionKey: 'command.theme',
    complete(context, args) {
      return args.length <= 1 ? themeCandidates(context) : [];
    },
    execute(context, args) {
      if (args.length > 1) return error('INVALID_ARGUMENTS', 'Usage: theme [dark|light]');
      const current = context?.state?.colorMode === 'light' ? 'light' : 'dark';
      const requested = args.length === 0
        ? current === 'dark' ? 'light' : 'dark'
        : String(args[0]).toLowerCase();
      return ['dark', 'light'].includes(requested)
        ? { type: 'theme', mode: requested }
        : error('INVALID_ARGUMENTS', 'Usage: theme [dark|light]');
    }
  });

  register(registry, {
    name: 'about',
    order: 110,
    usage: 'about',
    descriptionKey: 'command.about',
    execute(context, args) {
      if (args.length > 0) return error('INVALID_ARGUMENTS', 'Usage: about');
      const unavailable = requireIndexContext(context);
      return unavailable || { type: 'render', view: 'about' };
    }
  });

  register(registry, {
    name: 'language',
    order: 100,
    usage: 'language [zh-CN|en]',
    descriptionKey: 'command.language',
    complete(context, args) {
      return args.length <= 1 ? languageCandidates(context) : [];
    },
    execute(context, args) {
      if (args.length > 1) return error('INVALID_ARGUMENTS', 'Usage: language [zh-CN|en]');
      const current = normalizeLanguage(context?.state?.language);
      const requested = args.length === 0
        ? current === 'zh-CN' ? 'en' : 'zh-CN'
        : parseLanguage(args[0]);
      return requested
        ? { type: 'language', language: requested }
        : error('INVALID_ARGUMENTS', 'Usage: language [zh-CN|en]');
    }
  });

  return registry;
}
