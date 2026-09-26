(function () {
  'use strict';
  const S = API.S, sb = API.sb;

  let roomId = null, ch = null, localStream = null, peers = new Map(); // id -> RTCPeerConnection
  let camOn = true, micOn = true, front = true, root = null, ringTimer = null, startedAt = 0, tickTimer = null;

  async function iceServers() {
    const base = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun.l.google.com:19302'] }];
    if (!CONFIG.TURN_URL) return base;
    try {
      const r = await fetch(CONFIG.TURN_URL);
      const j = await r.json();
      return j.iceServers || base;
    } catch (e) { return base; }
  }

  /* ---------- Démarrer / rejoindre un appel ---------- */
  async function startCall(targetId, isGroup) {
    roomId = isGroup ? 'family' : ['dm', [S.me.id, targetId].sort().join('-')].join('_');
    await API.send({ recipient_id: isGroup ? null : targetId, kind: 'call', body: roomId });
    await openCallUI(true);
  }
  async function ringingIncoming(fromId, room) {
    if (root) return; // déjà en appel
    roomId = room;
    openIncomingUI(fromId);
  }

  function openIncomingUI(fromId) {
    const u = S.users.get(fromId);
    const back = document.getElementById('modalBack'), mr = document.getElementById('modalRoot');
    mr.innerHTML = '<div class="incoming"><div class="face big" id="inAv" style="border-color:' + (u ? u.color : '#00E5FF') + '"></div>' +
      '<div class="in-name">' + U.esc(u ? u.display_name : 'Appel') + '</div><div class="sub">Appel vidéo entrant…</div>' +
      '<div class="in-actions"><button class="round danger" id="inDecline">' + U.ic('phone', 24) + '</button><button class="round ok" id="inAccept">' + U.ic('video', 24) + '</button></div></div>';
    back.classList.add('on');
    if (u) Profile.renderAvatar(mr.querySelector('#inAv'), u, 84);
    mr.querySelector('#inAccept').addEventListener('click', function () { closeModalOnly(); openCallUI(false); });
    mr.querySelector('#inDecline').addEventListener('click', function () { closeModalOnly(); roomId = null; });
  }
  function closeModalOnly() {
    document.getElementById('modalBack').classList.remove('on');
    document.getElementById('modalRoot').innerHTML = '';
  }

  async function openCallUI(isCaller) {
    root = document.getElementById('callRoot');
    root.classList.add('on');
    root.innerHTML =
      '<div class="call-top"><span class="rec-dot"></span><span id="ctTimer">00:00</span><span class="grow"></span><span class="chip" id="ctCount">1 connecté</span></div>' +
      '<div class="call-grid" id="callGrid"></div>' +
      '<div class="call-bar">' +
        '<button class="round" id="cbMic">' + U.ic('mic', 22) + '</button>' +
        '<button class="round" id="cbCam">' + U.ic('video', 22) + '</button>' +
        '<button class="round" id="cbFlip">' + U.ic('flip', 22) + '</button>' +
        '<button class="round danger" id="cbEnd">' + U.ic('phone', 22) + '</button>' +
      '</div>';
    startedAt = Date.now();
    tickTimer = setInterval(tick, 1000);

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
    } catch (e) {
      U.toast('Caméra ou micro indisponible'); localStream = null;
    }
    addTile(S.me.id, localStream, true);

    ch = sb.channel('call:' + roomId, { config: { presence: { key: S.me.id }, broadcast: { self: false } } });
    ch.on('broadcast', { event: 'signal' }, function (p) { onSignal(p.payload); });
    ch.on('presence', { event: 'sync' }, function () { updateCount(); });
    ch.on('presence', { event: 'join' }, function (p) {
      p.newPresences.forEach(function (pr) {
        if (pr.key !== S.me.id && !peers.has(pr.key)) createPeer(pr.key, S.me.id < pr.key);
      });
    });
    ch.on('presence', { event: 'leave' }, function (p) {
      p.leftPresences.forEach(function (pr) { removePeer(pr.key); });
    });
    await ch.subscribe(async function (st) { if (st === 'SUBSCRIBED') await ch.track({ at: Date.now() }); });

    root.querySelector('#cbMic').addEventListener('click', function () {
      micOn = !micOn; if (localStream) localStream.getAudioTracks().forEach(function (t) { t.enabled = micOn; });
      this.classList.toggle('off', !micOn);
    });
    root.querySelector('#cbCam').addEventListener('click', function () {
      camOn = !camOn; if (localStream) localStream.getVideoTracks().forEach(function (t) { t.enabled = camOn; });
      this.classList.toggle('off', !camOn);
      const tile = document.getElementById('tile-' + S.me.id);
      if (tile) tile.classList.toggle('cam-off', !camOn);
    });
    root.querySelector('#cbFlip').addEventListener('click', flipCam);
    root.querySelector('#cbEnd').addEventListener('click', endCall);
  }

  function tick() {
    const el = document.getElementById('ctTimer');
    if (!el) return;
    const s = Math.floor((Date.now() - startedAt) / 1000);
    el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function updateCount() {
    const n = ch ? Object.keys(ch.presenceState()).length : 1;
    const el = document.getElementById('ctCount');
    if (el) el.textContent = n + (n > 1 ? ' connectés' : ' connecté');
  }

  function addTile(id, stream, isMe) {
    const grid = document.getElementById('callGrid');
    if (!grid) return;
    const u = S.users.get(id) || S.me;
    const div = document.createElement('div');
    div.className = 'tile' + (isMe ? ' me' : '');
    div.id = 'tile-' + id;
    div.style.setProperty('--c', u ? u.color : '#00E5FF');
    div.innerHTML = '<video autoplay playsinline' + (isMe ? ' muted' : '') + '></video><div class="tile-name">' + U.esc(isMe ? 'Toi' : (u ? u.display_name : '')) + '</div>';
    grid.appendChild(div);
    const v = div.querySelector('video');
    if (stream) v.srcObject = stream;
    updateCount();
  }
  function removeTile(id) { const t = document.getElementById('tile-' + id); if (t) t.remove(); updateCount(); }

  async function createPeer(id, initiator) {
    const ice = await iceServers();
    const pc = new RTCPeerConnection({ iceServers: ice });
    peers.set(id, pc);
    if (localStream) localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
    pc.ontrack = function (e) {
      let tile = document.getElementById('tile-' + id);
      if (!tile) addTile(id, e.streams[0]);
      else tile.querySelector('video').srcObject = e.streams[0];
    };
    pc.onicecandidate = function (e) { if (e.candidate) send(id, { type: 'ice', candidate: e.candidate }); };
    pc.onconnectionstatechange = function () {
      if (['failed', 'closed', 'disconnected'].indexOf(pc.connectionState) >= 0) removePeer(id);
    };
    if (initiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send(id, { type: 'offer', sdp: offer });
    }
    return pc;
  }
  function removePeer(id) {
    const pc = peers.get(id);
    if (pc) { pc.close(); peers.delete(id); }
    removeTile(id);
  }

  function send(to, data) {
    if (!ch) return;
    ch.send({ type: 'broadcast', event: 'signal', payload: Object.assign({ from: S.me.id, to: to }, data) });
  }

  async function onSignal(p) {
    if (p.to !== S.me.id) return;
    let pc = peers.get(p.from);
    if (p.type === 'offer') {
      if (!pc) pc = await createPeer(p.from, false);
      await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      send(p.from, { type: 'answer', sdp: ans });
    } else if (p.type === 'answer') {
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
    } else if (p.type === 'ice') {
      if (pc) { try { await pc.addIceCandidate(p.candidate); } catch (e) {} }
    }
  }

  async function flipCam() {
    if (!localStream) return;
    front = !front;
    const oldTrack = localStream.getVideoTracks()[0];
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: front ? 'user' : 'environment' } });
      const nt = ns.getVideoTracks()[0];
      localStream.removeTrack(oldTrack); oldTrack.stop(); localStream.addTrack(nt);
      const meTile = document.getElementById('tile-' + S.me.id);
      if (meTile) meTile.querySelector('video').srcObject = localStream;
      peers.forEach(function (pc) {
        const sender = pc.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
        if (sender) sender.replaceTrack(nt);
      });
    } catch (e) { U.toast('Impossible de changer de caméra'); }
  }

  function endCall() {
    peers.forEach(function (pc) { pc.close(); });
    peers.clear();
    if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); });
    if (ch) { sb.removeChannel(ch); ch = null; }
    clearInterval(tickTimer);
    if (root) { root.classList.remove('on'); root.innerHTML = ''; root = null; }
    roomId = null; localStream = null;
  }

  window.Calls = { startCall: startCall, ringingIncoming: ringingIncoming, endCall: endCall };
})();
