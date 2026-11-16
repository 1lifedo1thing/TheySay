function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatFetchTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const pad = n => String(n).padStart(2, '0');
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${hours}:${minutes}:${seconds}`;
}

function showToast(message, type = 'warning', duration = 4000) {
  if (typeof window !== 'undefined' && typeof window.__THEYSAY_MANTINE_NOTIFY === 'function') {
    window.__THEYSAY_MANTINE_NOTIFY({ message, type, duration });
    return;
  }

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;
  const icon = type === 'warning' ? '⚠️' : (type === 'error' ? '❌' : (type === 'success' ? '✅' : 'ℹ️'));
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-text">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 250);
  }, duration);
}

const dns = require('dns');

function isNetworkOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  return true;
}

async function canReachHost(hostnameOrUrl, timeoutMs = 2500) {
  if (!isNetworkOnline()) return false;
  let hostname = String(hostnameOrUrl || '').trim();
  if (!hostname) return true;
  try {
    if (hostname.includes('://')) {
      hostname = new URL(hostname).hostname;
    }
  } catch (e) {
    return false;
  }
  if (!hostname) return true;

  let timer = null;
  try {
    await Promise.race([
      dns.promises.lookup(hostname),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), timeoutMs);
      })
    ]);
    return true;
  } catch (e) {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function stripDiscordEditedText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\s*[(\uff08]\s*(?:已编辑|已編輯|edited)\s*[)\uff09]\s*(?:\d{4}\s*年[^\r\n]*|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^\r\n]*)?/gi, '')
    .replace(/\s*[(\uff08]\s*(?:已编辑|已編輯|edited)\s*[)\uff09][^\r\n]*$/i, '')
    .trim();
}

function getUrlHostname(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

function isUrlHostMatching(rawUrl, allowedDomains) {
  const host = getUrlHostname(rawUrl);
  if (!host) return false;
  const list = Array.isArray(allowedDomains) ? allowedDomains : [allowedDomains];
  return list.some((domain) => {
    const d = String(domain || '').toLowerCase();
    return Boolean(d && (host === d || host.endsWith(`.${d}`)));
  });
}

function isUnavatarUrl(rawUrl) {
  return isUrlHostMatching(rawUrl, 'unavatar.io');
}

const ERROR_URL_TITLE_PATTERNS = [
  /^未找到帖子\s*[-–/|]\s*X(?:\s*\|\s*404\s*错误)?$/i,
  /^(?:Post|Page|Tweet)\s+not\s+found\s*[-–/|]\s*(?:X|Twitter)(?:\s*\|\s*404(?:\s*Error)?)?$/i,
  /^(?:X|Twitter)\s*(?:\/\s*\?|[-–|]\s*404(?:\s*(?:Error|错误|Not\s*Found))?)$/i,
  /^(?:HTTP\s*)?(?:400|401|403|404|405|408|410|429|500|502|503|504)(?:\s*[-–:|]\s*(?:Error|错误|Not\s*Found|Forbidden|Unauthorized|Bad\s*Gateway|Service\s*Unavailable|Gateway\s*Time-?out|Too\s*Many\s*Requests|Internal\s*Server\s*Error))?$/i,
  /^(?:404\s*(?:Page\s*)?Not\s*Found|Page\s*Not\s*Found|Not\s*Found|403\s*Forbidden|Access\s*Denied|Just\s*a\s*moment\.{0,3}|Attention\s*Required!\s*\|\s*Cloudflare|Please\s*Wait\.\.\.|页面不存在|找不到页面|未找到页面|404\s*错误)(?:\s*[-–|·]\s*[^|]+)?$/i
];

function extractTwitterStatusId(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (
    !isUrlHostMatching(normalized, [
      'x.com',
      'twitter.com',
      'fxtwitter.com',
      'vxtwitter.com',
      'fixupx.com',
      'fixvx.com'
    ])
  ) {
    return '';
  }
  try {
    const u = new URL(normalized);
    const m = u.pathname.match(/\/(?:i\/(?:web\/)?status|[A-Za-z0-9_]{1,15}\/status)\/(\d{5,})/i);
    return m ? m[1] : '';
  } catch (_) {
    return '';
  }
}

function isGenericTwitterTitle(title, rawUrl = '') {
  const cleaned = String(title || '').trim();
  if (!cleaned) return true;
  if (/^(?:X|Twitter)$/i.test(cleaned)) return true;
  if (rawUrl && extractTwitterStatusId(rawUrl)) {
    if (/^X\s*上的\s*.+\(@[A-Za-z0-9_]+\)$/i.test(cleaned)) return true;
    if (/^.+\(@[A-Za-z0-9_]+\)\s+on\s+(?:X|Twitter)$/i.test(cleaned)) return true;
  }
  return false;
}

function cleanUrlTitleString(rawTitle, rawUrl = '') {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  const cleaned = rawTitle
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (/^https?:\/\/\S+$/i.test(cleaned)) return '';
  if (rawUrl && cleaned.toLowerCase() === String(rawUrl).trim().toLowerCase()) return '';
  if (ERROR_URL_TITLE_PATTERNS.some((re) => re.test(cleaned))) return '';
  if (rawUrl && extractTwitterStatusId(rawUrl) && /^(?:X|Twitter)$/i.test(cleaned)) return '';
  return cleaned;
}

module.exports = {
  escapeHtml,
  randomBetween,
  sleep,
  formatFetchTime,
  showToast,
  isNetworkOnline,
  canReachHost,
  stripDiscordEditedText,
  getUrlHostname,
  isUrlHostMatching,
  isUnavatarUrl,
  extractTwitterStatusId,
  isGenericTwitterTitle,
  cleanUrlTitleString
};
