(function () {
  'use strict';
  var root = document.getElementById('cloud-drive');
  if (!root) return;
  var owner = root.dataset.owner;
  var repo = root.dataset.repo;
  var branch = root.dataset.branch;
  var path = root.dataset.path;
  var status = root.querySelector('[data-drive-status]');
  var list = root.querySelector('[data-drive-list]');
  var empty = root.querySelector('[data-drive-empty]');
  var upload = root.querySelector('[data-drive-upload]');
  var refresh = root.querySelector('[data-drive-refresh]');
  var extensions = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz'];

  upload.href = 'https://github.com/' + owner + '/' + repo + '/upload/' + branch + '/' + path;

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (char) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char];
    });
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    var units = ['B', 'KB', 'MB'];
    var index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0) + ' ' + units[index];
  }

  function isArchive(file) {
    var extension = file.name.split('.').pop().toLowerCase();
    return file.type === 'file' && extensions.indexOf(extension) !== -1;
  }

  async function loadFiles() {
    refresh.disabled = true;
    status.textContent = '正在读取文件...';
    try {
      var endpoint = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path + '?ref=' + encodeURIComponent(branch);
      var response = await fetch(endpoint, {headers:{Accept:'application/vnd.github+json'}});
      if (response.status === 404) throw new Error('尚未创建 drive 分支或 files 目录，请先按上线指南初始化。');
      if (response.status === 403) throw new Error('GitHub 临时限制了访问频率，请稍后刷新。');
      if (!response.ok) throw new Error('文件列表读取失败。');
      var files = (await response.json()).filter(isArchive).sort(function (a, b) {
        return a.name.localeCompare(b.name, 'zh-CN');
      });
      list.innerHTML = files.map(function (file) {
        return '<article class="drive-file">' +
          '<div class="drive-file-icon"><i class="fa fa-file-archive"></i></div>' +
          '<div class="drive-file-info"><h3>' + escapeHtml(file.name) + '</h3>' +
          '<p>GitHub 仓库文件</p><span>' + formatSize(file.size) + '</span></div>' +
          '<div class="drive-file-actions"><a class="drive-download" href="' + escapeHtml(file.download_url) + '" download target="_blank" rel="noopener">下载</a></div>' +
          '</article>';
      }).join('');
      empty.hidden = files.length > 0;
      status.textContent = '共 ' + files.length + ' 个文件';
    } catch (error) {
      list.innerHTML = '';
      empty.hidden = true;
      status.textContent = error.message;
    } finally {
      refresh.disabled = false;
    }
  }

  refresh.addEventListener('click', loadFiles);
  loadFiles();
}());