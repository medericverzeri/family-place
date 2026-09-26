(function () {
  'use strict';
  const S = API.S, Bus = API.Bus;
  let map = null, markers = new Map(), meMarker = null, followId = null;

  function faceDivIcon(user, size) {
    size = size || 34;
    const initial = (user.display_name || '?').trim().charAt(0).toUpperCase();
    const bg = user.avatar_path && Profile._avCache && Profile._avCache.get(user.avatar_path);
    return L.divIcon({
      className: 'map-pin',
      html: '<div class="pin-wrap" style="--c:' + user.color + '">' +
              '<div class="pin-face" id="pf-' + user.id + '" style="width:' + size + 'px;height:' + size + 'px">' + initial + '</div>' +
              '<div class="pin-tail"></div></div>',
      iconSize: [size, size + 10],
      iconAnchor: [size / 2, size + 10]
    });
  }

  async function paintFace(id) {
    const u = S.users.get(id);
    const el = document.getElementById('pf-' + id);
    if (!u || !el) return;
    if (u.avatar_path) {
      const url = await API.mediaUrl(u.avatar_path);
      if (url && el) { el.style.backgroundImage = 'url(' + url + ')'; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; el.textContent = ''; }
    }
  }

  function renderMapTab(root) {
    root.innerHTML =
      '<div class="map-wrap">' +
        '<div id="leaf" class="leaf"></div>' +
        '<div class="top map-top"><div class="mono accent">CARTE EN DIRECT</div></div>' +
        '<div class="map-ctl" id="mcLocate">' + U.ic('target', 18) + '</div>' +
        '<div class="map-ctl" id="mcMe" style="top:98px">' + U.ic('user', 18) + '</div>' +
      '</div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div id="peopleList"></div>' +
        '<div class="map-actions">' +
          '<button class="btn-mini ok" id="mCheckin">' + U.ic('check', 16) + ' Bien arrivé</button>' +
          '<button class="btn-mini danger" id="mSos">' + U.ic('alert', 16) + ' SOS</button>' +
        '</div>' +
      '</div>';

    setTimeout(function () { initMap(root); }, 30);

    root.querySelector('#mCheckin').addEventListener('click', async function () {
      const pos = await API.getPos(20000);
      await API.send({ kind: 'checkin', body: pos ? null : null });
      U.toast('Signal envoyé à la famille');
    });
    root.querySelector('#mSos').addEventListener('click', async function () {
      if (!confirm('Envoyer une alerte SOS à toute la famille ?')) return;
      const pos = await API.getPos(15000);
      await API.send({ kind: 'sos', lat: pos ? pos.lat : null, lng: pos ? pos.lng : null });
      U.toast('Alerte envoyée');
    });

    const onLoc = function () { paintPeople(root); if (map) syncMarkers(); };
    const onUser = function () { paintPeople(root); };
    Bus.on('loc', onLoc); Bus.on('user', onUser); Bus.on('online', onUser);
    Bus.on('mypos', function () { if (map) syncMe(); });
    paintPeople(root);
  }

  function initMap(root) {
    const el = root.querySelector('#leaf');
    if (!el || map) return;
    map = L.map(el, { zoomControl: false, attributionControl: true }).setView([46.6, 2.3], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CARTO', maxZoom: 19, subdomains: 'abcd'
    }).addTo(map);
    root.querySelector('#mcLocate').addEventListener('click', function () {
      if (S.myPos) map.flyTo([S.myPos.lat, S.myPos.lng], 16, { duration: 0.6 });
      else U.toast('Ta position n\u2019est pas encore disponible');
    });
    root.querySelector('#mcMe').addEventListener('click', function () {
      followId = S.me.id;
      if (S.myPos) map.flyTo([S.myPos.lat, S.myPos.lng], 16);
    });
    syncMarkers(); syncMe();
    let fitted = false;
    if (!fitted) { setTimeout(fitAll, 200); fitted = true; }
  }

  function fitAll() {
    if (!map) return;
    const pts = [];
    S.locs.forEach(function (l, uid) { const u = S.users.get(uid); if (u && u.share_location) pts.push([l.lat, l.lng]); });
    if (S.myPos) pts.push([S.myPos.lat, S.myPos.lng]);
    if (pts.length) map.fitBounds(pts, { padding: [40, 120], maxZoom: 15 });
  }

  function syncMe() {
    if (!map || !S.myPos) return;
    const ll = [S.myPos.lat, S.myPos.lng];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: faceDivIcon(S.me, 38), zIndexOffset: 1000 }).addTo(map);
      paintFace(S.me.id);
    } else meMarker.setLatLng(ll);
    if (followId === S.me.id) map.panTo(ll);
  }

  function syncMarkers() {
    if (!map) return;
    const seen = new Set();
    S.locs.forEach(function (l, uid) {
      if (uid === S.me.id) return;
      const u = S.users.get(uid);
      if (!u || u.status !== 'active' || !u.share_location) return;
      seen.add(uid);
      const ll = [l.lat, l.lng];
      let mk = markers.get(uid);
      if (!mk) {
        mk = L.marker(ll, { icon: faceDivIcon(u, 34) }).addTo(map);
        mk.on('click', function () { App.openConversation(uid); });
        markers.set(uid, mk);
        paintFace(uid);
      } else mk.setLatLng(ll);
      if (l.accuracy) {
        if (!mk._acc) mk._acc = L.circle(ll, { radius: l.accuracy, color: u.color, weight: 1, fillOpacity: 0.08, opacity: 0.35 }).addTo(map);
        else mk._acc.setLatLng(ll).setRadius(l.accuracy);
      }
    });
    markers.forEach(function (mk, uid) {
      if (!seen.has(uid)) { map.removeLayer(mk); if (mk._acc) map.removeLayer(mk._acc); markers.delete(uid); }
    });
  }

  function paintPeople(root) {
    const box = root.querySelector('#peopleList');
    if (!box) return;
    const others = Array.from(S.users.values()).filter(function (u) { return u.id !== S.me.id && u.status === 'active'; });
    box.innerHTML = others.map(function (u) {
      const l = S.locs.get(u.id);
      const sharing = u.share_location && l;
      let sub;
      if (!u.share_location) sub = U.ic('eyeoff', 13) + ' Partage désactivé';
      else if (!l) sub = 'En attente de signal';
      else {
        const d = S.myPos ? U.fmtDist(U.dist(S.myPos, l)) + ' · ' : '';
        const speed = l.speed && l.speed > 1 ? Math.round(l.speed * 3.6) + ' km/h · ' : '';
        sub = d + speed + U.ago(l.updated_at);
      }
      const bat = l && l.battery != null ? '<span class="bat">' + U.ic('battery', 13) + Math.round(l.battery * 100) + '%</span>' : '';
      return '<div class="card person-row" data-fly="' + u.id + '">' +
        '<div class="face" data-av="' + u.id + '" style="width:36px;height:36px;border-color:' + u.color + '"></div>' +
        '<div class="opt-txt"><div>' + U.esc(u.display_name) + '</div><div class="sub">' + sub + '</div></div>' + bat +
      '</div>';
    }).join('') || '<div class="empty small">Personne d\u2019autre pour le moment.</div>';
    box.querySelectorAll('[data-av]').forEach(function (el) { const u = S.users.get(el.dataset.av); if (u) Profile.renderAvatar(el, u, 36); });
    box.querySelectorAll('[data-fly]').forEach(function (el) {
      el.addEventListener('click', function () {
        const l = S.locs.get(el.dataset.fly);
        if (l && map) { followId = null; map.flyTo([l.lat, l.lng], 16, { duration: 0.6 }); }
        else U.toast('Position non disponible pour ce membre');
      });
    });
  }

  window.MapTab = { renderMapTab: renderMapTab };
})();
