(function () {
  'use strict';
  const S = API.S, Bus = API.Bus;

  /* ================= LISTE DES DISCUSSIONS ================= */
  function renderChatList(root) {
    root.innerHTML =
      '<div class="top"><div class="mono accent">DISCUSSIONS</div><div class="streak" id="lStreak"></div></div>' +
      '<div id="lBody"></div>';
    paintStreak(root);
    Bus.on('streak', function () { paintStreak(root); });
    paint();

    function paintStreak(r) {
      const el = r.querySelector('#lStreak');
      if (!el) return;
      el.innerHTML = S.streak > 1 ? U.ic('flame', 15) + ' <span>' + S.streak + '</span>' : '';
    }

    function paint() {
      const body = root.querySelector('#lBody');
      if (!body) return;
      // dernière conversation avec chaque personne + groupe
      const convs = new Map(); // key -> {last, unread}
      const readMap = S.read;
      S.msgs.forEach(function (m) {
        const k = API.convKey(m);
        const prev = convs.get(k);
        if (!prev || m.id > prev.last.id) convs.set(k, { last: m, unread: prev ? prev.unread : 0 });
      });
      convs.forEach(function (c, k) {
        let n = 0;
        S.msgs.forEach(function (m) {
          if (API.convKey(m) === k && m.id > (readMap[k] || 0) && m.sender_id !== S.me.id) n++;
        });
        c.unread = n;
      });
      if (!convs.has('g')) convs.set('g', { last: null, unread: 0 });

      const online = S.online;
      const others = Array.from(S.users.values()).filter(function (u) { return u.id !== S.me.id && u.status === 'active'; });

      let html = '<div class="story-row">';
      others.forEach(function (u) {
        html += '<div class="story-item" data-open="' + u.id + '"><div class="story-ring' + (online.has(u.id) ? ' live' : '') + '"><div class="face" data-av="' + u.id + '" style="width:52px;height:52px;font-size:20px;border-color:' + u.color + '"></div></div><div class="story-name">' + U.esc(firstName(u.display_name)) + '</div></div>';
      });
      html += '</div><div class="conv-list">';

      const order = ['g'].concat(Array.from(convs.keys()).filter(function (k) { return k !== 'g'; })
        .sort(function (a, b) { return (convs.get(b).last ? convs.get(b).last.id : 0) - (convs.get(a).last ? convs.get(a).last.id : 0); }));

      order.forEach(function (k) {
        const c = convs.get(k);
        if (k === 'g') {
          html += convRow('g', 'Toute la famille', groupIcon(), c.last, c.unread, true);
        } else {
          const u = S.users.get(k);
          if (!u || u.status !== 'active') return;
          html += convRow(k, u.display_name, '<div class="face" data-av="' + k + '" style="width:44px;height:44px;border-color:' + u.color + '"></div>', c.last, c.unread, false);
        }
      });
      html += '</div>';
      if (others.length === 0) {
        html += '<div class="empty"><div class="empty-ic">' + U.ic('users', 30) + '</div><p>Personne d\u2019autre pour l\u2019instant.</p><p class="sub">Partage le code famille depuis l\u2019espace administrateur pour inviter les tiens.</p></div>';
      }
      body.innerHTML = html;
      body.querySelectorAll('[data-av]').forEach(function (el) {
        const u = S.users.get(el.dataset.av);
        if (u) Profile.renderAvatar(el, u, parseInt(el.style.width) || 40);
      });
      body.querySelectorAll('[data-open]').forEach(function (el) {
        el.addEventListener('click', function () { App.openConversation(el.dataset.open); });
      });

      function convRow(key, name, avatarHtml, last, unread, pinned) {
        const preview = last ? previewText(last) : 'Dites bonjour \u{1F44B}';
        return '<div class="conv-row' + (pinned ? ' pinned' : '') + '" data-open="' + key + '">' +
          avatarHtml +
          '<div class="conv-mid"><div class="conv-name">' + U.esc(name) + '</div><div class="conv-prev' + (unread ? ' un' : '') + '">' + preview + '</div></div>' +
          '<div class="conv-right">' + (last ? '<div class="conv-time">' + U.fmtT(last.created_at) + '</div>' : '') + (unread ? '<div class="conv-badge">' + unread + '</div>' : '') + '</div>' +
        '</div>';
      }
    }

    function groupIcon() {
      return '<div class="face group" style="width:52px;height:52px">' + U.ic('users', 22) + '</div>';
    }
    function firstName(n) { return (n || '').split(' ')[0]; }
    function previewText(m) {
      const who = m.sender_id === S.me.id ? 'Toi : ' : '';
      if (m.kind === 'image') return who + U.ic('image', 13) + ' Photo';
      if (m.kind === 'video') return who + U.ic('video', 13) + ' Vidéo';
      if (m.kind === 'audio') return who + U.ic('mic', 13) + ' Message vocal';
      if (m.kind === 'geolock') return who + U.ic('lock', 13) + ' Message verrouillé par lieu';
      if (m.kind === 'checkin') return who + U.ic('check', 13) + ' Bien arrivé';
      if (m.kind === 'sos') return who + U.ic('alert', 13) + ' Alerte SOS';
      return who + U.esc((m.body || '').slice(0, 60));
    }

    Bus.on('msg', paint); Bus.on('msg-upd', paint); Bus.on('msg-del', paint);
    Bus.on('online', paint); Bus.on('user', paint);
    root._chatListPaint = paint;
  }

  /* ================= CONVERSATION ================= */
  let cur = null, mediaRec = null, recChunks = [], recTimer = null, recStart = 0;

  function renderConversation(root, key) {
    cur = key;
    S.read[key] = Math.max(S.read[key] || 0, maxIdFor(key));
    localStorage.setItem('read', JSON.stringify(S.read));

    const isGroup = key === 'g';
    const other = isGroup ? null : S.users.get(key);
    const title = isGroup ? 'Toute la famille' : (other ? other.display_name : 'Membre');
    const sub = isGroup ? (S.online.size) + ' en ligne' : locSub(other);

    root.innerHTML =
      '<div class="conv-head">' +
        '<button class="ic-btn" id="cvBack">' + U.ic('back', 20) + '</button>' +
        (isGroup ? '<div class="face group" style="width:34px;height:34px">' + U.ic('users', 16) + '</div>' : '<div class="face" id="cvAv" style="width:34px;height:34px;border-color:' + (other ? other.color : '#333') + '"></div>') +
        '<div class="cv-title"><div>' + U.esc(title) + '</div><div class="sub" id="cvSub">' + sub + '</div></div>' +
        '<button class="ic-btn" id="cvCall">' + U.ic('video', 20) + '</button>' +
      '</div>' +
      '<div class="cv-body" id="cvBody"><div class="load-more" id="cvMore">Voir les messages précédents</div><div id="cvMsgs"></div></div>' +
      '<div class="cv-input">' +
        '<button class="ic-btn" id="cvPlus">' + U.ic('plus', 22) + '</button>' +
        '<div class="cv-field" id="cvField" contenteditable="true" data-ph="Message" role="textbox" aria-label="Message"></div>' +
        '<button class="ic-btn accent" id="cvMic">' + U.ic('mic', 20) + '</button>' +
        '<button class="ic-btn accent" id="cvSend" style="display:none">' + U.ic('send', 20) + '</button>' +
      '</div>' +
      '<input type="file" id="cvFile" accept="image/*,video/*" style="display:none">' +
      '<div class="attach-sheet" id="cvSheet"></div>';

    if (other) Profile.renderAvatar(root.querySelector('#cvAv'), other, 34);

    root.querySelector('#cvBack').addEventListener('click', function () { App.goTab('chat'); });
    root.querySelector('#cvCall').addEventListener('click', function () { Calls.startCall(isGroup ? null : key, isGroup); });

    const field = root.querySelector('#cvField');
    const sendBtn = root.querySelector('#cvSend'), micBtn = root.querySelector('#cvMic');
    field.addEventListener('input', function () {
      const has = field.textContent.trim().length > 0;
      sendBtn.style.display = has ? '' : 'none';
      micBtn.style.display = has ? 'none' : '';
    });
    field.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSendText(); }
    });
    sendBtn.addEventListener('click', doSendText);

    root.querySelector('#cvPlus').addEventListener('click', function () { toggleSheet(root, isGroup, other); });
    root.querySelector('#cvFile').addEventListener('change', function (e) {
      const f = e.target.files[0]; if (f) handleFile(root, f, isGroup ? null : key);
      e.target.value = '';
    });
    holdToRecord(root, micBtn, isGroup ? null : key);

    const more = root.querySelector('#cvMore');
    more.addEventListener('click', async function () {
      more.textContent = 'Chargement…';
      const n = await API.loadOlder(key);
      paintMsgs(root, key);
      more.textContent = n > 0 ? 'Voir les messages précédents' : 'Début de la conversation';
      if (n === 0) more.style.opacity = '0.4';
    });

    paintMsgs(root, key, true);
    if (other) refreshSub();

    const onMsg = function (d) { if (root.isConnected && API.convKey(d.m) === key) { paintMsgs(root, key); markRead(); } };
    const onUpd = function (m) { if (root.isConnected && API.convKey(m) === key) paintMsgs(root, key); };
    const onLoc = function (uid) { if (root.isConnected && uid === key) refreshSub(); };
    const onOnline = function () { if (root.isConnected && isGroup) { const s = root.querySelector('#cvSub'); if (s) s.textContent = S.online.size + ' en ligne'; } };
    Bus.on('msg', onMsg); Bus.on('msg-upd', onUpd); Bus.on('loc', onLoc); Bus.on('online', onOnline);

    function refreshSub() {
      const s = root.querySelector('#cvSub');
      if (s && other) s.textContent = locSub(S.users.get(key));
    }
    function markRead() {
      S.read[key] = maxIdFor(key);
      localStorage.setItem('read', JSON.stringify(S.read));
    }
    async function doSendText() {
      const txt = field.textContent.trim();
      if (!txt) return;
      field.textContent = ''; sendBtn.style.display = 'none'; micBtn.style.display = '';
      try { await API.send({ recipient_id: isGroup ? null : key, kind: 'text', body: txt }); }
      catch (e) { U.toast('Message non envoyé'); }
    }
  }

  function locSub(u) {
    if (!u) return '';
    const l = S.locs.get(u.id);
    if (!u.share_location || !l) return 'Position non partagée';
    return U.ago(l.updated_at) + (l.accuracy ? ' · ±' + Math.round(l.accuracy) + ' m' : '');
  }
  function maxIdFor(key) {
    let mx = 0;
    S.msgs.forEach(function (m) { if (API.convKey(m) === key && m.id > mx) mx = m.id; });
    return mx;
  }

  function paintMsgs(root, key) {
    const box = root.querySelector('#cvMsgs');
    if (!box) return;
    const list = Array.from(S.msgs.values()).filter(function (m) { return API.convKey(m) === key; }).sort(function (a, b) { return a.id - b.id; });
    const atBottom = box._lastLen === undefined || (box.parentElement.scrollTop + box.parentElement.clientHeight > box.parentElement.scrollHeight - 120);
    box.innerHTML = list.map(bubble).join('');
    box._lastLen = list.length;
    box.querySelectorAll('[data-media]').forEach(mountMedia);
    box.querySelectorAll('[data-consume]').forEach(function (el) {
      el.addEventListener('click', async function () {
        const id = parseInt(el.dataset.consume, 10);
        const p = await API.consume(id);
        if (p) openLightbox(p, S.msgs.get(id) ? S.msgs.get(id).kind : 'image', true);
        else U.toast('Cette photo a déjà été vue');
      });
    });
    box.querySelectorAll('[data-lock]').forEach(function (el) {
      el.addEventListener('click', function () { U.toast('Se dévoile quand la personne arrive à l\u2019endroit prévu'); });
    });
    if (atBottom) box.parentElement.scrollTop = box.parentElement.scrollHeight;

    function bubble(m) {
      const mine = m.sender_id === S.me.id;
      const u = S.users.get(m.sender_id);
      const name = !mine && key === 'g' && u ? '<div class="b-name" style="color:' + u.color + '">' + U.esc(u.display_name) + '</div>' : '';
      let body = '';
      if (m.kind === 'text') body = '<div class="bubble ' + (mine ? 'out' : 'in') + '">' + name + linkify(U.esc(m.body)) + '</div>';
      else if (m.kind === 'image' || m.kind === 'video') {
        if (m.ephemeral && !mine) {
          body = m.viewed_at
            ? '<div class="bubble ' + (mine ? 'out' : 'in') + ' ghost">' + name + U.ic('image', 16) + ' Photo déjà vue</div>'
            : '<div class="bubble ' + (mine ? 'out' : 'in') + ' eph" data-consume="' + m.id + '">' + name + U.ic('clock', 18) + '<span>Photo éphémère \u2014 toucher pour voir</span></div>';
        } else {
          body = '<div class="bubble media-bubble ' + (mine ? 'out' : 'in') + '">' + name + '<div class="media-box" data-media="' + m.id + '" data-kind="' + m.kind + '" data-path="' + U.esc(m.media_path || '') + '"><div class="media-load">' + U.ic(m.kind === 'video' ? 'play' : 'image', 22) + '</div></div>' + (m.ephemeral ? '<div class="eph-tag">' + U.ic('clock', 11) + ' Éphémère</div>' : '') + '</div>';
        }
      } else if (m.kind === 'audio') {
        body = '<div class="bubble media-bubble ' + (mine ? 'out' : 'in') + '">' + name + '<div class="media-box audio" data-media="' + m.id + '" data-kind="audio" data-path="' + U.esc(m.media_path || '') + '"><div class="media-load">' + U.ic('mic', 20) + '</div></div></div>';
      } else if (m.kind === 'geolock') {
        const unlocked = m.viewed_at != null;
        body = '<div class="bubble ' + (mine ? 'out' : 'in') + ' ' + (unlocked ? '' : 'lockmsg') + '" ' + (unlocked ? '' : 'data-lock="1"') + '>' + name +
          (unlocked ? U.ic('unlock', 16) + ' ' + linkify(U.esc(m.body)) : U.ic('lock', 16) + ' <span>Message verrouillé \u2014 se dévoile en arrivant</span>') + '</div>';
      } else if (m.kind === 'checkin') {
        body = '<div class="bubble sys checkin">' + name + U.ic('check', 16) + ' ' + U.esc(u ? u.display_name : '') + ' est bien arrivé' + (m.body ? ' · ' + U.esc(m.body) : '') + '</div>';
      } else if (m.kind === 'sos') {
        body = '<div class="bubble sys sos">' + U.ic('alert', 16) + ' Alerte SOS de ' + U.esc(u ? u.display_name : '') + (m.body ? ' · ' + U.esc(m.body) : '') + '</div>';
      }
      return '<div class="brow ' + (mine ? 'mine' : '') + '"><div class="btime">' + U.fmtT(m.created_at) + '</div>' + body + '</div>';
    }
  }

  function linkify(s) { return s.replace(/\n/g, '<br>'); }

  async function mountMedia(el) {
    if (el._mounted) return; el._mounted = true;
    const path = el.dataset.path, kind = el.dataset.kind;
    if (!path) { el.innerHTML = '<div class="media-load">' + U.ic('x', 20) + '</div>'; return; }
    const url = await API.mediaUrl(path);
    if (!url) return;
    if (kind === 'image') {
      el.innerHTML = '<img src="' + url + '" loading="lazy" alt="Photo partagée">';
      el.addEventListener('click', function () { openLightbox(url, 'image'); });
    } else if (kind === 'video') {
      el.innerHTML = '<video src="' + url + '" preload="metadata" playsinline></video><div class="play-ov">' + U.ic('play', 26) + '</div>';
      el.addEventListener('click', function () { openLightbox(url, 'video'); });
    } else if (kind === 'audio') {
      el.innerHTML = '<audio controls src="' + url + '" style="width:190px;height:34px"></audio>';
    }
  }

  function openLightbox(src, kind, ephemeral) {
    const back = document.getElementById('modalBack'), root = document.getElementById('modalRoot');
    root.innerHTML = '<div class="lightbox">' + (kind === 'video'
      ? '<video src="' + src + '" controls autoplay playsinline></video>'
      : '<img src="' + src + '" alt="Photo">') + '<button class="ic-btn lb-close" id="lbClose">' + U.ic('x', 22) + '</button></div>';
    back.classList.add('on');
    root.querySelector('#lbClose').addEventListener('click', function () {
      back.classList.remove('on'); root.innerHTML = '';
      if (ephemeral) { if (root._chatListPaint) root._chatListPaint(); }
    });
    if (ephemeral) setTimeout(function () { root.querySelector('#lbClose').click(); }, 10000);
  }

  /* ---------- Pièces jointes : galerie, éphémère, verrouillé par lieu ---------- */
  function toggleSheet(root, isGroup, other) {
    const sheet = root.querySelector('#cvSheet');
    if (sheet.classList.contains('on')) { sheet.classList.remove('on'); return; }
    sheet.innerHTML =
      opt('image', 'Photo ou vidéo', 'gallery') +
      opt('clock', 'Photo éphémère', 'eph') +
      (!isGroup ? opt('lock', 'Message verrouillé par lieu', 'geo') : '');
    sheet.classList.add('on');
    sheet.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        sheet.classList.remove('on');
        const act = b.dataset.act;
        if (act === 'gallery') { root._eph = false; root.querySelector('#cvFile').click(); }
        else if (act === 'eph') { root._eph = true; root.querySelector('#cvFile').click(); }
        else if (act === 'geo') geoLockFlow(root, other);
      });
    });
    function opt(icon, label, act) {
      return '<div class="sheet-item" data-act="' + act + '">' + U.ic(icon, 20) + '<span>' + label + '</span></div>';
    }
  }

  async function handleFile(root, file, recipient) {
    const isVideo = file.type.indexOf('video') === 0;
    if (isVideo && file.size > CONFIG.MAX_VIDEO_MB * 1024 * 1024) {
      U.toast('Vidéo trop lourde (max ' + CONFIG.MAX_VIDEO_MB + ' Mo). Filme un extrait plus court.');
      return;
    }
    U.toast(isVideo ? 'Envoi de la vidéo…' : 'Envoi de la photo…');
    try {
      let blob = file, ext = isVideo ? (file.name.split('.').pop() || 'mp4') : 'webp';
      if (!isVideo) blob = await U.compressImage(file, { max: 1280, q: 0.82 });
      const path = await API.upload(blob, ext, S.me.id + '/chat');
      await API.send({ recipient_id: recipient, kind: isVideo ? 'video' : 'image', media_path: path, ephemeral: !!root._eph && !isVideo });
      root._eph = false;
    } catch (e) { U.toast('Échec de l\u2019envoi'); }
  }

  function geoLockFlow(root, other) {
    const back = document.getElementById('modalBack'), mr = document.getElementById('modalRoot');
    mr.innerHTML =
      '<div class="auth-wrap"><div class="auth-head"><div class="brand-mark">' + U.ic('lock', 24) + '</div><h1>Message verrouillé</h1><p class="sub">Il se dévoilera pour ' + U.esc(other ? other.display_name : '') + ' seulement à son arrivée sur ta position actuelle.</p></div>' +
      '<div class="field" style="align-items:flex-start"><textarea id="glText" placeholder="Ton message…" rows="3" style="background:transparent;border:none;color:inherit;width:100%;resize:none;font:inherit"></textarea></div>' +
      '<div class="field"><span class="fic">' + U.ic('target', 18) + '</span><input id="glRadius" type="number" value="150" min="30" step="10"><span class="sub" style="padding-right:10px">mètres</span></div>' +
      '<div class="err" id="glErr"></div>' +
      '<button class="btn-primary" id="glGo">Verrouiller et envoyer</button></div>';
    back.classList.add('on');
    mr.querySelector('#glGo').addEventListener('click', async function () {
      const txt = mr.querySelector('#glText').value.trim();
      const radius = parseInt(mr.querySelector('#glRadius').value, 10) || 150;
      if (!txt) { mr.querySelector('#glErr').textContent = 'Écris un message.'; return; }
      const pos = await API.getPos(15000);
      if (!pos) { mr.querySelector('#glErr').textContent = 'Position indisponible.'; return; }
      try {
        await API.send({ recipient_id: other.id, kind: 'geolock', body: txt, lat: pos.lat, lng: pos.lng, radius: radius });
        back.classList.remove('on'); mr.innerHTML = '';
      } catch (e) { mr.querySelector('#glErr').textContent = 'Échec de l\u2019envoi.'; }
    });
  }

  /* ---------- Vocal : appui long pour enregistrer ---------- */
  function holdToRecord(root, btn, recipient) {
    let recording = false;
    async function start() {
      if (recording) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recChunks = [];
        mediaRec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '' });
        mediaRec.ondataavailable = function (e) { if (e.data.size) recChunks.push(e.data); };
        mediaRec.onstop = function () { stream.getTracks().forEach(function (t) { t.stop(); }); };
        mediaRec.start();
        recording = true; recStart = Date.now();
        btn.classList.add('rec-on');
        U.toast('Enregistrement… relâche pour envoyer');
      } catch (e) { U.toast('Micro indisponible'); }
    }
    async function stop(send) {
      if (!recording || !mediaRec) return;
      recording = false; btn.classList.remove('rec-on');
      const dur = Date.now() - recStart;
      await new Promise(function (res) { mediaRec.onstop = res; mediaRec.stop(); });
      if (!send || dur < 700) return;
      const blob = new Blob(recChunks, { type: 'audio/webm' });
      try {
        const path = await API.upload(blob, 'webm', S.me.id + '/chat');
        await API.send({ recipient_id: recipient, kind: 'audio', media_path: path });
      } catch (e) { U.toast('Échec de l\u2019envoi du vocal'); }
    }
    btn.addEventListener('mousedown', start);
    btn.addEventListener('touchstart', function (e) { e.preventDefault(); start(); }, { passive: false });
    ['mouseup', 'mouseleave'].forEach(function (ev) { btn.addEventListener(ev, function () { stop(true); }); });
    btn.addEventListener('touchend', function () { stop(true); });
    btn.addEventListener('touchcancel', function () { stop(false); });
  }

  window.Chat = { renderChatList: renderChatList, renderConversation: renderConversation, openLightbox: openLightbox };
})();
