// ============================================================
// PREDIKT AI — predikt-cache.js  (Frontend, v2)
//
// DROP THIS INTO index.html BEFORE the closing </body> tag,
// but BEFORE the <script> block that defines APPS_SCRIPT.
//
// Then make the 4 surgical changes listed at the bottom.
// ============================================================

(function () {

  // ── CONFIG — set these two values ──────────────────────────
  // Your GitHub Pages URL where /cache/*.json files live:
  var CDN_BASE = 'https://YOUR_GITHUB_USERNAME.github.io/predikt-cache/cache';
  // ───────────────────────────────────────────────────────────

  // TTL per file (minutes) — should match _ttlMinutes in .gs
  var TTL = {
    predictions_public: 30,
    predictions_full:   30,
    results:            30,
    match_stats:        60,
    win_rates:          60,
    vip_picks:          30,
    vip_results:        30
  };

  // ── IN-MEMORY STORE ────────────────────────────────────────
  var _mem = {};

  // ── HELPERS ────────────────────────────────────────────────
  function _lsKey(key) { return 'predikt_cdncache_' + key; }

  function _age(iso) {
    return (Date.now() - new Date(iso).getTime()) / 60000;
  }

  function _stale(key, exportedAt) {
    var ttl = (exportedAt && window._cdnMeta && window._cdnMeta[key]) || TTL[key] || 30;
    return _age(exportedAt) > ttl;
  }

  function _saveLS(key, data) {
    try {
      localStorage.setItem(_lsKey(key), JSON.stringify({ data: data, savedAt: new Date().toISOString() }));
    } catch (e) {
      // Storage full — clear oldest predikt entry and retry
      try {
        var oldest = Object.keys(localStorage).filter(function(k) { return k.startsWith('predikt_cdncache_'); })[0];
        if (oldest) localStorage.removeItem(oldest);
        localStorage.setItem(_lsKey(key), JSON.stringify({ data: data, savedAt: new Date().toISOString() }));
      } catch (_) {}
    }
  }

  function _loadLS(key) {
    try {
      var raw = localStorage.getItem(_lsKey(key));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // ── FETCH FROM CDN ─────────────────────────────────────────
  async function _fetchCDN(key) {
    var res = await fetch(CDN_BASE + '/' + key + '.json?_=' + Date.now());
    if (!res.ok) throw new Error('CDN ' + key + ' HTTP ' + res.status);
    return await res.json();
  }

  // ── PUBLIC: get(key, force?) ───────────────────────────────
  // Returns cached data. Priority: memory → localStorage → CDN → throw.
  async function get(key, force) {
    var ttl = TTL[key] || 30;

    // 1. Memory (instant)
    if (!force && _mem[key] && !_stale(key, _mem[key].exportedAt)) {
      return _mem[key];
    }

    // 2. localStorage
    if (!force) {
      var stored = _loadLS(key);
      if (stored && stored.data && !_stale(key, stored.data.exportedAt || stored.savedAt)) {
        _mem[key] = stored.data;
        return stored.data;
      }
    }

    // 3. CDN
    var data = await _fetchCDN(key);
    _mem[key] = data;
    _saveLS(key, data);
    return data;
  }

  // ── PUBLIC: prefetch(keys) ─────────────────────────────────
  async function prefetch(keys) {
    await Promise.allSettled(keys.map(function(k) { return get(k); }));
  }

  // ── PUBLIC: invalidate(key?) ───────────────────────────────
  function invalidate(key) {
    if (key) {
      delete _mem[key];
      localStorage.removeItem(_lsKey(key));
    } else {
      Object.keys(_mem).forEach(function(k) { delete _mem[k]; });
      Object.keys(localStorage)
        .filter(function(k) { return k.startsWith('predikt_cdncache_'); })
        .forEach(function(k) { localStorage.removeItem(k); });
    }
  }

  // ── PUBLIC: status() ───────────────────────────────────────
  function status() {
    return Object.keys(TTL).map(function(key) {
      var stored = _loadLS(key);
      var mem    = _mem[key];
      return {
        key:        key,
        inMemory:   !!(mem && !_stale(key, mem.exportedAt)),
        inStorage:  !!(stored && stored.data && !_stale(key, stored.data.exportedAt || stored.savedAt)),
        age:        stored ? _age(stored.data && stored.data.exportedAt ? stored.data.exportedAt : stored.savedAt).toFixed(1) + 'm' : 'none',
        ttl:        TTL[key] + 'm'
      };
    });
  }

  window.PrediktCDN = { get: get, prefetch: prefetch, invalidate: invalidate, status: status };

})();


// ============================================================
// MATCH STATS IN-PAGE CACHE
// Patches loadMatchStats() so the same match is never fetched twice.
// Also caches across page reloads via localStorage (60 min TTL).
// ============================================================

(function () {

  var STATS_TTL = 60; // minutes

  function _lsKey(match) { return 'predikt_stats_' + match.replace(/[^a-z0-9]/gi, '_'); }

  function _loadLS(match) {
    try {
      var raw = localStorage.getItem(_lsKey(match));
      if (!raw) return null;
      var stored = JSON.parse(raw);
      var ageMin = (Date.now() - new Date(stored.savedAt).getTime()) / 60000;
      return ageMin < STATS_TTL ? stored.data : null;
    } catch (e) { return null; }
  }

  function _saveLS(match, data) {
    try {
      localStorage.setItem(_lsKey(match), JSON.stringify({ data: data, savedAt: new Date().toISOString() }));
    } catch (e) {}
  }

  // Patch loadMatchStats once it's defined
  document.addEventListener('DOMContentLoaded', function () {
    var _orig = window.loadMatchStats;
    if (typeof _orig !== 'function') return;

    window.loadMatchStats = async function (matchName) {
      // Check in-page cache first (already exists as _statsCache)
      if (window._statsCache && window._statsCache[matchName]) {
        return _orig.call(this, matchName);  // original func reads _statsCache
      }

      // Check localStorage
      var stored = _loadLS(matchName);
      if (stored) {
        window._statsCache = window._statsCache || {};
        window._statsCache[matchName] = stored;
        // Now call original — it will hit the _statsCache branch
        return _orig.call(this, matchName);
      }

      // Not cached — run original (it will fetch from API and populate _statsCache)
      await _orig.call(this, matchName);

      // Save whatever the original stored into localStorage
      if (window._statsCache && window._statsCache[matchName]) {
        _saveLS(matchName, window._statsCache[matchName]);
      }
    };
  });

})();


// ============================================================
// BACKGROUND STATS CACHE
// Patches _bgFetchResultStats so stats are served from the CDN
// match_stats.json batch file instead of one API call per match.
// ============================================================

(function () {

  document.addEventListener('DOMContentLoaded', function () {
    // Wait for PrediktCDN and _bgFetchResultStats to be defined
    var _origBg = window._bgFetchResultStats;
    if (typeof _origBg !== 'function') return;

    window._bgFetchResultStats = async function (cardId, matchName, isPP) {
      if (!matchName) return;

      // Already in-page cached — use original logic (it checks window._bgStatsFetched)
      if (window._bgStatsFetched && window._bgStatsFetched[matchName]) {
        return _origBg(cardId, matchName, isPP);
      }

      // Try batch CDN file first
      try {
        var cdnData = await PrediktCDN.get('match_stats');
        if (cdnData && cdnData.stats && cdnData.stats[matchName]) {
          // Inject into the in-page cache so _injectCardStats can use it
          window._bgStatsFetched = window._bgStatsFetched || {};
          var stats = window._extractBgStats(cdnData.stats[matchName]);
          window._bgStatsFetched[matchName] = stats;
          window._injectCardStats(cardId, stats, isPP);
          return;
        }
      } catch (e) {
        // CDN miss — fall through to original API call
      }

      // Fall back to individual API call
      _origBg(cardId, matchName, isPP);
    };
  });

})();


// ============================================================
// 4 SURGICAL CHANGES TO index.html
// ─────────────────────────────────────────────────────────────
// Make ONLY these 4 changes. Do NOT rewrite anything else.
// ============================================================

// ── CHANGE 1: loadResults() ──────────────────────────────────
// FIND this line (around line 4583):
//   var res = await fetch(APPS_SCRIPT + '?action=getResults', { cache:'no-store' });
//   var raw = await res.json();
//
// REPLACE WITH:
//   var raw;
//   try {
//     var cdnData = await PrediktCDN.get('results');
//     raw = cdnData.results || cdnData;
//   } catch (e) {
//     var res = await fetch(APPS_SCRIPT + '?action=getResults', { cache:'no-store' });
//     raw = await res.json();
//   }
//
// Then remove the `.json()` call below it (raw is already parsed).


// ── CHANGE 2: loadTodayPredictions() ─────────────────────────
// FIND this block (around line 5169):
//   var url = APPS_SCRIPT + '?action=getPicks' + (email ? '&email=...' : '');
//   var res  = await fetch(url, { cache: 'no-store' });
//   var data = await res.json();
//
// REPLACE WITH:
//   var data;
//   try {
//     if (email) {
//       // Active member — try full CDN picks first, then API fallback
//       var cdnFull = await PrediktCDN.get('predictions_full');
//       data = { access: 'full', matches: cdnFull.picks || [], total: cdnFull.total || 0 };
//     } else {
//       // Visitor — CDN public preview
//       var cdnPub = await PrediktCDN.get('predictions_public');
//       data = { access: 'limited', matches: cdnPub.picks || [], total: cdnPub.total || 0 };
//     }
//   } catch (e) {
//     // Full API fallback
//     var url  = APPS_SCRIPT + '?action=getPicks' + (email ? '&email=' + encodeURIComponent(email) : '');
//     var res  = await fetch(url, { cache: 'no-store' });
//     data = await res.json();
//   }
//
// ⚠️  IMPORTANT: predictions_full.json is safe only because it holds
//     today's picks which are the same for all members. It does NOT
//     expose email or membership data. The CLIENTS check still happens
//     server-side on login/getPicks fallback.


// ── CHANGE 3: loadWinRates() ─────────────────────────────────
// FIND (around line 5699):
//   var res = await fetch(APPS_SCRIPT + '?action=getWinRates');
//   var data = await res.json();
//
// REPLACE WITH:
//   var data;
//   try {
//     data = await PrediktCDN.get('win_rates');
//   } catch (e) {
//     var res = await fetch(APPS_SCRIPT + '?action=getWinRates');
//     data = await res.json();
//   }


// ── CHANGE 4: loadProPicksResultsData() ──────────────────────
// FIND (around line 4384):
//   var url = APPS_SCRIPT + '?action=getProPicksResultsCached&range=30...'
//   var res  = await fetch(url);
//   var raw  = await res.json();
//
// REPLACE WITH:
//   var raw;
//   try {
//     raw = await PrediktCDN.get('vip_results');
//   } catch (e) {
//     var url = APPS_SCRIPT + '?action=getProPicksResultsCached&range=30'
//               + (email ? '&email=' + encodeURIComponent(email) : '');
//     var res  = await fetch(url);
//     raw = await res.json();
//   }
//   // raw.data is already an array in the CDN shape — the existing
//   // var rows = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.data) ? raw.data : []);
//   // line below handles both shapes correctly — no further change needed.


// ============================================================
// BOOT — warm priority caches on page load
// ============================================================

(function () {
  document.addEventListener('DOMContentLoaded', function () {
    // Prefetch the 3 heaviest pages in parallel immediately
    PrediktCDN.prefetch(['results', 'win_rates', 'predictions_public']);

    // VIP results after 2s (lower priority)
    setTimeout(function () {
      PrediktCDN.prefetch(['vip_results', 'vip_picks']);
    }, 2000);

    // Match stats batch after 3s (background, large file)
    setTimeout(function () {
      PrediktCDN.prefetch(['match_stats']);
    }, 3000);
  });
})();
