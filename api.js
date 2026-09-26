(function () {
  'use strict';

  /* ---------- Petit système d'événements ---------- */
  const Bus = {
    h: {},
    on: function (e, f) { (this.h[e] = this.h[e] || []).push(f); },
    emit: function (e, d) {
      (this.h[e] || []).forEach(function (f) { try { f(d); } catch (err) { console.error(e, err); } });
    }
  };

  const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } }
  });

  /* ---------- État global de l'application ---------- */
  const S = {
    me: null,
    users: new Map(),   // id -> profil
    locs: new Map(),    // user_id -> dernière position
    msgs: new Map(),    // id -> message
    online: new Set(),  // membres connectés (présence)
    streak: 0,
    myPos: null,
    battery: null,
    read: JSON.parse(localStorage.getItem('read') || '{}')
  };

  const convKey = function (m) {
    return !m.recipient_id ? 'g' : (m.sender_id === S.me.id ? m.recipient_id : m.sender_id);
  };

  /* ---------- Chargement initial ---------- */
  async function loadAll() {
    const r = await Promise.all([
      sb.from('profiles').select('*'),
      sb.from('messages').select('*').order('id', { ascending: false }).limit(300),
      sb.from('locations').select('*')
    ]);
    if (r[0].error) throw r[0].error;
    S.users = new Map(r[0].data.map(function (u) { return [u.id, u]; }));
    S.me = S.users.get(S.me.id) || S.me;
    S.msgs = new Map();
    (r[1].data || []).forEach(function (m) { S.msgs.set(m.id, m); });
    S.locs = new Map((r[2].data || []).map(function (l) { return [l.user_id, l]; }));
    refreshStreak();
  }

  async function refreshStreak() {
    const r = await sb.rpc('family_streak');
    S.streak = r.data || 0;
    Bus.emit('streak');
  }

  /* ---------- Historique plus ancien ---------- */
  async function loadOlder(key) {
    let ids = [];
    S.msgs.forEach(function (m) { if (convKey(m) === key) ids.push(m.id); });
    const minId = ids.length ? Math.min.apply(null, ids) : Number.MAX_SAFE_INTEGER;
    let q = sb.from('messages').select('*').lt('id', minId).order('id', { ascending: false }).limit(40);
    if (key === 'g') q = q.is('recipient_id', null);
    else q = q.or('and(sender_id.eq.' + key + ',recipient_id.eq.' + S.me.id + '),and(sender_id.eq.' + S.me.id + ',recipient_id.eq.' + key + ')');
    const r = await q;
    if (r.error) throw r.error;
    (r.data || []).forEach(function (m) { S.msgs.set(m.id, m); });
    return (r.data || []).length;
  }

  /* ---------- Médias (URLs signées, mises en cache) ---------- */
  const urls = new Map();
  async function mediaUrl(path, ttl) {
    ttl = ttl || 43200;
    const c = urls.get(path);
    if (c && c.exp > Date.now()) return c.url;
    const r = await sb.storage.from('media').createSignedUrl(path, ttl);
    if (r.error || !r.data) return null;
    urls.set(path, { url: r.data.signedUrl, exp: Date.now() + (ttl - 3600) * 1000 });
    return r.data.signedUrl;
  }
  async function upload(blob, ext, folder) {
    const path = (folder || S.me.id) + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const r = await sb.storage.from('media').upload(path, blob, {
      contentType: (blob.type || 'application/octet-stream').split(';')[0],
      cacheControl: '31536000'
    });
    if (r.error) throw r.error;
    return path;
  }

  /* ---------- Envoi d'un message ---------- */
  async function send(fields) {
    const row = Object.assign({ sender_id: S.me.id }, fields);
    const r = await sb.from('messages').insert(row).select().single();
    if (r.error) throw r.error;
    if (!S.msgs.has(r.data.id)) {
      S.msgs.set(r.data.id, r.data);
      Bus.emit('msg', { m: r.data, mine: true });
    }
    if (!row.recipient_id && ['text', 'image', 'video', 'audio'].indexOf(row.kind) >= 0) {
      setTimeout(refreshStreak, 1200);
    }
    return r.data;
  }

  async function consume(id) {
    const r = await sb.rpc('consume_message', { mid: id });
    return r.data || null;
  }

  /* ---------- Temps réel ---------- */
  let dbCh = null, prCh = null;
  function subscribe() {
    if (dbCh) return;
    dbCh = sb.channel('db')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, onMsg)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onProf)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, onLoc)
      .subscribe();

    prCh = sb.channel('presence:family', { config: { presence: { key: S.me.id } } });
    prCh.on('presence', { event: 'sync' }, function () {
      S.online = new Set(Object.keys(prCh.presenceState()));
      Bus.emit('online');
    }).subscribe(function (st) {
      if (st === 'SUBSCRIBED') prCh.track({ at: Date.now() });
    });
  }
  function unsubscribe() {
    if (dbCh) { sb.removeChannel(dbCh); dbCh = null; }
    if (prCh) { sb.removeChannel(prCh); prCh = null; }
  }

  function onMsg(p) {
    if (p.eventType === 'INSERT') {
      const m = p.new;
      if (S.msgs.has(m.id)) return;
      S.msgs.set(m.id, m);
      Bus.emit('msg', { m: m, mine: m.sender_id === S.me.id });
    } else if (p.eventType === 'UPDATE') {
      S.msgs.set(p.new.id, p.new);
      Bus.emit('msg-upd', p.new);
    } else if (p.eventType === 'DELETE') {
      S.msgs.delete(p.old.id);
      Bus.emit('msg-del', p.old.id);
    }
  }
  function onProf(p) {
    if (p.eventType === 'DELETE') { S.users.delete(p.old.id); Bus.emit('user', p.old.id); return; }
    const u = p.new;
    S.users.set(u.id, u);
    if (!u.share_location) S.locs.delete(u.id);
    if (u.id === S.me.id) { S.me = u; Bus.emit('me', u); }
    Bus.emit('user', u.id);
  }
  function onLoc(p) {
    if (p.eventType === 'DELETE') S.locs.delete(p.old.user_id);
    else S.locs.set(p.new.user_id, p.new);
    Bus.emit('loc', p.eventType === 'DELETE' ? p.old.user_id : p.new.user_id);
  }

  /* ---------- Position GPS ---------- */
  let watchId = null, lastSent = 0, lastPos = null;
  function startWatch() {
    if (watchId != null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(onPos, function (e) { Bus.emit('geo-err', e); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  function stopWatch() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  }
  async function onPos(p) {
    const c = p.coords;
    S.myPos = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, speed: c.speed, heading: c.heading, ts: p.timestamp };
    Bus.emit('mypos');
    if (!S.me || !S.me.share_location) return;
    const now = Date.now();
    const moved = lastPos ? U.dist(lastPos, S.myPos) : 999;
    // On n'envoie que si on a bougé (12 m, max toutes les 6 s) ou toutes les 90 s : économise batterie et quota
    if (!((moved >= 12 && now - lastSent >= 6000) || now - lastSent >= 90000)) return;
    lastSent = now;
    lastPos = { lat: S.myPos.lat, lng: S.myPos.lng };
    await reportPosition(c.latitude, c.longitude, c.accuracy, c.speed, c.heading);
  }

  // Réutilisée par js/native.js dans la version Capacitor (suivi en arrière-plan sur Android).
  async function reportPosition(lat, lng, accuracy, speed, heading) {
    if (!S.me || !S.me.share_location) return;
    const b = S.battery;
    await sb.from('locations').upsert({
      user_id: S.me.id, lat: lat, lng: lng, accuracy: accuracy,
      speed: speed, heading: heading, battery: b ? b.level : null, charging: b ? b.charging : null,
      updated_at: new Date().toISOString()
    });
  }
  function getPos(maxAge) {
    maxAge = maxAge || 60000;
    return new Promise(function (res) {
      if (S.myPos && Date.now() - S.myPos.ts < maxAge) return res(S.myPos);
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(function (p) {
        S.myPos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading, ts: p.timestamp };
        res(S.myPos);
      }, function () { res(null); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 });
    });
  }
  async function setShare(on) {
    lastSent = 0; lastPos = null;
    const r = await sb.from('profiles').update({ share_location: on }).eq('id', S.me.id).select().single();
    if (r.error) throw r.error;
    S.me = r.data; S.users.set(S.me.id, S.me);
    if (!on) { await sb.from('locations').delete().eq('user_id', S.me.id); S.locs.delete(S.me.id); }
    Bus.emit('me', S.me);
  }

  if (navigator.getBattery) {
    navigator.getBattery().then(function (b) { S.battery = b; }).catch(function () {});
  }

  window.API = {
    sb: sb, S: S, Bus: Bus, convKey: convKey, loadAll: loadAll, loadOlder: loadOlder,
    refreshStreak: refreshStreak, mediaUrl: mediaUrl, upload: upload, send: send, consume: consume,
    subscribe: subscribe, unsubscribe: unsubscribe, startWatch: startWatch, stopWatch: stopWatch,
    getPos: getPos, setShare: setShare, reportPosition: reportPosition
  };
})();
