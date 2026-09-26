(function () {
  'use strict';
  const sb = API.sb, S = API.S;

  /* ---------- Selfie de visage (caméra avant uniquement, pas de galerie) ---------- */
  function faceCaptureScreen(root, opts) {
    opts = opts || {};
    let stream = null;
    root.innerHTML =
      '<div class="auth-wrap">' +
        '<div class="auth-head"><div class="brand-mark">' + U.ic('user', 26) + '</div>' +
          '<h1>Ton visage</h1><p class="sub">Cadre uniquement ton visage. La galerie est désactivée pour cette photo.</p></div>' +
        '<div class="face-wrap"><video id="fVideo" autoplay playsinline muted></video><div class="face-guide"></div></div>' +
        '<div class="err" id="fErr"></div>' +
        '<button class="btn-primary" id="fShot">' + U.ic('camera', 18) + ' Prendre un selfie</button>' +
        (opts.skippable ? '<div class="switch"><span id="fSkip" class="lnk">Plus tard</span></div>' : '') +
      '</div>';
    const video = root.querySelector('#fVideo');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false })
      .then(function (s) { stream = s; video.srcObject = s; })
      .catch(function () { root.querySelector('#fErr').textContent = "Caméra indisponible. Vérifie l'autorisation dans les réglages du navigateur."; });

    function stop() { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); }

    root.querySelector('#fShot').addEventListener('click', async function () {
      const btn = this;
      btn.disabled = true; btn.textContent = 'Envoi…';
      try {
        const c = document.createElement('canvas');
        const side = Math.min(video.videoWidth, video.videoHeight);
        c.width = 640; c.height = 640;
        const ctx = c.getContext('2d');
        ctx.translate(c.width, 0); ctx.scale(-1, 1); // effet miroir naturel
        ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, 640, 640);
        const blob = await new Promise(function (r) { c.toBlob(r, 'image/webp', 0.85); });
        const path = await API.upload(blob, 'webp', 'avatars/' + S.me.id);
        const r = await sb.from('profiles').update({ avatar_path: path }).eq('id', S.me.id).select().single();
        if (r.error) throw r.error;
        S.me = r.data; S.users.set(S.me.id, S.me);
        stop();
        opts.onDone && opts.onDone();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Réessayer';
        root.querySelector('#fErr').textContent = e.message || 'Échec de l\u2019envoi. Réessaie.';
      }
    });
    const skip = root.querySelector('#fSkip');
    if (skip) skip.addEventListener('click', function () { stop(); opts.onDone && opts.onDone(); });
  }

  /* ---------- Avatar (photo si dispo, sinon initiale colorée) ---------- */
  const avatarCache = new Map();
  function renderAvatar(el, user, size) {
    size = size || 38;
    el.style.width = size + 'px'; el.style.height = size + 'px';
    el.classList.add('face');
    el.style.borderColor = user.color;
    el.style.fontSize = Math.round(size * 0.42) + 'px';
    el.textContent = (user.display_name || '?').trim().charAt(0).toUpperCase();
    if (user.avatar_path) {
      const cached = avatarCache.get(user.avatar_path);
      if (cached) paint(cached);
      else API.mediaUrl(user.avatar_path).then(function (u) { if (u) { avatarCache.set(user.avatar_path, u); paint(u); } });
    }
    function paint(u) {
      el.style.backgroundImage = 'url(' + u + ')';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    }
  }

  /* ---------- Écran Profil ("Moi") ---------- */
  function renderProfileTab(root) {
    const me = S.me;
    root.innerHTML =
      '<div class="top"><div class="mono accent">MON ESPACE</div></div>' +
      '<div class="profile-hero">' +
        '<div id="pAvatar" class="face big"></div>' +
        '<div class="pname">' + U.esc(me.display_name) + '</div>' +
        '<div class="sub">' + (me.role === 'admin' ? 'Administrateur' : 'Membre') + '</div>' +
        '<button class="chip-btn" id="pRetake">' + U.ic('camera', 14) + ' Reprendre le selfie</button>' +
      '</div>' +
      '<div class="card-list">' +
        row('geo', 'Partager ma position', S.myPos ? 'Position détectée' : 'Position inconnue pour l\u2019instant', me.share_location) +
        row('notif', 'Notifications', 'Nouveaux messages de la famille', localStorage.getItem('notif') === '1') +
      '</div>' +
      (me.role !== 'admin' ? '<div class="card-list"><div class="card"><div class="opt-ic"><span style="width:14px;height:14px;border-radius:50%;background:' + me.color + ';display:block"></span></div><div class="opt-txt"><div>Ma couleur</div><div class="sub">Attribuée par l\u2019administrateur</div></div>' + U.ic('lock', 16) + '</div></div>' : '') +
      '<div class="card-list"><div class="card" id="pLogout"><div class="opt-ic">' + U.ic('logout', 18) + '</div><div class="opt-txt"><div>Se déconnecter</div></div></div></div>' +
      '<div class="foot-note">' + U.esc(CONFIG.FAMILY_NAME) + ' · application privée</div>';

    renderAvatar(root.querySelector('#pAvatar'), me, 96);

    root.querySelector('#pRetake').addEventListener('click', function () {
      faceCaptureScreen(document.getElementById('modalRoot'), {
        skippable: true,
        onDone: function () { closeModal(); renderProfileTab(root); }
      });
      openModal();
    });

    root.querySelector('[data-t="geo"]').addEventListener('click', async function (e) {
      const on = !me.share_location;
      e.currentTarget.classList.toggle('on', on);
      try {
        await API.setShare(on);
        if (on) { API.startWatch(); U.toast('Position partagée avec la famille'); }
        else { API.stopWatch(); U.toast('Partage de position désactivé'); }
      } catch (err) { U.toast('Impossible de changer ce réglage'); e.currentTarget.classList.toggle('on', !on); }
    });
    root.querySelector('[data-t="notif"]').addEventListener('click', async function (e) {
      let on = localStorage.getItem('notif') === '1';
      if (!on && Notification.permission !== 'granted') {
        const p = await Notification.requestPermission();
        if (p !== 'granted') { U.toast('Notifications refusées par le navigateur'); return; }
      }
      on = !on;
      localStorage.setItem('notif', on ? '1' : '0');
      e.currentTarget.classList.toggle('on', on);
    });
    root.querySelector('#pLogout').addEventListener('click', async function () {
      API.stopWatch(); API.unsubscribe();
      await sb.auth.signOut();
      location.reload();
    });

    function row(key, title, sub, on) {
      return '<div class="card"><div class="opt-txt"><div>' + title + '</div><div class="sub">' + sub + '</div></div><div class="tg' + (on ? ' on' : '') + '" data-t="' + key + '"></div></div>';
    }
  }

  function openModal() { document.getElementById('modalBack').classList.add('on'); }
  function closeModal() { document.getElementById('modalBack').classList.remove('on'); document.getElementById('modalRoot').innerHTML = ''; }

  window.Profile = { faceCaptureScreen: faceCaptureScreen, renderAvatar: renderAvatar, renderProfileTab: renderProfileTab, openModal: openModal, closeModal: closeModal };
})();
