(function() {
  'use strict';

  const ICON_COLLAPSED = '\u25BC';
  const ICON_EXPANDED = '\u25B2';
  const ICON_BRANCH = '\u25B6';
  const ICON_SUN = '\u2600';
  const ICON_MOON = '\u263E';
  const ICON_BRANCH_MID = '\u251C\u2500\u2500 ';
  const ICON_BRANCH_END = '\u2514\u2500\u2500 ';
  const ICON_PIPE = '\u2502   ';
  const ICON_SPACE = '    ';

  const COPY_FEEDBACK_MS = 1500;
  const FLOAT_STAGGER_S = 0.1;
  const CODE_COLLAPSE_H = 300;

  function isMobile() {
    return window.matchMedia('(max-width: 767px)').matches;
  }

  function closeAllSidebars() {
    if (sidebarLeft && sidebarLeft.classList.contains('open')) {
      setSidebarLeft(false);
    }
    if (sidebarRight && sidebarRight.classList.contains('open')) {
      setSidebarRight(false);
    }
  }

  function closeFloatMenu() {
    if (!floatOpen) return;
    floatOpen = false;
    floatSubs.forEach(function(el) {
      el.style.transitionDelay = '0s';
      el.style.transform = 'translate(0, 0) scale(0)';
      el.classList.remove('open');
    });
  }

  const mainEl = document.querySelector('.main');
  let floatOpen = false;

  // === Theme toggle ===
  const btnTheme = document.getElementById('btn-theme');
  const themeIcon = document.getElementById('theme-icon');
  const html = document.documentElement;

  const savedTheme = localStorage.getItem('theme') || 'dark';
  html.setAttribute('data-theme', savedTheme);
  if (savedTheme === 'light') {
    themeIcon.textContent = ICON_SUN;
  }

  if (btnTheme) {
    btnTheme.addEventListener('click', function() {
      const current = html.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      themeIcon.textContent = next === 'dark' ? ICON_MOON : ICON_SUN;
    });
  }

  // === Sidebar state ===
  const sidebarLeft = document.getElementById('sidebar-left');
  const overlay = document.getElementById('sidebar-overlay');
  const sidebarRight = document.getElementById('sidebar-right');

  // Make toc-level-1 headings clickable by adding id/href
  if (sidebarRight) {
    var tocH1s = sidebarRight.querySelectorAll('.toc-level-1 .toc-link:not([href])');
    if (tocH1s.length > 0) {
      var contentArea = document.querySelector('.post-content');
      contentArea && tocH1s.forEach(function(link) {
        var text = (link.querySelector('.toc-text') || link).textContent.trim();
        if (!text) return;
        var h1s = contentArea.querySelectorAll('h1');
        for (var i = 0; i < h1s.length; i++) {
          if (h1s[i].textContent.trim() === text) {
            if (!h1s[i].id) h1s[i].id = text;
            link.setAttribute('href', '#' + encodeURIComponent(text));
            break;
          }
        }
      });
    }
  }

  function setSidebarLeft(open) {
    if (!sidebarLeft) return;
    if (open) {
      sidebarLeft.classList.add('open');
      if (isMobile()) {
        setSidebarRight(false);
      }
    } else {
      sidebarLeft.classList.remove('open');
    }
    localStorage.setItem('sidebar-left', open ? 'open' : 'closed');
    if (overlay) overlay.classList.toggle('show', open);
    updatePadding();
  }

  function setSidebarRight(open) {
    if (!sidebarRight) return;
    if (open) {
      sidebarRight.classList.add('open');
      if (isMobile()) {
        setSidebarLeft(false);
      }
    } else {
      sidebarRight.classList.remove('open');
    }
    localStorage.setItem('sidebar-right', open ? 'open' : 'closed');
    if (overlay) overlay.classList.toggle('show', open);
    updatePadding();
  }

  // Sidebar initial state is defined by HTML (open class).
  // Do not override with localStorage — let server-rendered HTML dictate default.
  // localStorage is still updated when user manually toggles.

  if (overlay) {
    overlay.addEventListener('click', closeAllSidebars);
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeAllSidebars();
    }
  });

  if (mainEl) {
    mainEl.addEventListener('click', function() {
      if (!isMobile()) return;
      closeAllSidebars();
    });
  }

  // === Float gear menu ===
  const floatMenu = document.getElementById('float-menu');
  const floatBtnGear = document.getElementById('float-btn-gear');
  const floatSubs = document.querySelectorAll('.float-btn-sub');
  const floatRadius = 65;
  const floatStartAngle = 135;
  const floatEndAngle = 225;

  if (floatBtnGear && floatSubs.length > 0) {
    // Pre-calculate positions for each sub-button
    const positions = [];
    const n = floatSubs.length;
    const stepDeg = n > 1 ? (floatEndAngle - floatStartAngle) / (n - 1) : 0;
    floatSubs.forEach(function(btn, i) {
      const deg = floatStartAngle + i * stepDeg;
      const rad = deg * Math.PI / 180;
      positions.push({
        el: btn,
        x: Math.round(floatRadius * Math.cos(rad)),
        y: Math.round(floatRadius * Math.sin(rad))
      });
    });

    floatBtnGear.addEventListener('click', function() {
      if (floatOpen) {
        closeFloatMenu();
      } else {
        floatOpen = true;
        positions.forEach(function(pos, i) {
          pos.el.style.transitionDelay = (i * FLOAT_STAGGER_S) + 's';
          pos.el.style.transform = 'translate(0, 0) scale(0)';
          pos.el.getBoundingClientRect();
          pos.el.style.transform = 'translate(' + pos.x + 'px, ' + pos.y + 'px) scale(1)';
          pos.el.classList.add('open');
        });
      }
    });
  }

  document.addEventListener('click', function(e) {
    if (floatMenu && !floatMenu.contains(e.target) && floatOpen) {
      closeFloatMenu();
    }
  });

  // Sub-button sidebar toggles
  const floatBtnLeft = document.getElementById('float-btn-left');
  const floatBtnRight = document.getElementById('float-btn-right');
  if (floatBtnLeft) {
    floatBtnLeft.addEventListener('click', function() {
      setSidebarLeft(!sidebarLeft.classList.contains('open'));
    });
  }
  if (floatBtnRight) {
    floatBtnRight.addEventListener('click', function() {
      setSidebarRight(!sidebarRight.classList.contains('open'));
    });
  }
  // TOC scroll spy
  if (sidebarRight) {
    (function() {
      var tocLinks = sidebarRight.querySelectorAll('a[href^="#"]');
      if (tocLinks.length === 0) return;
      var headings = [];
      tocLinks.forEach(function(link) {
        var href = link.getAttribute('href');
        if (href && href.startsWith('#')) {
          var target = document.getElementById(decodeURIComponent(href.substring(1)));
          if (target) headings.push({ link: link, target: target });
        }
      });
      if (headings.length === 0 || !('IntersectionObserver' in window)) return;
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            headings.forEach(function(h) { h.link.classList.remove('active'); });
            var activeLink = sidebarRight.querySelector('a[href="#' + encodeURIComponent(entry.target.id) + '"]');
            if (activeLink) activeLink.classList.add('active');
          }
        });
      }, { rootMargin: '-60px 0px -80% 0px', threshold: 0 });
      headings.forEach(function(h) { observer.observe(h.target); });
    })();
  }
  // === Code block copy button (delegated) ===
  document.querySelectorAll('figure.highlight').forEach(function(fig) {
    var cls = fig.className.match(/highlight\s+(\w+)/);
    var lang = cls ? cls[1] : 'code';
    if (lang === 'plain' || lang === 'text') lang = 'code';

    var bar = document.createElement('div');
    bar.className = 'highlight-bar';
    bar.textContent = lang;
    bar.setAttribute('data-lang', lang);
    fig.appendChild(bar);
  });

  document.addEventListener('click', function(e) {
    var bar = e.target.closest('.highlight-bar');
    if (!bar) return;
    var fig = bar.parentNode;
    var code = fig.querySelector('.code') || fig.querySelector('pre');
    if (!code) return;
    if (typeof navigator.clipboard !== 'undefined' && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code.innerText).then(function() {
        bar.textContent = 'done';
        bar.classList.add('copied');
        setTimeout(function() {
          bar.textContent = bar.getAttribute('data-lang') || 'code';
          bar.classList.remove('copied');
        }, COPY_FEEDBACK_MS);
      }).catch(function() {});
    }
  });
  // === Code block collapse ===
  document.querySelectorAll('figure.highlight').forEach(function(fig) {
    var table = fig.querySelector('table');
    if (!table) return;

    var body = document.createElement('div');
    body.className = 'code-body';
    table.parentNode.insertBefore(body, table);
    body.appendChild(table);

    var btn = document.createElement('button');
    btn.className = 'code-expand';
    btn.textContent = ICON_COLLAPSED;
    fig.appendChild(btn);

    if (body.scrollHeight <= CODE_COLLAPSE_H) {
      btn.classList.add('hidden');
    } else {
      body.classList.add('collapsible');
    }

    btn.addEventListener('click', function() {
      if (body.classList.contains('expanded')) {
        body.classList.remove('expanded');
        this.textContent = ICON_COLLAPSED;
      } else {
        body.classList.add('expanded');
        this.textContent = ICON_EXPANDED;
      }
    });
  });
  // === TOC tree transform ===
  const tocRoot = document.getElementById('sidebar-right');
  if (tocRoot) {
    (function walk(ol, prefix) {
      if (!ol || !ol.children) return;
      const items = Array.from(ol.children);
      items.forEach(function(li) {
        const link = li.querySelector('.toc-link');
        const childOL = li.querySelector('.toc-child');
        const hasChildren = childOL && childOL.children.length > 0;
        const isLast = !li.nextElementSibling;

        const branch = isLast ? ICON_BRANCH_END : ICON_BRANCH_MID;
        const line = prefix + branch;

        const lineSpan = document.createElement('span');
        lineSpan.className = 'tree-line';
        lineSpan.textContent = line;
        if (link) link.parentNode.insertBefore(lineSpan, link);

        if (hasChildren) {
          const toggle = document.createElement('span');
          toggle.className = 'tree-toggle';
          toggle.textContent = ICON_COLLAPSED;
          if (link) link.parentNode.insertBefore(toggle, link);

          walk(childOL, prefix + (isLast ? ICON_SPACE : ICON_PIPE));
        }
      });
    })(tocRoot.querySelector('.toc'), '');

    tocRoot.querySelectorAll('.toc-child').forEach(function(child) {
      if (!child.classList.contains('collapsed')) {
        child.style.maxHeight = child.scrollHeight + 'px';
      }
    });
  }

  if (tocRoot) {
    tocRoot.addEventListener('click', function(e) {
      var toggle = e.target.closest('.tree-toggle');
      if (!toggle) return;
      e.preventDefault();
      e.stopPropagation();
      var liEl = toggle.closest('.toc-item');
      var childEl = liEl.querySelector('.toc-child');
      if (childEl) {
        var collapsed = childEl.classList.contains('collapsed');
        if (collapsed) {
          childEl.classList.remove('collapsed');
          childEl.style.maxHeight = childEl.scrollHeight + 'px';
          toggle.textContent = ICON_COLLAPSED;
        } else {
          childEl.style.maxHeight = childEl.scrollHeight + 'px';
          requestAnimationFrame(function() {
            childEl.classList.add('collapsed');
            childEl.style.maxHeight = '0px';
          });
          toggle.textContent = ICON_BRANCH;
        }
      }
    });
  }

  // === Dynamic content padding ===

  function updatePadding() {
    if (!mainEl) return;
    if (isMobile()) {
      mainEl.style.paddingLeft = '';
      mainEl.style.paddingRight = '';
      return;
    }
    var style = getComputedStyle(document.documentElement);
    var hPad = parseInt(style.fontSize) * parseFloat(style.getPropertyValue('--main-hpad'));
    var sidebarW = parseInt(style.getPropertyValue('--sidebar-width'));
    var leftOpen = sidebarLeft && sidebarLeft.classList.contains('open');
    var rightOpen = sidebarRight && sidebarRight.classList.contains('open');
    mainEl.style.paddingLeft = (leftOpen ? sidebarW : hPad) + 'px';
    mainEl.style.paddingRight = (rightOpen ? sidebarW : hPad) + 'px';
  }

  if (!isMobile()) {
    if (sidebarLeft && sidebarLeft.getAttribute('data-auto-open') !== 'false') {
      sidebarLeft.classList.add('open');
    }
    if (sidebarRight && sidebarRight.getAttribute('data-auto-open') !== 'false') {
      sidebarRight.classList.add('open');
    }
  }

  updatePadding();
})();
