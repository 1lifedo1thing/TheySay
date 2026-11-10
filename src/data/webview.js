const PQueue = require('p-queue').default;
const { LRUCache } = require('lru-cache');
const { THREADS_PARTITION } = require('../core/constants');
const { isNetworkOnline, canReachHost, sleep } = require('../core/utils');
const { getPostId, isMemberOnlyPost } = require('../core/post');

// Chromium net error codes indicating network disconnection or DNS failure
const OFFLINE_NET_ERROR_CODES = new Set([-106, -105, -21, -109, -118, -102, -101, -137]);

const authDetailCache = new LRUCache({ max: 200 });
const authDetailQueue = new PQueue({ concurrency: 1 });

function getOrCreateSlotWebview(slotIndex, bgWebviewsContainer, slots = []) {
  let wv = document.getElementById(`x-bg-webview-${slotIndex}`);
  if (!wv) {
    wv = document.createElement('webview');
    wv.id = `x-bg-webview-${slotIndex}`;
    wv.src = 'about:blank';
    wv.setAttribute('partition', 'persist:x_session');
    wv.setAttribute('allowpopups', 'true');
    wv.setAttribute('useragent', navigator.userAgent);
    wv.setAttribute('webpreferences', 'backgroundThrottling=no');

    wv._isReady = false;
    wv.addEventListener('dom-ready', () => {
      wv._isReady = true;
    }, { once: true });

    if (bgWebviewsContainer) {
      bgWebviewsContainer.appendChild(wv);
    }
    if (slots[slotIndex]) {
      slots[slotIndex].bgWebview = wv;
    }
  }
  return wv;
}

function getOrCreateDetailWebview() {
  if (typeof document === 'undefined') return null;
  let wv = document.getElementById('x-detail-bg-webview');
  if (!wv) {
    const container = document.getElementById('bg-webviews-container') || document.body;
    if (!container) return null;
    wv = document.createElement('webview');
    wv.id = 'x-detail-bg-webview';
    wv.src = 'about:blank';
    wv.setAttribute('partition', 'persist:x_session');
    wv.setAttribute('allowpopups', 'true');
    wv.setAttribute('useragent', navigator.userAgent);
    wv.setAttribute('webpreferences', 'backgroundThrottling=no');

    wv._isReady = false;
    wv.addEventListener('dom-ready', () => {
      wv._isReady = true;
    }, { once: true });

    container.appendChild(wv);
  }
  return wv;
}

function getOrCreateThreadsSlotWebview(slotIndex, bgWebviewsContainer, slots = []) {
  let wv = document.getElementById(`threads-bg-webview-${slotIndex}`);
  if (!wv) {
    wv = document.createElement('webview');
    wv.id = `threads-bg-webview-${slotIndex}`;
    wv.src = 'about:blank';
    wv.setAttribute('partition', THREADS_PARTITION);
    wv.setAttribute('allowpopups', 'true');
    wv.setAttribute('useragent', navigator.userAgent);
    wv.setAttribute('webpreferences', 'backgroundThrottling=no');

    wv._isReady = false;
    wv.addEventListener('dom-ready', () => {
      wv._isReady = true;
    }, { once: true });

    if (bgWebviewsContainer) {
      bgWebviewsContainer.appendChild(wv);
    }
    if (slots[slotIndex]) {
      slots[slotIndex].threadsBgWebview = wv;
    }
  }
  return wv;
}

function initBackgroundWebviews(bgWebviewsContainer, slots = [], maxSlots = 16) {
  if (bgWebviewsContainer) {
    bgWebviewsContainer.innerHTML = '';
  }
  for (let i = 0; i < maxSlots; i++) {
    getOrCreateSlotWebview(i, bgWebviewsContainer, slots);
  }
}

function waitForWebviewReady(wv) {
  if (!wv) return Promise.resolve();
  if (wv._isReady) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const onReady = () => {
      if (!done) {
        done = true;
        wv._isReady = true;
        resolve();
      }
    };
    wv.addEventListener('dom-ready', onReady, { once: true });
    setTimeout(onReady, 2000);
  });
}

async function loadWebviewTarget(wv, targetUrl) {
  if (!wv) return { ok: false, offline: !isNetworkOnline() };

  // Avoid invoking wv.loadURL altogether when the system is offline or DNS cannot resolve the host,
  // which prevents Electron's GUEST_VIEW_MANAGER_CALL from throwing ERR_INTERNET_DISCONNECTED / ERR_NAME_NOT_RESOLVED.
  const reachable = await canReachHost(targetUrl);
  if (!reachable) {
    return {
      ok: false,
      offline: true,
      errorCode: -106,
      errorDescription: 'ERR_INTERNET_DISCONNECTED'
    };
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (!done) {
        done = true;
        cleanup();
        resolve(result);
      }
    };
    const onReady = () => finish({ ok: true, offline: false });
    const onFail = (e) => {
      if (e && e.isMainFrame === false) return;
      const code = e && typeof e.errorCode === 'number' ? e.errorCode : 0;
      const desc = (e && e.errorDescription) || '';
      const isOfflineErr = !isNetworkOnline() || OFFLINE_NET_ERROR_CODES.has(code);
      finish({
        ok: !isOfflineErr,
        offline: isOfflineErr,
        errorCode: code,
        errorDescription: desc
      });
    };
    let loadTimer = null;
    const cleanup = () => {
      if (loadTimer) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
      wv.removeEventListener('dom-ready', onReady);
      wv.removeEventListener('did-fail-load', onFail);
    };

    wv.addEventListener('dom-ready', onReady, { once: true });
    wv.addEventListener('did-fail-load', onFail);

    loadTimer = setTimeout(() => {
      finish({ ok: isNetworkOnline(), offline: !isNetworkOnline() });
    }, 6000);

    try {
      const loadPromise = wv.loadURL(targetUrl);
      if (loadPromise && typeof loadPromise.catch === 'function') {
        loadPromise.catch(() => {});
      }
    } catch (e) {
      finish({ ok: false, offline: !isNetworkOnline() });
    }
  });
}

async function executeWebviewScript(wv, script, timeoutMs = 8000) {
  if (!wv || typeof wv.executeJavaScript !== 'function') return null;
  let timer = null;
  try {
    const execPromise = Promise.resolve(wv.executeJavaScript(script)).catch(() => null);
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timedOut: true }), timeoutMs);
    });
    const res = await Promise.race([execPromise, timeoutPromise]);
    if (res && res.__timedOut) {
      return null;
    }
    return res;
  } catch (e) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildReactTweetMetaHelperSource() {
  return `
      const extractReactTweetMeta = function(rootEl, targetPostId) {
        const NL = String.fromCharCode(10);
        const DOUBLE_NL = NL + NL;
        const meta = {
          isMemberOnly: false,
          isArticle: false,
          hasFullArticleBody: false,
          articleTitle: '',
          articlePreview: '',
          articleBody: '',
          articleBlocks: [],
          noteTweetText: '',
          legacyFullText: '',
          bestText: '',
          images: []
        };
        if (!rootEl) return meta;

        const addImage = function(u) {
          if (typeof u !== 'string') return;
          const clean = u.trim();
          if (!clean || clean.startsWith('data:') || clean.endsWith('.svg')) return;
          if (clean.includes('profile_images') || clean.includes('default_profile') || clean.includes('/emoji/')) return;
          if (!meta.images.includes(clean)) {
            meta.images.push(clean);
          }
        };

        const stripTrailingMediaTco = function(str) {
          if (typeof str !== 'string') return '';
          let s = str.trim();
          while (/https?:\\/\\/t\\.co\\/[A-Za-z0-9]+$/.test(s)) {
            s = s.replace(/https?:\\/\\/t\\.co\\/[A-Za-z0-9]+$/, '').trim();
          }
          return s;
        };

        const expandUrlsInText = function(rawText, urlEntities) {
          if (typeof rawText !== 'string' || !rawText) return '';
          let out = rawText;
          if (Array.isArray(urlEntities)) {
            for (let i = 0; i < urlEntities.length; i++) {
              const u = urlEntities[i];
              if (u && typeof u.url === 'string' && u.url) {
                const replacement = u.expanded_url || u.display_url || u.url;
                out = out.split(u.url).join(replacement);
              }
            }
          }
          return stripTrailingMediaTco(out);
        };

        const parseArticleObject = function(art) {
          if (!art || typeof art !== 'object') return;
          meta.isArticle = true;
          if (typeof art.title === 'string' && art.title.trim()) {
            meta.articleTitle = art.title.trim();
          }
          if (typeof art.preview_text === 'string' && art.preview_text.trim()) {
            meta.articlePreview = art.preview_text.trim();
          }
          const coverUrl =
            (art.cover_media &&
              art.cover_media.media_info &&
              (art.cover_media.media_info.original_img_url || art.cover_media.media_info.preview_image_url)) ||
            (art.cover_media && art.cover_media.media_url_https) ||
            '';
          if (coverUrl) {
            addImage(coverUrl);
          }

          const mediaById = {};
          if (Array.isArray(art.media_entities)) {
            for (let i = 0; i < art.media_entities.length; i++) {
              const m = art.media_entities[i];
              if (!m || typeof m !== 'object') continue;
              const mUrl =
                (m.media_info && (m.media_info.original_img_url || m.media_info.preview_image_url)) ||
                m.media_url_https ||
                m.media_url ||
                '';
              if (mUrl) {
                addImage(mUrl);
                if (m.media_id) mediaById[String(m.media_id)] = mUrl;
                if (m.id) mediaById[String(m.id)] = mUrl;
                if (m.media_key) mediaById[String(m.media_key)] = mUrl;
              }
            }
          }

          const cs = art.content_state;
          if (cs && Array.isArray(cs.blocks) && cs.blocks.length > 0) {
            const rawEntityMap = cs.entityMap;
            const getEntity = function(key) {
              if (!rawEntityMap) return null;
              const strKey = String(key);
              if (Array.isArray(rawEntityMap)) {
                for (let i = 0; i < rawEntityMap.length; i++) {
                  const entry = rawEntityMap[i];
                  if (entry && String(entry.key) === strKey) {
                    return entry.value || entry;
                  }
                }
                if (typeof key === 'number' && rawEntityMap[key]) {
                  return rawEntityMap[key].value || rawEntityMap[key];
                }
                return null;
              }
              const found = rawEntityMap[strKey] || rawEntityMap[key];
              return found && found.value ? found.value : found;
            };

            const blocksList = [];
            const bodyParts = [];
            if (coverUrl) {
              blocksList.push({ type: 'image', url: coverUrl });
            }
            if (meta.articleTitle) {
              blocksList.push({ type: 'title', text: meta.articleTitle });
            }

            const pushBlockImage = function(u) {
              if (!u) return;
              addImage(u);
              if (!blocksList.some(function(x) { return x.type === 'image' && x.url === u; })) {
                blocksList.push({ type: 'image', url: u });
              }
            };

            for (let i = 0; i < cs.blocks.length; i++) {
              const b = cs.blocks[i];
              if (!b || typeof b !== 'object') continue;

              if (Array.isArray(b.entityRanges)) {
                for (let j = 0; j < b.entityRanges.length; j++) {
                  const er = b.entityRanges[j];
                  if (!er || er.key === undefined) continue;
                  const ent = getEntity(er.key);
                  if (!ent || typeof ent !== 'object') continue;
                  const entData = ent.data || ent;
                  const mediaItems = Array.isArray(entData.mediaItems) ? entData.mediaItems : [];
                  for (let k = 0; k < mediaItems.length; k++) {
                    const mi = mediaItems[k];
                    const mid = mi && (mi.mediaId || mi.media_id || mi.localMediaId);
                    if (mid && mediaById[String(mid)]) {
                      pushBlockImage(mediaById[String(mid)]);
                    }
                  }
                  const singleMid = entData.mediaId || entData.media_id;
                  if (singleMid && mediaById[String(singleMid)]) {
                    pushBlockImage(mediaById[String(singleMid)]);
                  }
                  if (typeof entData.url === 'string' && entData.url.includes('pbs.twimg.com/')) {
                    pushBlockImage(entData.url);
                  }
                }
              }

              const bText = typeof b.text === 'string' ? b.text.trim() : '';
              if (!bText) continue;
              const bType = String(b.type || 'unstyled');
              if (bType.indexOf('header') === 0) {
                blocksList.push({ type: 'heading', text: bText });
                bodyParts.push(bText);
              } else if (bType === 'unordered-list-item') {
                blocksList.push({ type: 'text', text: '• ' + bText });
                bodyParts.push('• ' + bText);
              } else {
                blocksList.push({ type: 'text', text: bText });
                bodyParts.push(bText);
              }
            }

            for (let i = 0; i < meta.images.length; i++) {
              pushBlockImage(meta.images[i]);
            }

            if (bodyParts.length > 0) {
              meta.articleBody = bodyParts.join(DOUBLE_NL);
              meta.articleBlocks = blocksList;
              meta.hasFullArticleBody = true;
            }
          } else if (typeof art.plain_text === 'string' && art.plain_text.trim()) {
            meta.articleBody = art.plain_text.trim();
            meta.hasFullArticleBody = true;
          }
        };

        const seenObjs = new WeakSet();
        const checkObj = function(obj, depth) {
          if (!obj || typeof obj !== 'object' || depth > 20 || seenObjs.has(obj)) return;
          seenObjs.add(obj);

          if (
            obj.exclusive_tweet_info ||
            obj.exclusiveTweetInfo ||
            obj.super_follows_conversation_user_results ||
            obj.superFollowsConversationUserResults ||
            obj.is_super_follow_tweet === true ||
            obj.isSuperFollowTweet === true
          ) {
            meta.isMemberOnly = true;
          }

          const refUrl =
            (typeof obj.url === 'string' && obj.url) ||
            (typeof obj.expanded_url === 'string' && obj.expanded_url) ||
            (obj.ref && typeof obj.ref.url === 'string' && obj.ref.url) ||
            '';
          if (
            refUrl &&
            (refUrl.includes('/creator-subscriptions') ||
             refUrl.includes('/creator_subscriptions') ||
             refUrl.includes('/superfollows') ||
             refUrl.includes('/super_follows'))
          ) {
            meta.isMemberOnly = true;
          }

          const artCandidate =
            (obj.article && obj.article.article_results && obj.article.article_results.result) ||
            (obj.article_results && obj.article_results.result) ||
            (obj.__typename === 'ArticleEntity' ||
             (typeof obj.title === 'string' &&
              (obj.cover_media || obj.content_state || obj.preview_text !== undefined))
              ? obj
              : null);
          if (artCandidate) {
            parseArticleObject(artCandidate);
          }

          const noteCandidate =
            (obj.note_tweet && obj.note_tweet.note_tweet_results && obj.note_tweet.note_tweet_results.result) ||
            (obj.note_tweet_results && obj.note_tweet_results.result) ||
            null;
          if (noteCandidate && typeof noteCandidate.text === 'string' && noteCandidate.text.trim()) {
            const noteUrls = noteCandidate.entity_set && noteCandidate.entity_set.urls;
            const expanded = expandUrlsInText(noteCandidate.text, noteUrls);
            if (expanded.length > meta.noteTweetText.length) {
              meta.noteTweetText = expanded;
            }
          }

          if (obj.legacy && typeof obj.legacy === 'object') {
            const leg = obj.legacy;
            const objId = String(obj.rest_id || obj.id_str || leg.id_str || '');
            if (!targetPostId || !objId || objId === String(targetPostId)) {
              if (typeof leg.full_text === 'string' && leg.full_text.trim()) {
                const legUrls = leg.entities && leg.entities.urls;
                const expandedLeg = expandUrlsInText(leg.full_text, legUrls);
                if (expandedLeg.length > meta.legacyFullText.length) {
                  meta.legacyFullText = expandedLeg;
                }
              }
              const mediaArr =
                (leg.extended_entities && leg.extended_entities.media) ||
                (leg.entities && leg.entities.media) ||
                [];
              if (Array.isArray(mediaArr)) {
                for (let i = 0; i < mediaArr.length; i++) {
                  const m = mediaArr[i];
                  if (m && (m.media_url_https || m.media_url)) {
                    addImage(m.media_url_https || m.media_url);
                  }
                }
              }
            }
          }

          const keys = Object.keys(obj);
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k.startsWith('_') && k !== '__typename') continue;
            if (k === 'quoted_status_result' || k === 'quotedStatus' || k === 'quoted_tweet') continue;
            const val = obj[k];
            if (val && typeof val === 'object') {
              checkObj(val, depth + 1);
            }
          }
        };

        const isArticleRoot = rootEl.tagName && rootEl.tagName.toLowerCase() === 'article';
        const nodes = [rootEl].concat(Array.from(rootEl.querySelectorAll('*')));
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (isArticleRoot && node !== rootEl && node.closest('article') !== rootEl) continue;
          const keys = Object.keys(node);
          for (let j = 0; j < keys.length; j++) {
            const k = keys[j];
            if (k.startsWith('__reactProps$') || k.startsWith('__reactContain')) {
              checkObj(node[k], 0);
            } else if (k.startsWith('__reactFiber$')) {
              let fiber = node[k];
              for (let step = 0; fiber && step < 6; step++) {
                checkObj(fiber.memoizedProps, 0);
                fiber = fiber.return;
              }
            }
          }
        }

        if (meta.articleBody) {
          meta.bestText =
            meta.articleTitle && !meta.articleBody.startsWith(meta.articleTitle)
              ? meta.articleTitle + DOUBLE_NL + meta.articleBody
              : meta.articleBody;
        } else if (meta.noteTweetText) {
          meta.bestText = meta.noteTweetText;
        } else if (meta.articleTitle || meta.articlePreview) {
          meta.bestText = [meta.articleTitle, meta.articlePreview].filter(Boolean).join(DOUBLE_NL);
        } else if (meta.legacyFullText) {
          meta.bestText = meta.legacyFullText;
        }

        return meta;
      };
  `;
}

function buildDetailExtractionScript(postId) {
  const cleanId = String(postId || '').trim();
  return `
  (() => {
    try {
      const targetPostId = ${JSON.stringify(cleanId)};
      const NL = String.fromCharCode(10);
      const DOUBLE_NL = NL + NL;
      ${buildReactTweetMetaHelperSource()}

      const articleReadView = document.querySelector('[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]');
      const allArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"], article'));
      let focalArticle = null;
      for (let i = 0; i < allArticles.length; i++) {
        const a = allArticles[i];
        if (targetPostId && a.querySelector('a[href*="/status/' + targetPostId + '"]')) {
          focalArticle = a;
          break;
        }
      }
      if (!focalArticle && allArticles.length > 0) {
        focalArticle = allArticles[0];
      }

      if (!articleReadView && !focalArticle) {
        return { pending: true };
      }

      // Click "Show more" inside focal article if present
      if (focalArticle) {
        const showMoreBtn = focalArticle.querySelector('[data-testid="tweet-text-show-more-link"]');
        if (showMoreBtn && typeof showMoreBtn.click === 'function') {
          try { showMoreBtn.click(); } catch (e) {}
        }
      }

      const inspectRoot =
        articleReadView ||
        focalArticle ||
        document.querySelector('[data-testid="primaryColumn"]') ||
        document.body;
      const meta = extractReactTweetMeta(inspectRoot, targetPostId);

      // Also check DOM for X Article Read View if present
      const domTitleEl = document.querySelector('[data-testid="twitter-article-title"]');
      const domRichTextEl = document.querySelector('[data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]');
      if (domTitleEl || domRichTextEl || articleReadView) {
        meta.isArticle = true;
        const domTitle = domTitleEl ? (domTitleEl.innerText || '').trim() : meta.articleTitle;
        if (domTitle && !meta.articleTitle) {
          meta.articleTitle = domTitle;
        }
        if (domRichTextEl && !meta.hasFullArticleBody) {
          const domBlocks = [];
          const domTextParts = [];
          if (meta.images.length > 0) {
            domBlocks.push({ type: 'image', url: meta.images[0] });
          }
          if (meta.articleTitle) {
            domBlocks.push({ type: 'title', text: meta.articleTitle });
          }
          const blockNodes = Array.from(
            domRichTextEl.querySelectorAll('h1, h2, h3, p, li, blockquote, [data-block="true"], img[src*="pbs.twimg.com/media/"]')
          );
          const seenTexts = new Set();
          for (let i = 0; i < blockNodes.length; i++) {
            const n = blockNodes[i];
            const tag = n.tagName.toLowerCase();
            if (tag === 'img') {
              const src = n.src || '';
              if (src && !src.includes('profile_images') && !src.includes('/emoji/')) {
                if (!meta.images.includes(src)) meta.images.push(src);
                if (!domBlocks.some(function(x) { return x.type === 'image' && x.url === src; })) {
                  domBlocks.push({ type: 'image', url: src });
                }
              }
              continue;
            }
            const t = (n.innerText || '').trim();
            if (!t || seenTexts.has(t)) continue;
            seenTexts.add(t);
            const isHeading = tag === 'h1' || tag === 'h2' || tag === 'h3';
            domBlocks.push({ type: isHeading ? 'heading' : 'text', text: t });
            domTextParts.push(t);
          }
          if (domTextParts.length === 0) {
            const rawRich = (domRichTextEl.innerText || '').trim();
            if (rawRich) {
              domTextParts.push(rawRich);
              domBlocks.push({ type: 'text', text: rawRich });
            }
          }
          if (domTextParts.length > 0) {
            const joinedDom = domTextParts.join(DOUBLE_NL);
            meta.articleBody = joinedDom;
            meta.bestText =
              meta.articleTitle && !joinedDom.startsWith(meta.articleTitle)
                ? meta.articleTitle + DOUBLE_NL + joinedDom
                : joinedDom;
            meta.articleBlocks = domBlocks;
            meta.hasFullArticleBody = true;
          }
        }
      }

      // Also read DOM tweetText & images on focalArticle
      if (focalArticle) {
        const textEl = focalArticle.querySelector('[data-testid="tweetText"]');
        if (textEl) {
          const domTweetText = (textEl.innerText || '').trim();
          if (domTweetText.length > meta.bestText.length) {
            meta.bestText = domTweetText;
          }
        }
        const mediaImgs = Array.from(
          focalArticle.querySelectorAll(
            '[data-testid="tweetPhoto"] img, [data-testid="card.wrapper"] img, img[src*="pbs.twimg.com/media/"], img[src*="pbs.twimg.com/tweet_video_thumb/"], img[src*="pbs.twimg.com/ext_tw_video_thumb/"], img[src*="pbs.twimg.com/amplify_video_thumb/"]'
          )
        );
        for (let i = 0; i < mediaImgs.length; i++) {
          const img = mediaImgs[i];
          const src = img.src || '';
          if (!src || src.startsWith('data:') || src.endsWith('.svg')) continue;
          if (src.includes('profile_images') || src.includes('default_profile') || src.includes('/emoji/')) continue;
          if (img.closest('[data-testid="Tweet-User-Avatar"]') || img.closest('[data-testid="User-Name"]')) continue;
          if (!meta.images.includes(src)) {
            meta.images.push(src);
          }
        }
      }

      const articleLink = (focalArticle || document).querySelector('a[href*="/articles/"]');
      const articleLinkUrl = articleLink ? (articleLink.href || articleLink.getAttribute('href') || '') : '';

      return {
        success: true,
        text: meta.bestText || '',
        images: meta.images,
        articleBlocks: meta.articleBlocks,
        isMemberOnly: meta.isMemberOnly,
        isArticle: meta.isArticle || Boolean(articleLinkUrl),
        hasFullArticleBody: meta.hasFullArticleBody,
        articleLinkUrl: articleLinkUrl
      };
    } catch (e) {
      return { error: e.message };
    }
  })()
  `;
}

function isPlaceholderPostText(text) {
  const s = String(text || '').trim();
  return (
    !s ||
    s === '(该推文为纯媒体/卡片内容，无文本)' ||
    s === '(Media or card post with no text)' ||
    s === '此推文为创作者会员 / 订阅专享内容' ||
    s === 'This post is exclusive to subscribers'
  );
}

function shouldFetchAuthenticatedDetail(post) {
  if (!post || post.source === 'discord' || post.source === 'threads' || post.isMerged) {
    return false;
  }
  if (post.authDetailFetched) return false;
  const postId = getPostId(post);
  if (!postId || !/^\d+$/.test(postId)) return false;

  if (post.isArticle && !post.hasFullArticleBody) return true;
  if (isMemberOnlyPost(post)) {
    if (isPlaceholderPostText(post.text) || post.isTruncated || !post.hasFullArticleBody) {
      return true;
    }
  }
  if (
    isPlaceholderPostText(post.text) &&
    Array.isArray(post.images) &&
    post.images.length > 0
  ) {
    return true;
  }
  return false;
}

function fetchAuthenticatedTweetDetail(postOrId) {
  const post = typeof postOrId === 'object' && postOrId ? postOrId : null;
  const postId = post ? getPostId(post) : String(postOrId || '').trim();
  if (!postId || !/^\d+$/.test(postId)) return Promise.resolve(null);

  if (typeof window !== 'undefined' && window.__THEYSAY_MOCK_TWEET_DATA) {
    const mockVal =
      typeof window.__THEYSAY_MOCK_TWEET_DATA === 'function'
        ? window.__THEYSAY_MOCK_TWEET_DATA(postId)
        : window.__THEYSAY_MOCK_TWEET_DATA[postId];
    if (mockVal) return Promise.resolve(mockVal);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const rawMock = localStorage.getItem('theysay_mock_tweet_data');
      if (rawMock) {
        const parsedMock = JSON.parse(rawMock);
        if (parsedMock && parsedMock[postId]) {
          return Promise.resolve(parsedMock[postId]);
        }
      }
    } catch (_) {}
  }

  // Skip real network navigation during automated background test mode
  if (typeof process !== 'undefined' && process.env && process.env.THEYSAY_BACKGROUND_TEST === '1') {
    return Promise.resolve(null);
  }

  if (authDetailCache.has(postId)) {
    return authDetailCache.get(postId);
  }

  const targetUrl =
    (post && post.url && post.url.startsWith('http'))
      ? post.url
      : `https://x.com/i/status/${postId}`;

  const promise = authDetailQueue.add(async () => {
    try {
      if (!isNetworkOnline()) {
        authDetailCache.delete(postId);
        return null;
      }
      const wv = getOrCreateDetailWebview();
      if (!wv) {
        authDetailCache.delete(postId);
        return null;
      }
      await waitForWebviewReady(wv);
      const loadRes = await loadWebviewTarget(wv, targetUrl);
      if (loadRes && loadRes.offline) {
        authDetailCache.delete(postId);
        return null;
      }

      let bestResult = null;
      let navigatedToArticle = false;

      for (let attempt = 0; attempt < 15; attempt++) {
        await sleep(380);
        if (typeof wv.isLoading === 'function' && wv.isLoading()) {
          continue;
        }
        const script = buildDetailExtractionScript(postId);
        const res = await executeWebviewScript(wv, script, 5000);
        if (!res || res.pending || res.error) {
          continue;
        }
        if (res.success) {
          bestResult = res;
          if (res.hasFullArticleBody) {
            break;
          }
          if (res.isArticle && !res.hasFullArticleBody) {
            if (res.articleLinkUrl && !navigatedToArticle && attempt >= 2) {
              navigatedToArticle = true;
              const fullArtUrl = res.articleLinkUrl.startsWith('http')
                ? res.articleLinkUrl
                : `https://x.com${res.articleLinkUrl}`;
              await loadWebviewTarget(wv, fullArtUrl);
              continue;
            }
            if (attempt < 5) {
              continue;
            }
          }
          if (res.text || (Array.isArray(res.images) && res.images.length > 0)) {
            if (attempt >= 1) break;
          }
        }
      }

      if (!bestResult) {
        authDetailCache.delete(postId);
        return null;
      }
      return bestResult;
    } catch (_) {
      authDetailCache.delete(postId);
      return null;
    }
  });

  authDetailCache.set(postId, promise);
  return promise;
}

module.exports = {
  getOrCreateSlotWebview,
  getOrCreateDetailWebview,
  getOrCreateThreadsSlotWebview,
  initBackgroundWebviews,
  waitForWebviewReady,
  loadWebviewTarget,
  executeWebviewScript,
  buildReactTweetMetaHelperSource,
  isPlaceholderPostText,
  shouldFetchAuthenticatedDetail,
  fetchAuthenticatedTweetDetail
};

