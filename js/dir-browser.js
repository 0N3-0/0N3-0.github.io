(function() {
  var tree = JSON.parse(document.getElementById('dir-tree-data').textContent);
  var stack = [];
  var current = tree;

  function render() {
    var list = document.getElementById('dir-list');
    var path = document.getElementById('dir-path');

    var entries = [];
    Object.keys(current).forEach(function(key) {
      if (key.charAt(0) === '_') return;
      entries.push({ key: key, data: current[key] });
    });
    entries.sort(function(a, b) {
      if (a.data._isDir && !b.data._isDir) return -1;
      if (!a.data._isDir && b.data._isDir) return 1;
      return a.key.localeCompare(b.key);
    });

    list.innerHTML = '';
    entries.forEach(function(e) {
      var li = document.createElement('li');
      if (e.data._isDir) {
        li.innerHTML = '<span class="dir-folder">' + e.key + '/</span>';
        li.classList.add('dir-entry');
        li.addEventListener('click', function() {
          stack.push(current);
          current = current[e.key];
          render();
        });
      } else {
        li.innerHTML = '<a class="dir-file" href="' + e.data.url + '">' + e.data.title + '</a>';
        li.classList.add('dir-entry');
      }
      list.appendChild(li);
    });

    if (stack.length > 0) {
      path.innerHTML = '<span class="dir-back" id="dir-back">← 返回</span>';
      document.getElementById('dir-back').addEventListener('click', function() {
        current = stack.pop();
        render();
      });
    } else {
      path.innerHTML = '';
    }
  }

  render();
})();
