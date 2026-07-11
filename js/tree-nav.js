(function() {
  var tree = JSON.parse(document.getElementById('tree-data').textContent);
  var currentSource = typeof sidebarCurrentSource !== 'undefined' ? sidebarCurrentSource : '';
  var pathStack = [];
  var currentPath = [];

  // If current post is in a subdirectory, auto-navigate there
  if (currentSource && currentSource.indexOf('/') !== -1) {
    var parts = currentSource.split('/');
    pathStack.push([]); // push root as initial stack entry for back navigation
    for (var i = 0; i < parts.length - 1; i++) {
      currentPath.push(parts[i]);
    }
  }

  // Save current path to localStorage
  function savePath() {
    try {
      localStorage.setItem('tree-path', JSON.stringify(currentPath));
    } catch(e) {}
  }

  // Try restoring from localStorage
  try {
    var saved = localStorage.getItem('tree-path');
    if (saved) {
      var savedPath = JSON.parse(saved);
      if (currentSource.indexOf(savedPath.join('/')) === 0) {
        currentPath = savedPath;
        // Rebuild pathStack so back navigation works
        for (var i = 0; i < savedPath.length; i++) {
          pathStack.push(savedPath.slice(0, i));
        }
      }
    }
  } catch(e) {}

  function getNode() {
    var node = tree;
    for (var i = 0; i < currentPath.length; i++) {
      node = node[currentPath[i]];
    }
    return node;
  }

  function render() {
    var node = getNode();
    var list = document.getElementById('tree-list');
    var nav = document.getElementById('tree-nav');
    var backLabel = document.getElementById('tree-back-label');

    list.innerHTML = '';
    var entries = [];
    Object.keys(node).forEach(function(key) {
      if (key.charAt(0) === '_') return;
      entries.push({ key: key, data: node[key] });
    });
    entries.sort(function(a, b) {
      if (a.data._isDir && !b.data._isDir) return -1;
      if (!a.data._isDir && b.data._isDir) return 1;
      return a.key.localeCompare(b.key);
    });

    entries.forEach(function(e) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      if (e.data._isFile) {
        a.href = e.data.url;
        a.textContent = e.data.title;
        if (e.data.source === currentSource) a.classList.add('active');
        a.addEventListener('click', function() {
          savePath();
        });
      } else {
        a.textContent = e.key + '/';
        a.style.cursor = 'pointer';
        a.dataset.dir = e.key;
        a.addEventListener('click', function(ev) {
          ev.preventDefault();
          pathStack.push(currentPath.slice());
          currentPath.push(ev.target.dataset.dir);
          savePath();
          render();
        });
      }
      li.appendChild(a);
      list.appendChild(li);
    });

    if (currentPath.length > 0) {
      nav.style.display = 'block';
      backLabel.textContent = currentPath[currentPath.length - 1];
      document.getElementById('tree-back').onclick = function() {
        currentPath = pathStack.pop();
        savePath();
        render();
      };
    } else {
      nav.style.display = 'none';
    }
  }

  render();
})();
