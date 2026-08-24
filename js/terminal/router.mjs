import { validateNavigationUrl } from './model.mjs';

const VIEW_ROUTES = Object.freeze({
  posts: 'dir:posts',
  archives: null,
  tags: 'dir:tags',
  categories: 'dir:categories'
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function localUrl(url, current) {
  const search = current.search || url.search;
  const hash = current.hash || url.hash;
  return `${url.pathname}${search}${hash}`;
}

export function createRouter({ origin, routes, paginationDir = 'page' }) {
  if (!routes || typeof routes !== 'object') throw new TypeError('routes must be an object');
  const rootValue = routes.root;
  const rootHref = validateNavigationUrl(rootValue, { origin, root: rootValue });
  const rootUrl = new URL(rootHref);
  const rootPath = rootUrl.pathname.endsWith('/') ? rootUrl.pathname : `${rootUrl.pathname}/`;
  const validation = { origin: rootUrl.origin, root: rootPath };
  const routeUrls = {
    root: rootUrl,
    ...Object.fromEntries(Object.keys(VIEW_ROUTES).map(kind => [
      kind,
      new URL(validateNavigationUrl(routes[kind], validation))
    ]))
  };
  const segment = String(paginationDir);
  if (!segment || segment === '.' || segment === '..' || /[\\/\u0000-\u001f\u007f]/u.test(segment)) {
    throw new TypeError('invalid paginationDir');
  }
  const pageSuffix = new RegExp(`/${escapeRegExp(segment)}/\\d+/?$`, 'u');

  return Object.freeze({
    fromUrl(value, index) {
      const current = new URL(validateNavigationUrl(value, validation));
      const pathname = current.pathname;
      if (pathname === routeUrls.root.pathname) {
        return {
          kind: 'root',
          viewNodeId: 'dir:root',
          canonicalUrl: localUrl(routeUrls.root, current),
          replace: false
        };
      }

      for (const [kind, viewNodeId] of Object.entries(VIEW_ROUTES)) {
        const route = routeUrls[kind];
        if (pathname === route.pathname) {
          return { kind, viewNodeId, canonicalUrl: localUrl(route, current), replace: false };
        }
      }

      const pagination = pathname.match(pageSuffix);
      if (pagination) {
        const basePath = `${pathname.slice(0, pagination.index)}/`;
        const kind = basePath === routeUrls.root.pathname
          ? 'posts'
          : Object.keys(VIEW_ROUTES).find(name => basePath === routeUrls[name].pathname);
        if (kind) {
          return {
            kind,
            viewNodeId: VIEW_ROUTES[kind],
            canonicalUrl: localUrl(routeUrls[kind], current),
            replace: true
          };
        }
      }

      for (const node of index?.nodes || []) {
        if (!['tag', 'category'].includes(node?.type)) continue;
        const indexedUrl = new URL(validateNavigationUrl(node.url, validation));
        if (indexedUrl.pathname === pathname) {
          return {
            kind: node.type,
            viewNodeId: node.id,
            canonicalUrl: localUrl(indexedUrl, current),
            replace: false
          };
        }
      }

      return {
        kind: 'document',
        viewNodeId: null,
        canonicalUrl: `${current.pathname}${current.search}${current.hash}`,
        replace: false
      };
    }
  });
}
