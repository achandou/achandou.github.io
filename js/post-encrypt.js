(function () {
  'use strict';

  var MAX_ITERATIONS = 2000000;

  function base64ToBytes(value) {
    var binary = window.atob(value);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function concatBytes(first, second) {
    var result = new Uint8Array(first.length + second.length);
    result.set(first, 0);
    result.set(second, first.length);
    return result;
  }

  function parsePayload(root) {
    var element = root.querySelector('.pe-payload');
    if (!element) throw new Error('missing-payload');
    var payload = JSON.parse(element.textContent);
    if (!payload || payload.v !== 1 || payload.alg !== 'AES-256-GCM') {
      throw new Error('unsupported-payload');
    }
    if (!Number.isFinite(payload.iter) || payload.iter < 10000 || payload.iter > MAX_ITERATIONS) {
      throw new Error('invalid-iterations');
    }
    return payload;
  }

  async function decrypt(payload, password) {
    if (!window.crypto || !window.crypto.subtle) throw new Error('no-webcrypto');

    var encoder = new TextEncoder();
    var baseKey = await window.crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    var key = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: base64ToBytes(payload.salt),
        iterations: payload.iter,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    var plain = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(payload.iv),
        tagLength: 128
      },
      key,
      concatBytes(base64ToBytes(payload.ct), base64ToBytes(payload.tag))
    );

    return new TextDecoder().decode(plain);
  }

  function addCopyButtons(scope) {
    scope.querySelectorAll('figure.highlight').forEach(function (figure) {
      if (figure.parentNode && figure.parentNode.classList.contains('highlight-container')) return;
      var code = figure.querySelector('.code');
      if (!code) return;
      var box = document.createElement('div');
      box.className = 'highlight-container';
      figure.parentNode.insertBefore(box, figure);
      box.appendChild(figure);
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-btn';
      button.setAttribute('aria-label', '复制代码');
      button.innerHTML = '<i class="fa fa-clipboard fa-fw"></i>';
      button.addEventListener('click', function () {
        var text = Array.prototype.map.call(figure.querySelectorAll('.code .line'), function (line) {
          return line.innerText;
        }).join('\n');
        var done = function () {
          button.innerHTML = '<i class="fa fa-check fa-fw"></i>';
          window.setTimeout(function () {
            button.innerHTML = '<i class="fa fa-clipboard fa-fw"></i>';
          }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {});
          return;
        }
        var area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'absolute';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); done(); } catch (error) {}
        document.body.removeChild(area);
      });
      box.appendChild(button);
    });
  }

  function init(root) {
    if (!root || root.dataset.peReady === '1') return;
    root.dataset.peReady = '1';

    var payload;
    try {
      payload = parsePayload(root);
    } catch (error) {
      var failed = root.querySelector('.pe-error');
      if (failed) failed.textContent = '加密数据读取失败，请刷新页面重试。';
      return;
    }

    var form = root.querySelector('.pe-form');
    var input = root.querySelector('.pe-input');
    var submit = root.querySelector('.pe-submit');
    var errorBox = root.querySelector('.pe-error');
    var card = root.querySelector('.pe-locked');
    var hint = root.querySelector('.pe-hint');
    var attempts = 0;
    var lockedUntil = 0;
    var busy = false;

    if (!form || !input || !submit) return;

    function setError(message) {
      errorBox.textContent = message || '';
      card.classList.remove('pe-shake');
      if (message) {
        // 重新触发动画
        void card.offsetWidth;
        card.classList.add('pe-shake');
      }
    }

    function setBusy(value) {
      busy = value;
      root.setAttribute('aria-busy', value ? 'true' : 'false');
      submit.disabled = value;
      input.disabled = value;
      submit.textContent = value ? '解密中…' : '解锁阅读';
    }

    function unlock() {
      if (busy) return;
      var password = input.value;
      if (!password) {
        setError('请输入访问密码。');
        input.focus();
        return;
      }
      if (Date.now() < lockedUntil) {
        setError('尝试次数过多，请稍等几秒再试。');
        return;
      }

      setBusy(true);
      setError('');

      decrypt(payload, password).then(function (html) {
        var content = document.createElement('div');
        content.className = 'pe-content';
        content.innerHTML = html;
        root.appendChild(content);
        root.classList.add('is-unlocked');
        addCopyButtons(content);
        if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
          window.MathJax.typesetPromise([content]).catch(function () {});
        }
        input.value = '';
        if (hint) hint.hidden = true;
        content.setAttribute('tabindex', '-1');
        content.focus({ preventScroll: true });
      }).catch(function (error) {
        attempts += 1;
        if (attempts >= 5) {
          lockedUntil = Date.now() + 3000;
          attempts = 0;
        }
        if (error && error.message === 'no-webcrypto') {
          setError('当前浏览器环境不支持本地解密，请使用 HTTPS 或 localhost 访问。');
        } else {
          setError('密码不正确，请再试一次。');
          input.select();
        }
      }).finally(function () {
        setBusy(false);
      });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      unlock();
    });

    input.addEventListener('keydown', function (event) {
      if (event.getModifierState && event.getModifierState('CapsLock')) {
        setError('提示：大写锁定已开启。');
      }
    });

    input.addEventListener('input', function () {
      if (errorBox.textContent && errorBox.textContent.indexOf('大写锁定') !== 0) {
        errorBox.textContent = '';
      }
    });
  }

  function initAll() {
    document.querySelectorAll('[data-post-encrypt]').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
  document.addEventListener('pjax:success', initAll);
})();
