(function () {
  'use strict';
  const S = API.S, sb = API.sb, Bus = API.Bus;

  async function renderAdminTab(root) {
    const members = Array.from(S.users.values());
    const pending = members.filter(function (u) { return u.status === 'pending'; });
    const active = members.filter(function (u) { return u.status === 'active'; });
    const used = await sb.rpc('storage_used');
    const usedBytes = used.data || 0;
    const pct = Math.min(100, Math.round((usedBytes / (1024 * 1024 * 1024)) * 100));
    let code = '\u2022\u2022\u2022\u2022\u2022\u2022';
    const fam = await sb.from('family').select('invite_code').single();
    if (fam.data) code = fam.data.invite_code;

    root.innerHTML =
      '<div class="top"><div class="mono accent">' + U.ic('shield', 16) + ' CENTRE DE CONTRÔLE</div></div>' +
      '<div class="admin-stats">' +
        stat(String(active.length), 'membres') +
        stat(String(pending.length), 'en attente', pending.length ? 'warn' : '') +
      '</div>' +
      '<div class="storage-card">' +
        '<div class="storage-row"><span>' + U.ic('db', 14) + ' Stockage</span><span>' + U.fmtBytes(usedBytes) + ' / 1 Go</span></div>' +
        '<div class="storage-bar"><div class="storage-fill" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      (pending.length ? '<div class="sec-title">Demandes en attente</div><div class="card-list" id="aPending"></div>' : '') +
      '<div class="sec-title">Membres</div><div class="card-list" id="aActive"></div>' +
      '<button class="btn-primary ghost-btn" id="aInvite">' + U.ic('key', 16) + ' Code d\u2019invitation</button>';

    root.querySelector('#aInvite').addEventListener('click', function () { inviteModal(code); });

    if (pending.length) {
      const pl = root.querySelector('#aPending');
      pl.innerHTML = pending.map(function (u) { return memberRow(u, true); }).join('');
      wire(pl);
    }
    const al = root.querySelector('#aActive');
    al.innerHTML = active.map(function (u) { return memberRow(u, false); }).join('');
    wire(al);

    function wire(container) {
      container.querySelectorAll('[data-av]').forEach(function (el) { const u = S.users.get(el.dataset.av); if (u) Profile.renderAvatar(el, u, 36); });
      container.querySelectorAll('[data-open]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-approve],[data-reject]')) return;
          memberSheet(S.users.get(el.dataset.open));
        });
      });
      container.querySelectorAll('[data-approve]').forEach(function (el) {
        el.addEventListener('click', async function (e) {
          e.stopPropagation();
          await sb.from('profiles').update({ status: 'active' }).eq('id', el.dataset.approve);
          U.toast('Membre validé'); renderAdminTab(root);
        });
      });
      container.querySelectorAll('[data-reject]').forEach(function (el) {
        el.addEventListener('click', async function (e) {
          e.stopPropagation();
          if (!confirm('Refuser cette demande ?')) return;
          await sb.from('profiles').update({ status: 'blocked' }).eq('id', el.dataset.reject);
          U.toast('Demande refusée'); renderAdminTab(root);
        });
      });
    }

    function stat(n, label, cls) {
      return '<div class="stat-box ' + (cls || '') + '"><div class="stat-n">' + n + '</div><div class="stat-l">' + label + '</div></div>';
    }
    function memberRow(u, isPending) {
      return '<div class="card person-row" data-open="' + u.id + '">' +
        '<div class="face" data-av="' + u.id + '" style="width:36px;height:36px;border-color:' + u.color + '"></div>' +
        '<div class="opt-txt"><div>' + U.esc(u.display_name) + (u.role === 'admin' ? ' · admin' : '') + '</div><div class="sub">' + (isPending ? 'Demande d\u2019accès' : (u.status === 'blocked' ? 'Bloqué' : 'Membre')) + '</div></div>' +
        (isPending ? '<button class="ic-btn ok" data-approve="' + u.id + '">' + U.ic('check', 18) + '</button><button class="ic-btn danger" data-reject="' + u.id + '">' + U.ic('x', 18) + '</button>' : U.ic('chevron', 18)) +
      '</div>';
    }
  }

  function memberSheet(u) {
    if (!u || u.id === S.me.id) return;
    const back = document.getElementById('modalBack'), mr = document.getElementById('modalRoot');
    mr.innerHTML =
      '<div class="auth-wrap">' +
        '<div class="auth-head"><div class="face big" id="msAv" style="border-color:' + u.color + '"></div><h1>' + U.esc(u.display_name) + '</h1><p class="sub">' + (u.status === 'blocked' ? 'Compte bloqué' : 'Membre de la famille') + '</p></div>' +
        '<div class="sec-title" style="text-align:left">Couleur attribuée</div>' +
        '<div class="swatches" id="msSw"></div>' +
        '<div class="card-list">' +
          toggleRow('map', 'Accès à la carte', u.can_see_map) +
        '</div>' +
        '<button class="btn-primary danger-btn" id="msBlock">' + U.ic(u.status === 'blocked' ? 'check' : 'x', 16) + ' ' + (u.status === 'blocked' ? 'Débloquer le compte' : 'Bloquer le compte') + '</button>' +
      '</div>';
    back.classList.add('on');
    Profile.renderAvatar(mr.querySelector('#msAv'), u, 84);
    const sw = mr.querySelector('#msSw');
    sw.innerHTML = CONFIG.PALETTE.map(function (c) {
      return '<div class="swatch' + (c.toLowerCase() === u.color.toLowerCase() ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '">' + (c.toLowerCase() === u.color.toLowerCase() ? U.ic('check', 16) : '') + '</div>';
    }).join('');
    sw.querySelectorAll('[data-c]').forEach(function (el) {
      el.addEventListener('click', async function () {
        const c = el.dataset.c;
        const r = await sb.from('profiles').update({ color: c }).eq('id', u.id);
        if (!r.error) { u.color = c; memberSheet(u); U.toast('Couleur mise à jour'); }
      });
    });
    mr.querySelector('[data-t="map"]').addEventListener('click', async function (e) {
      const on = !u.can_see_map;
      await sb.from('profiles').update({ can_see_map: on }).eq('id', u.id);
      u.can_see_map = on; e.currentTarget.classList.toggle('on', on);
    });
    mr.querySelector('#msBlock').addEventListener('click', async function () {
      const next = u.status === 'blocked' ? 'active' : 'blocked';
      if (next === 'blocked' && !confirm('Bloquer ' + u.display_name + ' ?')) return;
      await sb.from('profiles').update({ status: next }).eq('id', u.id);
      back.classList.remove('on'); mr.innerHTML = '';
      U.toast(next === 'blocked' ? 'Compte bloqué' : 'Compte débloqué');
    });

    function toggleRow(key, label, on) {
      return '<div class="card"><div class="opt-txt"><div>' + label + '</div></div><div class="tg' + (on ? ' on' : '') + '" data-t="' + key + '"></div></div>';
    }
  }

  function inviteModal(code) {
    const back = document.getElementById('modalBack'), mr = document.getElementById('modalRoot');
    mr.innerHTML =
      '<div class="auth-wrap"><div class="auth-head"><div class="brand-mark">' + U.ic('key', 24) + '</div><h1>Code d\u2019invitation</h1><p class="sub">Donne ce code à un nouveau membre. Il le saisira à la création de son compte.</p></div>' +
      '<div class="invite-code">' + code + '</div>' +
      '<button class="btn-primary" id="icCopy">' + U.ic('copy', 16) + ' Copier le code</button></div>';
    back.classList.add('on');
    mr.querySelector('#icCopy').addEventListener('click', function () {
      navigator.clipboard.writeText(code).then(function () { U.toast('Code copié'); }).catch(function () {});
    });
  }

  window.Admin = { renderAdminTab: renderAdminTab };
})();
