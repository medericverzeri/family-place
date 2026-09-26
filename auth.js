(function () {
  'use strict';
  const sb = API.sb, S = API.S;

  const CONSENTS = [
    { key: 'geo', icon: 'pin', title: 'Position en direct', sub: 'Partage réglable, désactivable à tout moment' },
    { key: 'cam', icon: 'camera', title: 'Caméra et micro', sub: 'Photos, vidéos, appels' },
    { key: 'gal', icon: 'image', title: 'Galerie', sub: 'Envoyer des photos et vidéos existantes' },
    { key: 'notif', icon: 'message', title: 'Notifications', sub: 'Nouveaux messages de la famille' }
  ];

  function consentScreen(root, onDone) {
    const state = { geo: true, cam: true, gal: true, notif: true };
    root.innerHTML =
      '<div class="auth-wrap">' +
        '<div class="auth-head"><div class="brand-mark">' + U.ic('home', 26) + '</div>' +
          '<h1>Avant de commencer</h1>' +
          '<p class="sub">Chaque accès est facultatif et modifiable ensuite dans ton profil.</p></div>' +
        '<div id="cList"></div>' +
        '<button class="btn-primary" id="cGo">Activer le lien familial</button>' +
      '</div>';
    const list = root.querySelector('#cList');
    list.innerHTML = CONSENTS.map(function (c) {
      return '<div class="opt-card" data-k="' + c.key + '">' +
        '<div class="opt-ic">' + U.ic(c.icon, 20) + '</div>' +
        '<div class="opt-txt"><div>' + c.title + '</div><div class="sub">' + c.sub + '</div></div>' +
        '<div class="tg on" data-t="' + c.key + '"></div></div>';
    }).join('');
    list.querySelectorAll('[data-t]').forEach(function (t) {
      t.addEventListener('click', function () {
        const k = t.dataset.t;
        state[k] = !state[k];
        t.classList.toggle('on', state[k]);
      });
    });
    root.querySelector('#cGo').addEventListener('click', async function () {
      // Déclenche les demandes natives tout de suite, pour un vrai consentement explicite
      if (state.cam) { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
      if (state.geo) { try { await API.getPos(0); } catch (e) {} }
      if (state.notif && 'Notification' in window) { try { await Notification.requestPermission(); } catch (e) {} }
      localStorage.setItem('consent', JSON.stringify(state));
      onDone(state);
    });
  }

  function authScreen(root, defaultMode) {
    let mode = defaultMode || 'in';
    function render() {
      root.innerHTML =
        '<div class="auth-wrap">' +
          '<div class="auth-head"><div class="brand-mark">' + U.ic('home', 26) + '</div>' +
            '<h1>' + U.esc(CONFIG.FAMILY_NAME) + '</h1>' +
            '<p class="sub">Un réseau privé, rien que pour la famille.</p></div>' +
          '<div class="field"><span class="fic">' + U.ic('user', 18) + '</span><input id="aName" placeholder="Ton prénom" autocomplete="name" style="' + (mode === 'in' ? 'display:none' : '') + '"></div>' +
          '<div class="field"><span class="fic">✉</span><input id="aMail" type="email" placeholder="Adresse e-mail" autocomplete="email"></div>' +
          '<div class="field"><span class="fic">' + U.ic('lock', 18) + '</span><input id="aPass" type="password" placeholder="Mot de passe" autocomplete="' + (mode === 'in' ? 'current-password' : 'new-password') + '"></div>' +
          '<div class="field" id="fInvite" style="' + (mode === 'in' ? 'display:none' : '') + '"><span class="fic">' + U.ic('key', 18) + '</span><input id="aInvite" placeholder="Code famille (donné par l&#39;admin)" style="text-transform:uppercase"></div>' +
          '<div class="err" id="aErr"></div>' +
          '<button class="btn-primary" id="aGo">' + (mode === 'in' ? 'Se connecter' : 'Créer mon compte') + '</button>' +
          '<div class="switch">' + (mode === 'in' ? "Pas encore de compte ? <span id='aSw' class='lnk'>Créer un compte</span>" : "Déjà un compte ? <span id='aSw' class='lnk'>Se connecter</span>") + '</div>' +
        '</div>';
      root.querySelector('#aSw').addEventListener('click', function () { mode = mode === 'in' ? 'up' : 'in'; render(); });
      root.querySelector('#aGo').addEventListener('click', submit);
      root.querySelectorAll('input').forEach(function (i) {
        i.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      });
    }
    async function submit() {
      const btn = root.querySelector('#aGo'), errEl = root.querySelector('#aErr');
      errEl.textContent = '';
      const email = root.querySelector('#aMail').value.trim();
      const pass = root.querySelector('#aPass').value;
      if (!email || !pass) { errEl.textContent = 'Renseigne ton e-mail et ton mot de passe.'; return; }
      btn.disabled = true; btn.textContent = 'Un instant…';
      try {
        if (mode === 'in') {
          const r = await sb.auth.signInWithPassword({ email: email, password: pass });
          if (r.error) throw r.error;
        } else {
          const name = root.querySelector('#aName').value.trim();
          const invite = root.querySelector('#aInvite').value.trim();
          if (!name) throw new Error('Indique ton prénom.');
          if (pass.length < 6) throw new Error('6 caractères minimum pour le mot de passe.');
          const r = await sb.auth.signUp({ email: email, password: pass, options: { data: { display_name: name, invite: invite } } });
          if (r.error) throw r.error;
          if (!r.data.session) {
            root.innerHTML = '<div class="auth-wrap"><div class="auth-head"><div class="brand-mark">' + U.ic('check', 26) + '</div><h1>Vérifie ta boîte mail</h1><p class="sub">Clique sur le lien de confirmation, puis reviens te connecter.</p></div><button class="btn-primary" id="back2">Retour</button></div>';
            root.querySelector('#back2').addEventListener('click', function () { mode = 'in'; render(); });
            return;
          }
        }
      } catch (e) {
        btn.disabled = false; btn.textContent = mode === 'in' ? 'Se connecter' : 'Créer mon compte';
        errEl.textContent = translateErr(e.message || String(e));
      }
    }
    render();
  }

  function translateErr(m) {
    if (/Invalid login/i.test(m)) return 'E-mail ou mot de passe incorrect.';
    if (/already registered|already exists/i.test(m)) return 'Un compte existe déjà avec cet e-mail.';
    if (/Code famille invalide/i.test(m)) return 'Code famille incorrect. Demande-le à ton administrateur.';
    if (/Password should be/i.test(m)) return '6 caractères minimum pour le mot de passe.';
    return m;
  }

  function pendingScreen(root, onLogout) {
    root.innerHTML =
      '<div class="auth-wrap">' +
        '<div class="auth-head"><div class="brand-mark pend">' + U.ic('clock', 26) + '</div>' +
          '<h1>Demande envoyée</h1>' +
          '<p class="sub">L&#39;administrateur doit valider ton compte avant que tu puisses rejoindre la famille.</p></div>' +
        '<button class="btn-ghost" id="pOut">Se déconnecter</button>' +
      '</div>';
    root.querySelector('#pOut').addEventListener('click', onLogout);
  }

  function blockedScreen(root, onLogout) {
    root.innerHTML =
      '<div class="auth-wrap">' +
        '<div class="auth-head"><div class="brand-mark pend" style="border-color:#FF3D9A;color:#FF3D9A">' + U.ic('x', 26) + '</div>' +
          '<h1>Accès suspendu</h1>' +
          '<p class="sub">Ton administrateur a bloqué ce compte. Contacte-le si c&#39;est une erreur.</p></div>' +
        '<button class="btn-ghost" id="bOut">Se déconnecter</button>' +
      '</div>';
    root.querySelector('#bOut').addEventListener('click', onLogout);
  }

  window.Auth = { consentScreen: consentScreen, authScreen: authScreen, pendingScreen: pendingScreen, blockedScreen: blockedScreen };
})();
