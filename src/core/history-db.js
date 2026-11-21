const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DEFAULT_SLOT_MUTED } = require('./constants');
const { detectSourceType, getCanonicalTargetKey } = require('./source');
const { getPostId, getPostKey, getPostTimestamp, isMemberOnlyPost } = require('./post');

const SCHEMA_VERSION = 1;
const SCHEMA_SQL_PATH = path.join(__dirname, 'history-schema.sql');
let cachedSchemaSql = null;

function loadSchemaSql() {
  if (cachedSchemaSql === null) {
    cachedSchemaSql = fs.readFileSync(SCHEMA_SQL_PATH, 'utf8');
  }
  return cachedSchemaSql;
}

function sanitizeValueForStorage(value) {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'function' || t === 'symbol') return undefined;
  if (t !== 'object') return value;
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) {
      const cleaned = sanitizeValueForStorage(value[i]);
      if (cleaned !== undefined) {
        out.push(cleaned);
      }
    }
    return out;
  }
  const out = {};
  for (const key of Object.keys(value)) {
    if (key.startsWith('_')) continue;
    const cleaned = sanitizeValueForStorage(value[key]);
    if (cleaned !== undefined) {
      out[key] = cleaned;
    }
  }
  return out;
}

function getEntryPosts(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (Array.isArray(entry.posts)) return entry.posts;
  if (Array.isArray(entry.tweets)) return entry.tweets;
  return null;
}

function parseJsonSafe(raw, fallback) {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

class HistoryDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    if (dbPath && dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    this._syncSeq = 0;
    this._initSchema();
    this._prepareStatements();
  }

  _initSchema() {
    this.db.exec(loadSchemaSql());

    const currentVersion = Number(this.db.pragma('user_version', { simple: true })) || 0;
    if (currentVersion < SCHEMA_VERSION) {
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }

    const maxSeqRow = this.db.prepare('SELECT COALESCE(MAX(sync_seq), 0) AS max_seq FROM posts').get();
    this._syncSeq = (maxSeqRow && Number(maxSeqRow.max_seq)) || 0;
  }

  _prepareStatements() {
    this._stmts = {
      getTarget: this.db.prepare('SELECT * FROM targets WHERE target_key = ?'),
      getAllTargets: this.db.prepare('SELECT * FROM targets'),
      getAllSlots: this.db.prepare('SELECT * FROM slots ORDER BY slot_index ASC'),
      getSlot: this.db.prepare('SELECT * FROM slots WHERE slot_index = ?'),
      getPostsByTarget: this.db.prepare(
        'SELECT post_key, is_unread, data_json FROM posts WHERE target_key = ? ORDER BY timestamp ASC, post_id ASC, post_key ASC'
      ),
      getPostByKey: this.db.prepare(
        'SELECT post_key, is_unread, data_json FROM posts WHERE target_key = ? AND post_key = ?'
      ),
      getUnreadPostsByTarget: this.db.prepare(
        'SELECT post_key, data_json FROM posts WHERE target_key = ? AND is_unread = 1'
      ),
      getKeysByTarget: this.db.prepare(
        'SELECT post_key, is_read, is_known FROM target_keys WHERE target_key = ?'
      ),
      getReadKeysByTarget: this.db.prepare(
        'SELECT post_key FROM target_keys WHERE target_key = ? AND is_read = 1'
      ),
      upsertTarget: this.db.prepare(`
        INSERT INTO targets (
          target_key, handle, source, display_name, user_handle,
          source_title, source_subtitle, avatar_url, is_muted,
          last_fetched_at, max_read_timestamp, pinned_collapsed,
          pinned_keys_json, pinned_posts_json, updated_at
        ) VALUES (
          @target_key, @handle, @source, @display_name, @user_handle,
          @source_title, @source_subtitle, @avatar_url, @is_muted,
          @last_fetched_at, @max_read_timestamp, @pinned_collapsed,
          @pinned_keys_json, @pinned_posts_json, @updated_at
        )
        ON CONFLICT(target_key) DO UPDATE SET
          handle = excluded.handle,
          source = excluded.source,
          display_name = excluded.display_name,
          user_handle = excluded.user_handle,
          source_title = excluded.source_title,
          source_subtitle = excluded.source_subtitle,
          avatar_url = excluded.avatar_url,
          is_muted = excluded.is_muted,
          last_fetched_at = excluded.last_fetched_at,
          max_read_timestamp = excluded.max_read_timestamp,
          pinned_collapsed = excluded.pinned_collapsed,
          pinned_keys_json = excluded.pinned_keys_json,
          pinned_posts_json = excluded.pinned_posts_json,
          updated_at = excluded.updated_at
      `),
      upsertSlot: this.db.prepare(`
        INSERT INTO slots (
          slot_index, target_key, handle, source, is_muted, last_fetched_at, updated_at
        ) VALUES (
          @slot_index, @target_key, @handle, @source, @is_muted, @last_fetched_at, @updated_at
        )
        ON CONFLICT(slot_index) DO UPDATE SET
          target_key = excluded.target_key,
          handle = excluded.handle,
          source = excluded.source,
          is_muted = excluded.is_muted,
          last_fetched_at = excluded.last_fetched_at,
          updated_at = excluded.updated_at
      `),
      deleteSlot: this.db.prepare('DELETE FROM slots WHERE slot_index = ?'),
      deleteAllSlots: this.db.prepare('DELETE FROM slots'),
      upsertPost: this.db.prepare(`
        INSERT INTO posts (
          target_key, post_key, post_id, timestamp, is_unread, is_pinned,
          is_member_only, data_json, sync_seq, updated_at
        ) VALUES (
          @target_key, @post_key, @post_id, @timestamp, @is_unread, @is_pinned,
          @is_member_only, @data_json, @sync_seq, @updated_at
        )
        ON CONFLICT(target_key, post_key) DO UPDATE SET
          post_id = excluded.post_id,
          timestamp = excluded.timestamp,
          is_unread = excluded.is_unread,
          is_pinned = excluded.is_pinned,
          is_member_only = excluded.is_member_only,
          data_json = excluded.data_json,
          sync_seq = excluded.sync_seq,
          updated_at = excluded.updated_at
      `),
      deleteStalePostsForTarget: this.db.prepare(
        'DELETE FROM posts WHERE target_key = ? AND sync_seq != ?'
      ),
      deleteAllPostsForTarget: this.db.prepare('DELETE FROM posts WHERE target_key = ?'),
      updatePostRead: this.db.prepare(
        'UPDATE posts SET is_unread = 0, data_json = ?, updated_at = ? WHERE target_key = ? AND post_key = ?'
      ),
      upsertTargetKey: this.db.prepare(`
        INSERT INTO target_keys (target_key, post_key, is_read, is_known)
        VALUES (@target_key, @post_key, @is_read, @is_known)
        ON CONFLICT(target_key, post_key) DO UPDATE SET
          is_read = MAX(target_keys.is_read, excluded.is_read),
          is_known = MAX(target_keys.is_known, excluded.is_known)
      `),
      updateTargetMaxReadTs: this.db.prepare(
        'UPDATE targets SET max_read_timestamp = MAX(max_read_timestamp, ?), updated_at = ? WHERE target_key = ?'
      ),
      hasPostsForSource: this.db.prepare(`
        SELECT 1 AS found
        FROM posts p
        INNER JOIN targets t ON t.target_key = p.target_key
        WHERE t.source = ?
        LIMIT 1
      `),
      countTargets: this.db.prepare('SELECT COUNT(*) AS cnt FROM targets'),
      countSlots: this.db.prepare('SELECT COUNT(*) AS cnt FROM slots'),
      countPosts: this.db.prepare('SELECT COUNT(*) AS cnt FROM posts')
    };
  }

  _hydrateTargetRow(row, { includePosts = true, slotRow = null } = {}) {
    if (!row) return null;
    const targetKey = row.target_key;
    const pinnedKeys = parseJsonSafe(row.pinned_keys_json, []);
    const pinnedPosts = parseJsonSafe(row.pinned_posts_json, []);

    const entry = {
      handle: (slotRow && slotRow.handle) || row.handle || '',
      source: (slotRow && slotRow.source) || row.source || 'twitter',
      displayName: row.display_name || '',
      userHandle: row.user_handle || '',
      sourceTitle: row.source_title || '',
      sourceSubtitle: row.source_subtitle || '',
      avatarUrl: row.avatar_url || '',
      isMuted: slotRow
        ? Boolean(slotRow.is_muted)
        : Boolean(row.is_muted),
      lastFetchedAt:
        (slotRow && slotRow.last_fetched_at != null ? slotRow.last_fetched_at : null) ??
        (row.last_fetched_at != null ? row.last_fetched_at : null),
      maxReadTimestamp: Number(row.max_read_timestamp) || 0,
      pinnedKeys: Array.isArray(pinnedKeys) ? pinnedKeys : [],
      pinnedPosts: Array.isArray(pinnedPosts) ? pinnedPosts : [],
      pinnedCollapsed: Boolean(row.pinned_collapsed)
    };

    if (includePosts) {
      const postRows = this._stmts.getPostsByTarget.all(targetKey);
      const posts = [];
      for (let i = 0; i < postRows.length; i++) {
        const pr = postRows[i];
        const parsed = parseJsonSafe(pr.data_json, null);
        if (parsed && typeof parsed === 'object') {
          parsed.isUnread = Boolean(pr.is_unread);
          posts.push(parsed);
        }
      }
      entry.posts = posts;

      const keyRows = this._stmts.getKeysByTarget.all(targetKey);
      const readKeys = [];
      const knownKeys = [];
      for (let i = 0; i < keyRows.length; i++) {
        const kr = keyRows[i];
        if (kr.is_read) readKeys.push(kr.post_key);
        if (kr.is_known) knownKeys.push(kr.post_key);
      }
      entry.readKeys = readKeys;
      entry.knownKeys = knownKeys;
    }

    return entry;
  }

  _saveTargetInTx(handleOrUrl, data, { replacePosts = true, allowEmptyPosts = false } = {}) {
    if (!data || typeof data !== 'object') return null;
    const rawTarget = String(handleOrUrl || data.handle || '').trim();
    if (!rawTarget) return null;

    const source = data.source || detectSourceType(rawTarget);
    const targetKey = getCanonicalTargetKey(rawTarget, source);
    if (!targetKey) return null;

    const incomingPosts = getEntryPosts(data);
    if (!allowEmptyPosts && (!Array.isArray(incomingPosts) || incomingPosts.length === 0)) {
      return null;
    }

    const now = Date.now();
    const prevRow = this._stmts.getTarget.get(targetKey) || null;
    const existingReadRows = this._stmts.getReadKeysByTarget.all(targetKey);
    const readSet = new Set();
    for (let i = 0; i < existingReadRows.length; i++) {
      readSet.add(existingReadRows[i].post_key);
    }

    let maxReadTs = Math.max(
      prevRow ? Number(prevRow.max_read_timestamp) || 0 : 0,
      typeof data.maxReadTimestamp === 'number' && !Number.isNaN(data.maxReadTimestamp)
        ? data.maxReadTimestamp
        : 0
    );

    if (Array.isArray(data.readKeys)) {
      for (let i = 0; i < data.readKeys.length; i++) {
        const k = data.readKeys[i];
        if (k) {
          readSet.add(k);
          this._stmts.upsertTargetKey.run({
            target_key: targetKey,
            post_key: String(k),
            is_read: 1,
            is_known: 1
          });
        }
      }
    }

    if (Array.isArray(data.knownKeys)) {
      for (let i = 0; i < data.knownKeys.length; i++) {
        const k = data.knownKeys[i];
        if (k) {
          this._stmts.upsertTargetKey.run({
            target_key: targetKey,
            post_key: String(k),
            is_read: readSet.has(k) ? 1 : 0,
            is_known: 1
          });
        }
      }
    }

    if (Array.isArray(incomingPosts)) {
      this._syncSeq += 1;
      const batchSeq = this._syncSeq;

      for (let i = 0; i < incomingPosts.length; i++) {
        const rawPost = incomingPosts[i];
        if (!rawPost || typeof rawPost !== 'object') continue;
        const cleanPost = sanitizeValueForStorage(rawPost);
        if (!cleanPost || typeof cleanPost !== 'object') continue;

        const postKey = getPostKey(cleanPost);
        if (!postKey) continue;

        if (readSet.has(postKey) && cleanPost.isUnread) {
          cleanPost.isUnread = false;
        }
        const isUnread = Boolean(cleanPost.isUnread);
        const postId = getPostId(cleanPost) || '';
        const timestamp = getPostTimestamp(cleanPost) || 0;
        const isPinned = Boolean(cleanPost.isPinned);
        const isMemberOnly = isMemberOnlyPost(cleanPost);

        if (!isUnread) {
          readSet.add(postKey);
          if (!isPinned && timestamp > maxReadTs) {
            maxReadTs = timestamp;
          }
        }

        this._stmts.upsertTargetKey.run({
          target_key: targetKey,
          post_key: postKey,
          is_read: isUnread ? 0 : 1,
          is_known: 1
        });

        this._stmts.upsertPost.run({
          target_key: targetKey,
          post_key: postKey,
          post_id: postId,
          timestamp,
          is_unread: isUnread ? 1 : 0,
          is_pinned: isPinned ? 1 : 0,
          is_member_only: isMemberOnly ? 1 : 0,
          data_json: JSON.stringify(cleanPost),
          sync_seq: batchSeq,
          updated_at: now
        });
      }

      if (replacePosts) {
        if (incomingPosts.length > 0) {
          this._stmts.deleteStalePostsForTarget.run(targetKey, batchSeq);
        } else {
          this._stmts.deleteAllPostsForTarget.run(targetKey);
        }
      }
    }

    const prevPinnedKeys = prevRow ? parseJsonSafe(prevRow.pinned_keys_json, []) : [];
    const prevPinnedPosts = prevRow ? parseJsonSafe(prevRow.pinned_posts_json, []) : [];
    const nextPinnedKeys = Array.isArray(data.pinnedKeys)
      ? data.pinnedKeys.filter(Boolean)
      : prevPinnedKeys;
    const nextPinnedPosts = Array.isArray(data.pinnedPosts)
      ? sanitizeValueForStorage(data.pinnedPosts).filter(Boolean)
      : prevPinnedPosts;
    const nextPinnedCollapsed =
      typeof data.pinnedCollapsed === 'boolean'
        ? data.pinnedCollapsed
        : Boolean(prevRow && prevRow.pinned_collapsed);

    const resolvedDisplayName =
      data.displayName !== undefined
        ? String(data.displayName || '')
        : (prevRow ? prevRow.display_name : '');
    const resolvedUserHandle =
      data.userHandle !== undefined
        ? String(data.userHandle || '')
        : (prevRow ? prevRow.user_handle : '');
    const resolvedSourceTitle =
      data.sourceTitle !== undefined
        ? String(data.sourceTitle || '')
        : (prevRow ? prevRow.source_title : '');
    const resolvedSourceSubtitle =
      data.sourceSubtitle !== undefined
        ? String(data.sourceSubtitle || '')
        : (prevRow ? prevRow.source_subtitle : '');
    const resolvedAvatarUrl =
      data.avatarUrl !== undefined && data.avatarUrl !== null
        ? String(data.avatarUrl || '')
        : (prevRow ? prevRow.avatar_url : '');
    const resolvedIsMuted =
      typeof data.isMuted === 'boolean'
        ? (data.isMuted ? 1 : 0)
        : (prevRow ? prevRow.is_muted : (DEFAULT_SLOT_MUTED ? 1 : 0));
    const resolvedLastFetchedAt =
      data.lastFetchedAt != null
        ? Number(data.lastFetchedAt)
        : (prevRow && prevRow.last_fetched_at != null ? prevRow.last_fetched_at : now);

    this._stmts.upsertTarget.run({
      target_key: targetKey,
      handle: String(data.handle || rawTarget),
      source: String(source || 'twitter'),
      display_name: resolvedDisplayName,
      user_handle: resolvedUserHandle,
      source_title: resolvedSourceTitle,
      source_subtitle: resolvedSourceSubtitle,
      avatar_url: resolvedAvatarUrl,
      is_muted: resolvedIsMuted,
      last_fetched_at: Number.isFinite(resolvedLastFetchedAt) ? resolvedLastFetchedAt : null,
      max_read_timestamp: maxReadTs,
      pinned_collapsed: nextPinnedCollapsed ? 1 : 0,
      pinned_keys_json: JSON.stringify(nextPinnedKeys),
      pinned_posts_json: JSON.stringify(nextPinnedPosts),
      updated_at: now
    });

    return {
      targetKey,
      handle: String(data.handle || rawTarget),
      source: String(source || 'twitter'),
      isMuted: Boolean(resolvedIsMuted),
      lastFetchedAt: Number.isFinite(resolvedLastFetchedAt) ? resolvedLastFetchedAt : null
    };
  }

  getTargetEntry(handleOrUrl, sourceHint, { includePosts = true } = {}) {
    const raw = String(handleOrUrl || '').trim();
    if (!raw) return null;
    const targetKey = getCanonicalTargetKey(raw, sourceHint);
    if (!targetKey) return null;
    const row = this._stmts.getTarget.get(targetKey);
    if (!row) return null;
    const hydrated = this._hydrateTargetRow(row, { includePosts });
    if (includePosts && (!Array.isArray(hydrated.posts) || hydrated.posts.length === 0)) {
      return null;
    }
    return hydrated;
  }

  getTargetCache({ includePosts = true } = {}) {
    const rows = this._stmts.getAllTargets.all();
    const result = {};
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const hydrated = this._hydrateTargetRow(row, { includePosts });
      if (hydrated) {
        result[row.target_key] = hydrated;
      }
    }
    return result;
  }

  saveTargetEntry(handleOrUrl, data, options = {}) {
    const tx = this.db.transaction(() =>
      this._saveTargetInTx(handleOrUrl, data, {
        replacePosts: options.replacePosts !== false,
        allowEmptyPosts: Boolean(options.allowEmptyPosts)
      })
    );
    return tx();
  }

  saveTargetCache(targetCache) {
    if (!targetCache || typeof targetCache !== 'object') return false;
    const tx = this.db.transaction(() => {
      for (const key of Object.keys(targetCache)) {
        const entry = targetCache[key];
        if (!entry || typeof entry !== 'object') continue;
        this._saveTargetInTx(entry.handle || key, entry, {
          replacePosts: true,
          allowEmptyPosts: false
        });
      }
    });
    tx();
    return true;
  }

  getSlotCache({ includePosts = true } = {}) {
    const slotRows = this._stmts.getAllSlots.all();
    const result = {};
    for (let i = 0; i < slotRows.length; i++) {
      const sr = slotRows[i];
      const targetRow = this._stmts.getTarget.get(sr.target_key);
      if (targetRow) {
        result[sr.slot_index] = this._hydrateTargetRow(targetRow, {
          includePosts,
          slotRow: sr
        });
      }
    }
    return result;
  }

  saveSlotEntry(slotIndex, data) {
    const idx = Number(slotIndex);
    if (!Number.isInteger(idx) || idx < 0) return false;

    const tx = this.db.transaction(() => {
      if (!data) {
        // Removing a slot binding NEVER deletes archived targets/posts
        this._stmts.deleteSlot.run(idx);
        return true;
      }
      const saved = this._saveTargetInTx(data.handle, data, {
        replacePosts: true,
        allowEmptyPosts: true
      });
      if (!saved) {
        this._stmts.deleteSlot.run(idx);
        return false;
      }
      this._stmts.upsertSlot.run({
        slot_index: idx,
        target_key: saved.targetKey,
        handle: saved.handle,
        source: saved.source,
        is_muted: saved.isMuted ? 1 : 0,
        last_fetched_at: saved.lastFetchedAt,
        updated_at: Date.now()
      });
      return true;
    });
    return tx();
  }

  saveAllSlotCache(cache) {
    if (!cache || typeof cache !== 'object') return false;
    const tx = this.db.transaction(() => {
      this._stmts.deleteAllSlots.run();
      for (const slotKey of Object.keys(cache)) {
        const idx = Number(slotKey);
        if (!Number.isInteger(idx) || idx < 0) continue;
        const entry = cache[slotKey];
        if (!entry || typeof entry !== 'object') continue;
        const saved = this._saveTargetInTx(entry.handle, entry, {
          replacePosts: true,
          allowEmptyPosts: true
        });
        if (!saved) continue;
        this._stmts.upsertSlot.run({
          slot_index: idx,
          target_key: saved.targetKey,
          handle: saved.handle,
          source: saved.source,
          is_muted: saved.isMuted ? 1 : 0,
          last_fetched_at: saved.lastFetchedAt,
          updated_at: Date.now()
        });
      }
    });
    tx();
    return true;
  }

  markTargetPostsRead(handleOrUrl, sourceHint, postKeys = [], maxReadTimestamp = 0) {
    const raw = String(handleOrUrl || '').trim();
    if (!raw) return false;
    const targetKey = getCanonicalTargetKey(raw, sourceHint);
    if (!targetKey) return false;

    const tx = this.db.transaction(() => {
      const target = this._stmts.getTarget.get(targetKey);
      if (!target) return false;

      const now = Date.now();
      let maxTs = Number(maxReadTimestamp) || 0;

      if (Array.isArray(postKeys)) {
        for (let i = 0; i < postKeys.length; i++) {
          const pk = String(postKeys[i] || '');
          if (!pk) continue;
          this._stmts.upsertTargetKey.run({
            target_key: targetKey,
            post_key: pk,
            is_read: 1,
            is_known: 1
          });
          const postRow = this._stmts.getPostByKey.get(targetKey, pk);
          if (postRow && postRow.is_unread) {
            const parsed = parseJsonSafe(postRow.data_json, null);
            if (parsed && typeof parsed === 'object') {
              parsed.isUnread = false;
              const ts = getPostTimestamp(parsed);
              if (!parsed.isPinned && ts > maxTs) maxTs = ts;
              this._stmts.updatePostRead.run(JSON.stringify(parsed), now, targetKey, pk);
            }
          }
        }
      }

      this._stmts.updateTargetMaxReadTs.run(maxTs, now, targetKey);
      return true;
    });

    return tx();
  }

  markAllTargetPostsRead(handleOrUrl, sourceHint, maxReadTimestamp = 0) {
    const raw = String(handleOrUrl || '').trim();
    if (!raw) return false;
    const targetKey = getCanonicalTargetKey(raw, sourceHint);
    if (!targetKey) return false;

    const tx = this.db.transaction(() => {
      const target = this._stmts.getTarget.get(targetKey);
      if (!target) return false;

      const now = Date.now();
      let maxTs = Number(maxReadTimestamp) || 0;
      const unreadRows = this._stmts.getUnreadPostsByTarget.all(targetKey);

      for (let i = 0; i < unreadRows.length; i++) {
        const row = unreadRows[i];
        const parsed = parseJsonSafe(row.data_json, null);
        if (parsed && typeof parsed === 'object') {
          parsed.isUnread = false;
          const ts = getPostTimestamp(parsed);
          if (!parsed.isPinned && ts > maxTs) maxTs = ts;
          this._stmts.updatePostRead.run(JSON.stringify(parsed), now, targetKey, row.post_key);
        }
        this._stmts.upsertTargetKey.run({
          target_key: targetKey,
          post_key: row.post_key,
          is_read: 1,
          is_known: 1
        });
      }

      this._stmts.updateTargetMaxReadTs.run(maxTs, now, targetKey);
      return true;
    });

    return tx();
  }

  hasCachedPostsForSource(source) {
    if (!source) return false;
    const row = this._stmts.hasPostsForSource.get(String(source));
    return Boolean(row && row.found);
  }

  migrateLegacyCaches({ slotCache = null, targetCache = null } = {}) {
    const tx = this.db.transaction(() => {
      let migratedTargets = 0;
      let migratedSlots = 0;

      if (targetCache && typeof targetCache === 'object') {
        for (const key of Object.keys(targetCache)) {
          const entry = targetCache[key];
          if (!entry || typeof entry !== 'object') continue;
          const saved = this._saveTargetInTx(entry.handle || key, entry, {
            replacePosts: false,
            allowEmptyPosts: false
          });
          if (saved) migratedTargets += 1;
        }
      }

      if (slotCache && typeof slotCache === 'object') {
        for (const slotKey of Object.keys(slotCache)) {
          const idx = Number(slotKey);
          if (!Number.isInteger(idx) || idx < 0) continue;
          const entry = slotCache[slotKey];
          if (!entry || typeof entry !== 'object') continue;
          const saved = this._saveTargetInTx(entry.handle, entry, {
            replacePosts: false,
            allowEmptyPosts: true
          });
          if (!saved) continue;
          this._stmts.upsertSlot.run({
            slot_index: idx,
            target_key: saved.targetKey,
            handle: saved.handle,
            source: saved.source,
            is_muted: saved.isMuted ? 1 : 0,
            last_fetched_at: saved.lastFetchedAt,
            updated_at: Date.now()
          });
          migratedSlots += 1;
        }
      }

      return { migratedTargets, migratedSlots };
    });

    return tx();
  }

  clearAll() {
    const tx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM slots;
        DELETE FROM posts;
        DELETE FROM target_keys;
        DELETE FROM targets;
      `);
    });
    tx();
    return true;
  }

  getStats() {
    return {
      dbPath: this.dbPath,
      targetCount: (this._stmts.countTargets.get() || {}).cnt || 0,
      slotCount: (this._stmts.countSlots.get() || {}).cnt || 0,
      postCount: (this._stmts.countPosts.get() || {}).cnt || 0
    };
  }

  close() {
    if (this.db && this.db.open) {
      this.db.close();
    }
  }
}

module.exports = {
  HistoryDatabase,
  sanitizeValueForStorage
};

