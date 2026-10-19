(function () {
  'use strict';

  var root = document.getElementById('cloud-drive');
  if (!root) return;

  var owner = root.dataset.owner;
  var repo = root.dataset.repo;
  var branch = root.dataset.branch;
  var path = root.dataset.path;
  var extensions = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz'];
  var CACHE_KEY = 'monthly-notes-drive-v1';
  var CACHE_TTL = 5 * 60 * 1000;

  var status = root.querySelector('[data-drive-status]');
  var list = root.querySelector('[data-drive-list]');
  var empty = root.querySelector('[data-drive-empty]');
  var errorBox = root.querySelector('[data-drive-error]');
  var errorText = root.querySelector('[data-drive-error-text]');
  var upload = root.querySelector('[data-drive-upload]');
  var refresh = root.querySelector('[data-drive-refresh]');
  var retry = root.querySelector('[data-drive-retry]');
  var filter = root.querySelector('[data-drive-filter]');
  var sort = root.querySelector('[data-drive-sort]');

  var state = {
    files: [],
    keyword: '',
    sort: 'name',
    loading: false,
    cachedAt: 0,
    fromCache: false
  };

  if (upload) {
    upload.href = 'https://github.com/' + owner + '/' + repo + '/upload/' + branch + '/' + path;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char];
    });
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    var value = bytes / Math.pow(1024, index);
    return (index === 0 ? Math.round(value) : value.toFixed(1)) + ' ' + units[index];
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';
    var date = new Date(timestamp);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function fileExtension(name) {
    var parts = String(name).split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  function isArchive(file) {
    return file.type === 'file' && extensions.indexOf(fileExtension(file.name)) !== -1;
  }

  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (!cached || !Array.isArray(cached.files) || !cached.at) return null;
      if (Date.now() - cached.at > CACHE_TTL) return null;
      return cached;
    } catch (error) {
      return null;
    }
  }

  function writeCache(files) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), files: files }));
    } catch (error) {}
  }

  function render() {
    var keyword = state.keyword.trim().toLowerCase();
    var files = state.files.filter(function (file) {
      return !keyword || file.name.toLowerCase().indexOf(keyword) !== -1;
    });

    files.sort(function (a, b) {
      if (state.sort === 'size-desc') return b.size - a.size;
      if (state.sort === 'size-asc') return a.size - b.size;
      var compared = a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
      return state.sort === 'name-desc' ? -compared : compared;
    });

    list.innerHTML = files.map(function (file) {
      var extension = fileExtension(file.name).toUpperCase();
      return '<article class="drive-file">' +
        '<div class="drive-file-icon" aria-hidden="true"><i class="fa fa-file-archive"></i></div>' +
        '<div class="drive-file-info"><h3 title="' + escapeHtml(file.name) + '">' + escapeHtml(file.name) + '</h3>' +
        '<p>' + escapeHtml(extension) + ' 压缩包 · ' + formatSize(file.size) + '</p></div>' +
        '<div class="drive-file-actions">' +
          '<a class="drive-download" href="' + escapeHtml(file.download_url) + '" download target="_blank" rel="noopener"><i class="fa fa-download"></i> 下载</a>' +
          '<button type="button" class="drive-copy" data-copy-url="' + escapeHtml(file.download_url) + '" aria-label="复制下载链接" title="复制下载链接"><i class="fa fa-link"></i></button>' +
        '</div>' +
      '</article>';
    }).join('');

    empty.hidden = state.files.length > 0 || Boolean(state.keyword) || state.loading;
    if (keyword && state.files.length > 0 && files.length === 0) {
      empty.hidden = false;
      empty.querySelector('p').textContent = '没有匹配「' + state.keyword + '」的文件。';
      empty.querySelector('.drive-empty-hint').textContent = '换个关键词，或清空筛选查看全部。';
    } else if (state.files.length > 0) {
      empty.querySelector('p').textContent = '暂时没有可下载的文件。';
      empty.querySelector('.drive-empty-hint').textContent = '点击右上角「上传文件」把压缩包放进 drive 分支。';
    }

    var total = state.files.length;
    var shown = files.length;
    var parts = ['共 ' + total + ' 个文件'];
    if (keyword) parts.push('匹配 ' + shown + ' 个');
    if (state.cachedAt) parts.push('缓存于 ' + formatTime(state.cachedAt));
    status.textContent = parts.join(' · ');
  }

  function showError(message) {
    errorText.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorText.textContent = '';
  }

  function handleFetchError(response) {
    if (response.status === 404) {
      return '还没找到 drive 分支或 files 目录。请先按 CLOUD_DRIVE_GUIDE.md 初始化网盘分支。';
    }
    if (response.status === 403) {
      var reset = response.headers.get('X-RateLimit-Reset');
      if (reset) {
        var minutes = Math.max(1, Math.ceil((Number(reset) * 1000 - Date.now()) / 60000));
        return 'GitHub 临时限制了访问频率，大约 ' + minutes + ' 分钟后可以重试。';
      }
      return 'GitHub 临时限制了访问频率，请稍后再试。';
    }
    return '文件列表读取失败（HTTP ' + response.status + '）。';
  }

  async function load(force) {
    if (state.loading) return;
    state.loading = true;
    clearError();
    if (refresh) refresh.disabled = true;
    status.textContent = '正在读取文件…';

    if (!force) {
      var cached = readCache();
      if (cached) {
        state.files = cached.files.filter(isArchive);
        state.cachedAt = cached.at;
        state.fromCache = true;
        render();
      }
    }

    try {
      var endpoint = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path + '?ref=' + encodeURIComponent(branch);
      var response = await fetch(endpoint, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: force ? 'no-store' : 'default'
      });
      if (!response.ok) throw new Error(handleFetchError(response));
      var files = (await response.json()).filter(isArchive);
      state.files = files;
      state.cachedAt = Date.now();
      state.fromCache = false;
      writeCache(files);
      render();
    } catch (error) {
      if (state.files.length === 0) {
        status.textContent = '读取失败';
        empty.hidden = true;
        showError(error.message || '网络异常，请稍后重试。');
      } else {
        status.textContent = '显示的是缓存列表 · 共 ' + state.files.length + ' 个文件';
        showError('刷新失败：' + (error.message || '网络异常') + '。当前显示上次缓存。');
      }
    } finally {
      state.loading = false;
      if (refresh) refresh.disabled = false;
      render();
    }
  }

  function copyLink(button) {
    var url = button.dataset.copyUrl;
    if (!url) return;
    var done = function () {
      var original = button.innerHTML;
      button.innerHTML = '<i class="fa fa-check"></i>';
      button.classList.add('is-copied');
      window.setTimeout(function () {
        button.innerHTML = original;
        button.classList.remove('is-copied');
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () {});
      return;
    }
    var area = document.createElement('textarea');
    area.value = url;
    area.style.position = 'absolute';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); done(); } catch (error) {}
    document.body.removeChild(area);
  }

  if (refresh) refresh.addEventListener('click', function () { load(true); });
  if (retry) retry.addEventListener('click', function () { load(true); });

  if (filter) {
    var timer;
    filter.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        state.keyword = filter.value;
        render();
      }, 120);
    });
  }

  if (sort) {
    sort.addEventListener('change', function () {
      state.sort = sort.value;
      render();
    });
  }

  list.addEventListener('click', function (event) {
    var button = event.target.closest('.drive-copy');
    if (button) copyLink(button);
  });

  load(false);
}());
