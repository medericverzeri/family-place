(function () {
  'use strict';
  const sb = API.sb, S = API.S, Bus = API.Bus;
  const screen = document.getElementById('screen');
  const tabs = document.getElementById('tabbar');
  let currentTab = 'chat', currentConv = null;

  function goTab(t) {
    currentTab = t; currentConv = null;
    paintTabbar();
    if (t === 'chat') Chat.renderChatList(screen);
    else if (t === 'map') MapTab.renderMapTab(screen);
    else if (t === 'admin') Admin.renderAdminTab(screen);
    else if (t === 'profile') Profile.renderProfileTab(screen);
  }
  function openConversation(key) {
    currentConv = key;
    Chat.renderConversation(screen, key);
    tabs.classList.add('hide');
  }
  function paintTabbar() {
    const isAdmin = S.me && S.me.role === 'admin';
    tabs.classList.remove('hide');
    tabs.innerHTML =
      tabBtn('chat', 'message', 'Chats') +
      tabBtn('map', 'pin', 'Carte') +
      (isAdmin ? tabBtn('admin', 'shield', 'Admin') : tabBtn('call', 'video', 'Appels')) +
      tabBtn('profile', 'user', 'Moi');
    tabs.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.tab === 'call') { Calls.startCall(null, true); return; }
        goTab(b.dataset.tab);
      });
    });
    function tabBtn(id, icon, label) {
      return '<div class="tab-btn' + (currentTab === id ? ' on' : '') + '" data-tab="' + id + '">' + U.ic(icon, 21) + '<span>' + label + '</span></div>';
    }
  }

  /* ---------- Notifications + géo-verrouillage + appels entrants ---------- */
  function watchIncoming() {
    Bus.on('msg', function (d) {
      if (d.mine) return;
      const m = d.m;
      if (m.kind === 'call') { Calls.ringingIncoming(m.sender_id, m.body); return; }
      if (m.kind === 'sos') {
        const u = S.users.get(m.sender_id);
        U.toast('Alerte SOS de ' + (u ? u.display_name : 'un membre') + ' !');
        notify('SOS · ' + (u ? u.display_name : ''), 'Besoin d\u2019aide, ouvre l\u2019application');
        return;
      }
      if (currentConv === API.convKey(m)) return;
      const u = S.users.get(m.sender_id);
      const label = m.kind === 'text' ? m.body : (m.kind === 'image' ? 'Photo' : m.kind === 'video' ? 'Vidéo' : m.kind === 'audio' ? 'Message vocal' : 'Nouveau message');
      notify((u ? u.display_name : 'Famille') + (m.recipient_id ? '' : ' · Famille'), label || 'Nouveau message');
    });
  }
  function notify(title, body) {
    if (localStorage.getItem('notif') !== '1') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && currentTab === 'chat' && !currentConv) return;
    try { new Notification(title, { body: body, icon: 'icons/icon-192.png', tag: 'maison' }); } catch (e) {}
  }

  /* ---------- Déblocage des messages verrouillés par lieu ---------- */
  function checkGeolocks() {
    if (!S.myPos) return;
    S.msgs.forEach(function (m) {
      if (m.kind === 'geolock' && m.recipient_id === S.me.id && !m.viewed_at && m.lat != null) {
        const d = U.dist(S.myPos, { lat: m.lat, lng: m.lng });
        if (d <= (m.radius || 150)) {
          sb.from('messages').update({ viewed_at: new Date().toISOString() }).eq('id', m.id).then(function () {
            U.toast('Un message verrouillé vient de se dévoiler');
          });
        }
      }
    });
  }

  /* ---------- Démarrage ---------- */
  async function boot() {
    document.getElementById('modalBack').addEventListener('click', function (e) {
      if (e.target.id === 'modalBack') { e.target.classList.remove('on'); document.getElementById('modalRoot').innerHTML = ''; }
    });

    const consent = localStorage.getItem('consent');
    const { data: { session } } = await sb.auth.getSession();

    if (!session) {
      if (!consent) return Auth.consentScreen(screen, function () { Auth.authScreen(screen, 'up'); });
      return Auth.authScreen(screen, 'in');
    }
    await afterLogin();
  }

  async function afterLogin() {
    screen.innerHTML = '<div class="splash"><div class="brand-mark pulse">' + U.ic('home', 26) + '</div></div>';
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return Auth.authScreen(screen, 'in');
    S.me = { id: user.id };
    try { await API.loadAll(); } catch (e) { console.error(e); }
    if (!S.users.get(user.id)) { await sb.auth.signOut(); return Auth.authScreen(screen, 'in'); }
    S.me = S.users.get(user.id);

    if (S.me.status === 'blocked') return Auth.blockedScreen(screen, async function () { await sb.auth.signOut(); location.reload(); });
    if (S.me.status === 'pending') {
      API.subscribe();
      Bus.on('me', function (u) { if (u.status === 'active') afterLogin(); });
      return Auth.pendingScreen(screen, async function () { await sb.auth.signOut(); location.reload(); });
    }

    if (!S.me.avatar_path) {
      return Profile.faceCaptureScreen(screen, { skippable: true, onDone: afterLogin });
    }

    API.subscribe();
    watchIncoming();
    Bus.on('mypos', checkGeolocks);
    if (S.me.share_location) API.startWatch();

    goTab('chat');

    sb.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') location.reload();
    });

    setInterval(function () { if (S.me) API.getPos(30000); }, 60000);
  }

  window.App = { goTab: goTab, openConversation: openConversation };
  boot();
})();
