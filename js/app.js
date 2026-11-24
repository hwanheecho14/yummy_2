// 화면 렌더링과 라우팅 (해시 기반: #/, #/senior/:id, #/my, #/profile, #/notifications, #/login, #/signup)
(function () {
  const S = window.Store;
  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  const filters = { q: '', dept: '', day: '', slot: '' };

  // ---------- 도우미 ----------
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slotOf = (id) => S.SLOTS.find((s) => s.id === id);
  const slotText = (id) => (slotOf(id) ? slotOf(id).label : id);
  const sortSlots = (ids) => S.SLOTS.filter((s) => ids.includes(s.id)).map((s) => s.id);

  function fmtDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
  }

  function timeAgo(ts) {
    const m = Math.floor((Date.now() - ts) / 6e4);
    if (m < 1) return '방금 전';
    if (m < 60) return `${m}분 전`;
    if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
    return `${Math.floor(m / 1440)}일 전`;
  }

  const STATUS = {
    pending: ['대기 중', 'pending'],
    accepted: ['수락됨', 'accepted'],
    rejected: ['거절됨', 'rejected'],
    expired: ['만료됨', 'muted'],
    cancelled: ['취소됨', 'muted'],
  };
  const badge = (status) => `<span class="badge badge-${STATUS[status][1]}">${STATUS[status][0]}</span>`;
  const chips = (items) => items.map((t) => `<span class="chip">${esc(t)}</span>`).join('');
  const userLine = (u) => `${esc(u.dept)} · ${esc(u.year)}학번`;

  // 단과대학별로 묶은 학과 선택 상자
  function deptSelect(current) {
    const known = S.DEPTS.includes(current);
    const groups = S.COLLEGES.map(
      (c) => `<optgroup label="${esc(c.name)}">${c.depts
        .map((d) => `<option value="${esc(d)}" ${d === current ? 'selected' : ''}>${esc(d)}</option>`)
        .join('')}</optgroup>`
    ).join('');
    const placeholder = `<option value="" disabled ${current ? '' : 'selected'}>학과를 선택하세요</option>`;
    const legacy = current && !known ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : '';
    return `<select name="dept" required>${placeholder}${legacy}${groups}</select>`;
  }
  const initial = (u) => `<div class="avatar" aria-hidden="true">${esc(u.name.slice(0, 1))}</div>`;

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function formData(form) {
    const fd = new FormData(form);
    const out = {};
    for (const [k, v] of fd.entries()) {
      if (k in out) out[k] = [].concat(out[k], v);
      else out[k] = v;
    }
    return out;
  }
  const asArray = (v) => (v == null ? [] : [].concat(v));

  // ---------- 상단 내비게이션 ----------
  function renderNav(active) {
    const me = S.currentUser();
    const link = (href, label, key, count) =>
      `<a href="${href}" class="${active === key ? 'active' : ''}">${label}${count ? `<span class="count">${count}</span>` : ''}</a>`;
    if (!me) {
      nav.innerHTML = link('#/', '선배 찾기', 'list') + link('#/login', '로그인', 'login');
      return;
    }
    const pendingReceived = S.requestsOf(me.id).received.filter((r) => r.status === 'pending').length;
    nav.innerHTML =
      link('#/', '선배 찾기', 'list') +
      link('#/my', '내 밥약', 'my', pendingReceived) +
      link('#/notifications', '알림', 'notifications', S.unreadCount(me.id)) +
      link('#/profile', '내 프로필', 'profile') +
      `<button type="button" class="link-btn" data-action="logout">로그아웃</button>`;
  }

  // ---------- 선배 목록 ----------
  function viewList() {
    const seniors = S.publicSeniors();
    const depts = [...new Set(seniors.map((s) => s.user.dept))].sort();
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
    const me = S.currentUser();
    return `
      <section class="hero">
        <h1>선배에게 밥약 신청하기</h1>
        <p>전공, 진로, 학교생활이 궁금하다면 부담 없이 선배에게 밥 한 끼 신청해 보세요.</p>
        ${me ? '' : '<p class="hero-cta"><a class="btn" href="#/login">로그인하고 시작하기</a></p>'}
      </section>
      <section class="filters" aria-label="검색 필터">
        <input type="search" id="f-q" placeholder="이름, 학과, 소개로 검색" value="${esc(filters.q)}" aria-label="검색어">
        <select id="f-dept" aria-label="학과">${opt('', '전체 학과', filters.dept)}${depts.map((d) => opt(d, d, filters.dept)).join('')}</select>
        <select id="f-day" aria-label="요일">${opt('', '전체 요일', filters.day)}${S.DAYS.map((d) => opt(d, d + '요일', filters.day)).join('')}</select>
        <select id="f-slot" aria-label="시간대">${opt('', '전체 시간대', filters.slot)}${S.SLOTS.map((s) => opt(s.id, s.label, filters.slot)).join('')}</select>
      </section>
      <div id="results"></div>`;
  }

  function renderResults() {
    const box = document.getElementById('results');
    if (!box) return;
    const q = filters.q.trim().toLowerCase();
    const list = S.publicSeniors().filter(({ user, profile }) => {
      if (filters.dept && user.dept !== filters.dept) return false;
      if (filters.day && !profile.days.includes(filters.day)) return false;
      if (filters.slot && !profile.slots.includes(filters.slot)) return false;
      if (q && ![user.name, user.dept, profile.bio].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    if (!list.length) {
      box.innerHTML = '<p class="empty">조건에 맞는 선배가 없어요. 필터를 바꿔 보세요.</p>';
      return;
    }
    const me = S.currentUser();
    const card = ({ user, profile }, tag) => `
        <a class="card senior-card ${tag ? 'highlight' : ''}" href="#/senior/${esc(user.id)}">
          ${tag ? `<span class="tag">${esc(tag)}</span>` : ''}
          <div class="card-head">${initial(user)}<div><strong>${esc(user.name)}</strong><div class="sub">${userLine(user)}</div></div></div>
          <p class="bio">${esc(profile.bio)}</p>
          <div class="chips">${chips(profile.days)}${chips(sortSlots(profile.slots).map(slotText))}</div>
        </a>`;
    const section = (title, desc, items, tag, cls) =>
      items.length
        ? `<section class="senior-section ${cls || ''}">
             <h2>${esc(title)} <span class="sub">${items.length}명</span></h2>
             ${desc ? `<p class="sub">${esc(desc)}</p>` : ''}
             <div class="grid">${items.map((x) => card(x, tag)).join('')}</div>
           </section>`
        : '';

    if (!me) {
      box.innerHTML =
        '<p class="note login-hint">로그인하면 우리 학과·단과대 선배를 먼저 모아서 보여드려요.</p>' +
        section('전체 선배', '', list, '', '');
      return;
    }
    const myCollege = S.collegeOf(me.dept);
    const sameDept = list.filter((x) => x.user.dept === me.dept);
    const sameCollege = list.filter((x) => x.user.dept !== me.dept && myCollege && S.collegeOf(x.user.dept) === myCollege);
    const others = list.filter((x) => !sameDept.includes(x) && !sameCollege.includes(x));
    box.innerHTML =
      section(`우리 학과 선배 · ${me.dept}`, '같은 학과 선배라 전공 이야기를 바로 나눌 수 있어요.', sameDept, '같은 학과', 'featured') +
      section(`같은 단과대 선배 · ${myCollege}`, '', sameCollege, '같은 단과대', 'featured') +
      section(sameDept.length || sameCollege.length ? '다른 학과 선배' : '전체 선배', '', others, '', '');
  }

  // ---------- 선배 상세 + 신청 ----------
  function viewSenior(id) {
    const user = S.userById(id);
    const profile = S.getProfile(id);
    const me = S.currentUser();
    if (!user || !profile || !profile.isPublic || (me && S.isBlocked(me.id, id))) {
      return `<div class="card"><p>찾을 수 없는 프로필이에요.</p><a class="btn ghost" href="#/">목록으로</a></div>`;
    }
    let action;
    if (!me) {
      action = `<a class="btn" href="#/login?next=${encodeURIComponent('#/senior/' + id)}">로그인하고 신청하기</a>`;
    } else if (me.id === id) {
      action = `<p class="note">내 프로필이에요. <a href="#/profile">수정하기</a></p>`;
    } else if (S.activeRequest(me.id, id)) {
      const r = S.activeRequest(me.id, id);
      action = `<p class="note">이 선배에게 보낸 신청이 ${badge(r.status)} 상태예요. <a href="#/my?tab=sent">내 밥약에서 보기</a></p>`;
    } else if (S.pendingCountFor(id) >= S.MAX_PENDING_PER_SENIOR) {
      action = `<p class="note">이 선배는 지금 신청이 많이 밀려 있어요. 나중에 다시 신청해 주세요.</p>`;
    } else {
      action = requestForm(id, profile);
    }
    const safety =
      me && me.id !== id
        ? `<div class="row-actions quiet">
             <button type="button" class="link-btn" data-action="report" data-id="${esc(id)}">신고하기</button>
             <button type="button" class="link-btn" data-action="block" data-id="${esc(id)}">차단하기</button>
           </div>`
        : '';
    return `
      <a class="back" href="#/">← 선배 목록</a>
      <article class="card">
        <div class="card-head big">${initial(user)}<div><h1>${esc(user.name)}</h1><div class="sub">${userLine(user)}</div></div></div>
        <p class="bio full">${esc(profile.bio)}</p>
        <dl class="facts">
          <dt>가능한 요일</dt><dd><div class="chips">${chips(profile.days.map((d) => d + '요일'))}</div></dd>
          <dt>가능한 시간대</dt><dd><div class="chips">${chips(sortSlots(profile.slots).map(slotText))}</div></dd>
        </dl>
        ${safety}
      </article>
      <section class="card">${action}</section>`;
  }

  function requestForm(id, profile) {
    const slotOpts = sortSlots(profile.slots).map((s) => `<option value="${esc(s)}">${esc(slotText(s))}</option>`).join('');
    const row = (i) => `
      <div class="option-row">
        <label>희망 일시 ${i + 1}${i === 0 ? ' (필수)' : ' (선택)'}</label>
        <div class="inline">
          <input type="date" name="date${i}" min="${S.today()}" ${i === 0 ? 'required' : ''} aria-label="희망 날짜 ${i + 1}">
          <select name="slot${i}" aria-label="희망 시간대 ${i + 1}">${slotOpts}</select>
        </div>
      </div>`;
    return `
      <h2>밥약 신청하기</h2>
      <p class="sub">선배가 가능한 요일: ${esc(profile.days.join(', '))}. 가능한 후보 일시를 최대 3개까지 골라 주세요.</p>
      <form data-form="request" data-id="${esc(id)}" class="stack">
        ${row(0)}${row(1)}${row(2)}
        <label for="msg">한마디 (${S.MESSAGE_MAX}자 이내)</label>
        <textarea id="msg" name="message" maxlength="${S.MESSAGE_MAX}" rows="3" placeholder="어떤 이야기를 나누고 싶은지 적어 주세요."></textarea>
        <button class="btn" type="submit">신청 보내기</button>
        <p class="note">선배가 수락하면 서로의 연락처가 공개돼요. ${S.EXPIRE_DAYS}일 동안 응답이 없으면 자동으로 만료돼요.</p>
      </form>`;
  }

  // ---------- 내 밥약 ----------
  function viewMy(params) {
    const me = S.currentUser();
    const tab = params.get('tab') === 'sent' ? 'sent' : 'received';
    const { sent, received } = S.requestsOf(me.id);
    const list = tab === 'sent' ? sent : received;
    const pendingReceived = received.filter((r) => r.status === 'pending').length;
    const tabs = `
      <div class="tabs" role="tablist">
        <a role="tab" href="#/my?tab=received" class="${tab === 'received' ? 'active' : ''}">받은 신청${pendingReceived ? ` <span class="count">${pendingReceived}</span>` : ''}</a>
        <a role="tab" href="#/my?tab=sent" class="${tab === 'sent' ? 'active' : ''}">보낸 신청</a>
      </div>`;
    const empty =
      tab === 'sent'
        ? '<p class="empty">아직 보낸 신청이 없어요. <a href="#/">선배를 찾아보세요.</a></p>'
        : '<p class="empty">아직 받은 신청이 없어요. <a href="#/profile">선배 프로필을 공개</a>하면 후배들이 신청할 수 있어요.</p>';
    return `<h1>내 밥약</h1>${tabs}<div class="stack">${list.length ? list.map((r) => requestCard(r, tab)).join('') : empty}</div>`;
  }

  function requestCard(r, tab) {
    const other = S.userById(tab === 'sent' ? r.toId : r.fromId);
    if (!other) return '';
    const options = r.options
      .map((o, i) => `<li class="${r.chosen === i ? 'chosen' : ''}">${fmtDate(o.date)} ${esc(slotText(o.slot))}${r.chosen === i ? ' · 확정' : ''}</li>`)
      .join('');
    let body = '';
    if (r.status === 'accepted') {
      body = `<div class="contact"><strong>${esc(other.name)}님 연락처</strong><span>${esc(other.contact || '등록된 연락처가 없어요.')}</span></div>
              <p class="note">첫 만남은 학생식당 등 교내의 사람이 많은 곳에서 하는 걸 권해요.</p>`;
    } else if (r.status === 'pending' && tab === 'received') {
      body = `
        <form data-form="respond" data-id="${esc(r.id)}" class="stack">
          <fieldset><legend>확정할 일시</legend>
            ${r.options.map((o, i) => `<label class="radio"><input type="radio" name="chosen" value="${i}" ${i === 0 ? 'checked' : ''}> ${fmtDate(o.date)} ${esc(slotText(o.slot))}</label>`).join('')}
          </fieldset>
          <div class="inline">
            <button class="btn" type="submit" name="decision" value="accept">수락</button>
            <button class="btn ghost" type="button" data-action="reject" data-id="${esc(r.id)}">거절</button>
          </div>
        </form>`;
    } else if (r.status === 'pending' && tab === 'sent') {
      body = `<div class="inline"><button class="btn ghost" type="button" data-action="cancel" data-id="${esc(r.id)}">신청 취소</button>
              <span class="note">${S.EXPIRE_DAYS}일 안에 응답이 없으면 자동으로 만료돼요.</span></div>`;
    }
    return `
      <article class="card request">
        <div class="card-head">${initial(other)}
          <div class="grow"><strong>${esc(other.name)}</strong> <span class="sub">${userLine(other)}</span>
            <div class="sub">${tab === 'sent' ? '보낸' : '받은'} 신청 · ${timeAgo(r.createdAt)}</div></div>
          ${badge(r.status)}
        </div>
        <ul class="options">${options}</ul>
        ${r.message ? `<blockquote>${esc(r.message)}</blockquote>` : ''}
        ${body}
      </article>`;
  }

  // ---------- 내 프로필 ----------
  function viewProfile() {
    const me = S.currentUser();
    const p = S.getProfile(me.id) || { bio: '', days: [], slots: [], isPublic: false };
    const check = (name, value, label, on) =>
      `<label class="check"><input type="checkbox" name="${name}" value="${esc(value)}" ${on ? 'checked' : ''}> ${esc(label)}</label>`;
    return `
      <h1>내 프로필</h1>
      <section class="card">
        <h2>기본 정보</h2>
        <form data-form="user" class="stack">
          <label>이름<input name="name" value="${esc(me.name)}" required></label>
          <div class="inline two">
            <label>학과${deptSelect(me.dept)}</label>
            <label>학번 (입학년도 두 자리)<input name="year" value="${esc(me.year)}" inputmode="numeric" maxlength="2" required></label>
          </div>
          <label>연락처 <span class="sub">(밥약이 수락된 상대에게만 보여요)</span><input name="contact" value="${esc(me.contact)}" placeholder="예: 카카오톡 오픈채팅 링크, 인스타그램 ID"></label>
          <button class="btn" type="submit">기본 정보 저장</button>
        </form>
      </section>
      <section class="card">
        <h2>선배 프로필</h2>
        <p class="sub">공개하면 후배들이 목록에서 보고 밥약을 신청할 수 있어요.</p>
        <form data-form="senior" class="stack">
          <label class="switch"><input type="checkbox" name="isPublic" ${p.isPublic ? 'checked' : ''}> 선배 프로필 공개하기</label>
          <label>자기소개 (${S.BIO_MAX}자 이내)<textarea name="bio" rows="4" maxlength="${S.BIO_MAX}" placeholder="전공, 동아리, 나눌 수 있는 이야기를 적어 주세요.">${esc(p.bio)}</textarea></label>
          <fieldset><legend>가능한 요일</legend><div class="checks">${S.DAYS.map((d) => check('days', d, d, p.days.includes(d))).join('')}</div></fieldset>
          <fieldset><legend>가능한 시간대</legend><div class="checks">${S.SLOTS.map((s) => check('slots', s.id, s.label, p.slots.includes(s.id))).join('')}</div></fieldset>
          <button class="btn" type="submit">선배 프로필 저장</button>
        </form>
      </section>
      <p class="quiet center"><button type="button" class="link-btn" data-action="reset">데모 데이터 초기화</button></p>`;
  }

  // ---------- 알림 ----------
  function viewNotifications() {
    const me = S.currentUser();
    const list = S.notificationsOf(me.id);
    const html = list.length
      ? `<ul class="notifs">${list
          .map((n) => `<li class="${n.read ? '' : 'unread'}"><a href="${esc(n.link)}">${esc(n.text)}</a><span class="sub">${timeAgo(n.createdAt)}</span></li>`)
          .join('')}</ul>`
      : '<p class="empty">새 알림이 없어요.</p>';
    S.markAllRead(me.id);
    return `<h1>알림</h1>${html}`;
  }

  // ---------- 로그인 / 가입 ----------
  function viewLogin(params) {
    const next = params.get('next') || '#/';
    return `
      <section class="card narrow">
        <h1>로그인</h1>
        <form data-form="login" data-next="${esc(next)}" class="stack">
          <label>아이디<input name="username" autocomplete="username" required></label>
          <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn" type="submit">로그인</button>
        </form>
        <p class="center sub">처음이신가요? <a href="#/signup?next=${encodeURIComponent(next)}">회원가입</a></p>
      </section>
      <section class="card narrow">
        <h2>데모 계정으로 둘러보기</h2>
        <p class="sub">한 브라우저에서 계정을 바꿔 가며 신청 → 수락 흐름을 확인할 수 있어요.</p>
        <div class="inline wrap">
          <button class="btn ghost" type="button" data-action="demo" data-id="u_j1" data-next="${esc(next)}">후배로 체험 (조새내, 25학번)</button>
          <button class="btn ghost" type="button" data-action="demo" data-id="u_s1" data-next="${esc(next)}">선배로 체험 (김민준, 20학번)</button>
        </div>
      </section>`;
  }

  function viewSignup(params) {
    const next = params.get('next') || '#/';
    return `
      <section class="card narrow">
        <h1>회원가입</h1>
        <form data-form="signup" data-next="${esc(next)}" class="stack">
          <label>아이디 <span class="sub">(영문, 숫자, _ 3~20자)</span><input name="username" autocomplete="username" required></label>
          <label>비밀번호 <span class="sub">(4자 이상)</span><input name="password" type="password" autocomplete="new-password" required></label>
          <label>이름<input name="name" required></label>
          <div class="inline two">
            <label>학과${deptSelect('')}</label>
            <label>학번<input name="year" placeholder="25" inputmode="numeric" maxlength="2" required></label>
          </div>
          <label>연락처 <span class="sub">(수락된 상대에게만 공개)</span><input name="contact" placeholder="예: 카카오톡 오픈채팅 링크"></label>
          <button class="btn" type="submit">가입하기</button>
          <p class="note">데이터는 이 브라우저에만 저장돼요. 실제 비밀번호는 쓰지 마세요.</p>
        </form>
      </section>`;
  }

  // ---------- 라우터 ----------
  function route() {
    S.expireOld();
    const [path, query] = location.hash.replace(/^#/, '').split('?');
    const parts = (path || '/').split('/').filter(Boolean);
    const params = new URLSearchParams(query || '');
    const me = S.currentUser();
    const needsLogin = ['my', 'profile', 'notifications'];

    if (needsLogin.includes(parts[0]) && !me) {
      location.replace('#/login?next=' + encodeURIComponent(location.hash));
      return;
    }

    let html;
    let active = parts[0] || 'list';
    switch (parts[0]) {
      case undefined: html = viewList(); break;
      case 'senior': html = viewSenior(parts[1]); active = 'list'; break;
      case 'my': html = viewMy(params); break;
      case 'profile': html = viewProfile(); break;
      case 'notifications': html = viewNotifications(); break;
      case 'login': html = viewLogin(params); break;
      case 'signup': html = viewSignup(params); active = 'login'; break;
      default: html = '<div class="card"><p>없는 페이지예요.</p><a class="btn ghost" href="#/">홈으로</a></div>';
    }
    app.innerHTML = html;
    renderNav(active);
    renderResults();
    window.scrollTo(0, 0);
  }

  // ---------- 이벤트 ----------
  document.addEventListener('input', (e) => {
    const map = { 'f-q': 'q', 'f-dept': 'dept', 'f-day': 'day', 'f-slot': 'slot' };
    if (map[e.target.id]) {
      filters[map[e.target.id]] = e.target.value;
      renderResults();
    }
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id, next } = el.dataset;
    let err = null;
    switch (action) {
      case 'logout':
        S.logout();
        toast('로그아웃했어요.');
        go('#/');
        return;
      case 'demo':
        S.loginAs(id);
        toast(`${S.userById(id).name}님으로 로그인했어요.`);
        go(next || '#/');
        return;
      case 'reject':
        if (!confirm('이 신청을 거절할까요?')) return;
        err = S.respond(id, false);
        if (!err) toast('신청을 거절했어요.');
        break;
      case 'cancel':
        if (!confirm('신청을 취소할까요?')) return;
        err = S.cancel(id);
        if (!err) toast('신청을 취소했어요.');
        break;
      case 'report': {
        const reason = prompt('신고 사유를 적어 주세요.');
        if (!reason || !reason.trim()) return;
        S.report(id, reason);
        toast('신고가 접수됐어요.');
        return;
      }
      case 'block':
        if (!confirm('차단하면 서로의 목록에서 보이지 않고, 진행 중인 신청은 취소돼요. 차단할까요?')) return;
        S.block(id);
        toast('차단했어요.');
        go('#/');
        return;
      case 'reset':
        if (!confirm('모든 데이터를 처음 상태로 되돌릴까요? 가입한 계정과 신청 내역이 지워져요.')) return;
        S.reset();
        toast('데모 데이터를 초기화했어요.');
        go('#/');
        return;
      default:
        return;
    }
    if (err) toast(err);
    route();
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const d = formData(form);
    let err = null;
    switch (form.dataset.form) {
      case 'login':
        err = await S.login(d.username || '', d.password || '');
        if (!err) return go(form.dataset.next || '#/');
        break;
      case 'signup':
        err = await S.signup({
          username: d.username || '', password: d.password || '', name: d.name || '',
          dept: d.dept, year: (d.year || '').trim(), contact: d.contact || '',
        });
        if (!err) {
          toast('가입을 환영해요!');
          return go(form.dataset.next || '#/');
        }
        break;
      case 'request': {
        const options = [0, 1, 2]
          .filter((i) => d['date' + i])
          .map((i) => ({ date: d['date' + i], slot: d['slot' + i] }));
        err = S.createRequest(form.dataset.id, options, d.message || '');
        if (!err) {
          toast('밥약 신청을 보냈어요!');
          return go('#/my?tab=sent');
        }
        break;
      }
      case 'respond':
        err = S.respond(form.dataset.id, true, Number(d.chosen));
        if (!err) {
          toast('밥약을 수락했어요! 연락처가 공개됐어요.');
          return route();
        }
        break;
      case 'user':
        err = S.updateUser({ name: d.name || '', dept: d.dept, year: (d.year || '').trim(), contact: d.contact || '' });
        if (!err) toast('기본 정보를 저장했어요.');
        break;
      case 'senior':
        err = S.saveProfile({
          bio: d.bio || '', days: asArray(d.days), slots: asArray(d.slots), isPublic: 'isPublic' in d,
        });
        if (!err) toast('선배 프로필을 저장했어요.');
        break;
    }
    if (err) toast(err);
  });

  window.addEventListener('hashchange', route);
  route();
})();
