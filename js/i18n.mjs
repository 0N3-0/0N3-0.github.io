export const DEFAULT_LANGUAGE = 'zh-CN';
export const LANGUAGE_STORAGE_KEY = 'language';
export const SUPPORTED_LANGUAGES = Object.freeze(['zh-CN', 'en']);

const MESSAGES = Object.freeze({
  'zh-CN': Object.freeze({
    'command.help': '显示所有可用命令。',
    'command.clear': '清空终端输出。',
    'command.ls': '列出虚拟路径内容，不切换目录。',
    'command.cd': '切换虚拟工作目录。',
    'command.open': '打开一篇文章。',
    'command.posts': '按时间倒序显示所有文章。',
    'command.tags': '显示全部标签或查看指定标签。',
    'command.categories': '显示全部分类或查看指定分类。',
    'command.theme': '切换终端与文章的明暗模式。',
    'command.language': '切换界面语言。',
    'command.about': '显示 Blog 作者信息。',
    'destination.posts': '按时间浏览所有文章',
    'destination.categories': '按分类浏览文章',
    'destination.tags': '按标签浏览文章',
    'completion.article': '文章',
    'completion.articleDate': '文章 · {date}',
    'completion.theme.dark': '切换到暗色模式',
    'completion.theme.light': '切换到亮色模式',
    'completion.language.zh-CN': '切换到简体中文',
    'completion.language.en': '切换到英文',
    'error.indexUnavailable': '终端索引不可用。',
    'error.aboutReserved': '请使用预留的 about 命令。',
    'error.pathNotFound': '路径不存在：{path}',
    'error.cwdBoundary': 'cd: 无法离开 ~/blog/',
    'error.notDirectory': 'cd: 不是目录：{path}',
    'error.noDirectory': 'cd: 没有此目录：{path}',
    'error.postNotFound': '文章不存在：{target}',
    'error.tagNotFound': '标签不存在：{target}',
    'error.categoryNotFound': '分类不存在：{target}',
    'error.invalidSyntax': '命令语法无效。',
    'error.unknownCommand': '未知命令：{command}',
    'error.invalidCwd': '命令返回了不可用的工作目录。',
    'error.commandFailed': '命令执行失败。',
    'error.viewUnavailable': '索引中的 {view} 视图不可用。',
    'error.invalidResult': '命令返回了无效结果。',
    'view.entries': '{count} 项',
    'view.commands': '{count} 个命令',
    'view.directTotal': '{direct} 篇直属 · {total} 篇合计',
    'view.directoriesPosts': '{directories} 个目录 · {posts} 篇文章',
    'view.posts': '{count} 篇文章',
    'view.directories': '{count} 个目录',
    'view.page': '页面',
    'view.directory': '目录',
    'view.post': '文章',
    'view.oneEntry': '1 项',
    'view.noPosts': '没有找到文章。',
    'view.noTags': '没有找到标签。',
    'view.noCategories': '没有找到分类。',
    'view.noCommands': '没有注册命令。',
    'view.noEntries': '没有找到内容。',
    'view.nativeFallback': '请使用下方原生链接或重试。',
    'view.loadingIndex': '正在加载 terminal-index.json…',
    'view.indexedUnavailable': '索引视图不可用',
    'view.document': '文档',
    'about.author': '作者',
    'about.theme': '主题',
    'about.posts': '文章',
    'about.categories': '分类',
    'about.tags': '标签',
    'about.updated': '最近更新',
    'about.email': '邮箱',
    'renderer.welcomeTitle': "欢迎来到 One's Blog",
    'renderer.welcomeKicker': '欢迎来到',
    'renderer.terminalPath': '终端路径',
    'renderer.blogOverview': '博客概览',
    'renderer.avatar': '{title} 头像',
    'renderer.palette': '当前模式实际使用的 8 组 16 色源',
    'renderer.more': '更多（{count}）',
    'renderer.back': '返回上一步',
    'renderer.interrupt': '中断',
    'renderer.retry': '重试',
    'renderer.commandLabel': '终端命令',
    'renderer.placeholder': '输入命令，或按 Tab 浏览',
    'renderer.brandLabel': '博客标题',
    'renderer.terminalLabel': '博客终端',
    'mobileTab.next': '终端 Tab 下一项',
    'article.return': '返回终端',
    'article.returnText': '终端',
    'article.backToTop': '返回文章开头',
    'article.tags': '文章标签',
    'article.navigation': '文章导航',
    'article.toc': '文章目录',
    'article.copy': '复制 {language} 代码',
    'article.copied': '代码已复制',
    'article.expandCode': '展开代码块',
    'article.collapseCode': '收起代码块',
    'article.expandBranch': '展开子目录',
    'article.collapseBranch': '收起子目录',
    'article.showToc': '显示文章目录',
    'article.hideToc': '隐藏文章目录'
  }),
  en: Object.freeze({
    'command.help': 'List all available commands.',
    'command.clear': 'Clear terminal output.',
    'command.ls': 'List a virtual path without changing directory.',
    'command.cd': 'Change the virtual working directory.',
    'command.open': 'Open a post.',
    'command.posts': 'List all posts newest first.',
    'command.tags': 'List all tags or view a specific tag.',
    'command.categories': 'List all categories or view a specific category.',
    'command.theme': 'Switch the terminal and article color mode.',
    'command.language': 'Switch the interface language.',
    'command.about': 'Show information about the blog author.',
    'destination.posts': 'Browse all posts by date',
    'destination.categories': 'Browse posts by category',
    'destination.tags': 'Browse posts by tag',
    'completion.article': 'post',
    'completion.articleDate': 'post · {date}',
    'completion.theme.dark': 'Switch to dark mode',
    'completion.theme.light': 'Switch to light mode',
    'completion.language.zh-CN': 'Switch to Simplified Chinese',
    'completion.language.en': 'Switch to English',
    'error.indexUnavailable': 'Terminal index is unavailable.',
    'error.aboutReserved': 'Use the reserved about command.',
    'error.pathNotFound': 'Path not found: {path}',
    'error.cwdBoundary': 'cd: cannot leave ~/blog/',
    'error.notDirectory': 'cd: not a directory: {path}',
    'error.noDirectory': 'cd: no such directory: {path}',
    'error.postNotFound': 'Post not found: {target}',
    'error.tagNotFound': 'Tag not found: {target}',
    'error.categoryNotFound': 'Category not found: {target}',
    'error.invalidSyntax': 'Invalid command syntax.',
    'error.unknownCommand': 'Unknown command: {command}',
    'error.invalidCwd': 'Command returned an unavailable working directory.',
    'error.commandFailed': 'Command failed.',
    'error.viewUnavailable': 'Indexed {view} view is unavailable.',
    'error.invalidResult': 'Command returned an invalid result.',
    'view.entries': '{count} entries',
    'view.commands': '{count} commands',
    'view.directTotal': '{direct} direct · {total} total',
    'view.directoriesPosts': '{directories} directories · {posts} posts',
    'view.posts': '{count} posts',
    'view.directories': '{count} directories',
    'view.page': 'page',
    'view.directory': 'directory',
    'view.post': 'post',
    'view.oneEntry': '1 entry',
    'view.noPosts': 'No posts found.',
    'view.noTags': 'No tags found.',
    'view.noCategories': 'No categories found.',
    'view.noCommands': 'No commands registered.',
    'view.noEntries': 'No entries found.',
    'view.nativeFallback': 'Use the native links below or retry.',
    'view.loadingIndex': 'loading terminal-index.json…',
    'view.indexedUnavailable': 'indexed view unavailable',
    'view.document': 'document',
    'about.author': 'Author',
    'about.theme': 'Theme',
    'about.posts': 'Posts',
    'about.categories': 'Categories',
    'about.tags': 'Tags',
    'about.updated': 'Updated',
    'about.email': 'Email',
    'renderer.welcomeTitle': "Welcome To One's Blog",
    'renderer.welcomeKicker': 'Welcome to',
    'renderer.terminalPath': 'Terminal path',
    'renderer.blogOverview': 'Blog overview',
    'renderer.avatar': '{title} avatar',
    'renderer.palette': 'The 16 source colors currently used by the active mode',
    'renderer.more': 'more ({count})',
    'renderer.back': 'back',
    'renderer.interrupt': 'interrupt',
    'renderer.retry': 'retry',
    'renderer.commandLabel': 'Terminal command',
    'renderer.placeholder': 'Enter a command, or press Tab to browse',
    'renderer.brandLabel': 'Blog title',
    'renderer.terminalLabel': 'Blog terminal',
    'mobileTab.next': 'Terminal Tab next item',
    'article.return': 'Return to terminal',
    'article.returnText': 'terminal',
    'article.backToTop': 'Back to article start',
    'article.tags': 'Post tags',
    'article.navigation': 'Post navigation',
    'article.toc': 'Table of contents',
    'article.copy': 'Copy {language} code',
    'article.copied': 'Code copied',
    'article.expandCode': 'Expand code block',
    'article.collapseCode': 'Collapse code block',
    'article.expandBranch': 'Expand subsection',
    'article.collapseBranch': 'Collapse subsection',
    'article.showToc': 'Show table of contents',
    'article.hideToc': 'Hide table of contents'
  })
});

export function parseLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['zh-cn', 'zh', 'cn', '简体中文', '中文'].includes(normalized)) return 'zh-CN';
  if (['en', 'en-us', 'en-gb', 'english'].includes(normalized)) return 'en';
  return null;
}

export function normalizeLanguage(value) {
  return parseLanguage(value) || DEFAULT_LANGUAGE;
}

export function isSupportedLanguage(value) {
  return SUPPORTED_LANGUAGES.includes(value);
}

export function readLanguage(storage) {
  if (!storage) return DEFAULT_LANGUAGE;
  try { return normalizeLanguage(storage.getItem(LANGUAGE_STORAGE_KEY)); } catch { return DEFAULT_LANGUAGE; }
}

export function writeLanguage(storage, language) {
  if (!storage) return;
  try { storage.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguage(language)); } catch { /* Storage is optional. */ }
}

export function translate(language, key, values = {}) {
  const selected = MESSAGES[normalizeLanguage(language)] || MESSAGES[DEFAULT_LANGUAGE];
  const template = selected[key] ?? MESSAGES[DEFAULT_LANGUAGE][key] ?? key;
  return String(template).replace(/\{([a-zA-Z0-9_-]+)\}/gu, (match, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  ));
}
