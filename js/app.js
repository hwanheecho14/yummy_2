// 화면 렌더링과 라우팅 (해시 기반: #/, #/senior/:id, #/my, #/profile, #/notifications, #/login, #/signup)
(function () {
  const S = window.Store;
  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  const filters = { q: '', dept: '', day: '', slot: '', kind: 'senior' }; // kind: 'senior' | 'buddy'

  // ---------- 도우미 ----------
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slotOf = (id) => S.SLOTS.find((s) => s.id === id);
  const slotText = (id) => (slotOf(id) ? slotOf(id).label : id);
  // 가능 시간: 같은 요일의 겹치는 구간은 합쳐서 '수 11:00~15:00' 칩 하나로 보여줌
  const availChips = (profile) =>
    S.mergeRanges(profile.avail)
      .map((a) => `<span class="chip time"><b>${esc(a.day)}</b> ${a.start}:00~${a.end}:00</span>`)
      .join('');
  // 카드용 한 줄: '🍴 돈까스 · 마라탕 · 쌀국수'
  const foodLine = (profile) =>
    (profile.foods || []).length ? `<p class="food-line">🍴 ${profile.foods.slice(0, 3).map(esc).join(' · ')}</p>` : '';

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
  const chips = (items, kind = '') => items.map((t) => `<span class="chip ${kind}">${esc(t)}</span>`).join('');
  // 학번으로 올해 학년 계산 (26학번 → 2026년에 1학년). 5년 이상이면 '4학년+'
  function gradeOf(year) {
    const g = new Date().getFullYear() - (2000 + Number(year)) + 1;
    if (!(g >= 1)) return '';
    return g <= 4 ? `${g}학년` : '4학년+';
  }
  // 나이: '05년생(21살)' — 생일을 모르므로 올해 연도 기준 나이(연 나이)로 표시
  const ageText = (u) => {
    if (!u.birthYear) return '';
    return `${String(u.birthYear).slice(2)}년생(${new Date().getFullYear() - u.birthYear}살)`;
  };
  const userLine = (u) => {
    const grade = gradeOf(u.year);
    const age = ageText(u);
    return `${esc(u.dept)} · ${esc(u.year)}학번${grade ? ` · ${grade}` : ''}${grade === '1학년' ? ' 🌱' : ''}${age ? ` · ${age}` : ''}`;
  };

  // 출생연도 선택 상자 (최근 연도가 위로)
  function birthSelect(current) {
    const years = [];
    for (let y = S.BIRTH_MAX(); y >= S.BIRTH_MIN(); y--) years.push(y);
    return `<select name="birthYear" required>
      <option value="" disabled ${current ? '' : 'selected'}>출생연도</option>
      ${years.map((y) => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}년</option>`).join('')}
    </select>`;
  }

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
  // 사용자마다 항상 같은 음식 이모지 아바타 (id로 정해짐)
  const FOODS = ['🍙', '🍜', '🥟', '🍕', '🍔', '🍝', '🍣', '🥪', '🌮', '🍛', '🥞', '🍩', '🍱', '🥗'];
  const hashOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const initial = (u) => {
    const h = hashOf(u.id);
    return `<div class="avatar tone-${h % 4}" aria-hidden="true">${FOODS[h % FOODS.length]}</div>`;
  };

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // 화면 안 확인창 (브라우저 confirm/prompt 대신. 공유 링크로 열 때 기본 팝업이 막혀 있어도 동작)
  // input을 주면 글 입력칸이 생기고 입력값을, 아니면 true를 돌려줌. 취소하면 false
  function ask({ message, ok = '확인', input = '', danger = false }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'ask-backdrop';
      wrap.innerHTML = `
        <div class="ask" role="dialog" aria-modal="true" aria-labelledby="ask-msg">
          <p id="ask-msg">${esc(message)}</p>
          ${input ? `<textarea id="ask-input" rows="3" maxlength="200" placeholder="${esc(input)}"></textarea>` : ''}
          <div class="ask-actions">
            <button type="button" class="btn ghost" data-ask="no">닫기</button>
            <button type="button" class="btn ${danger ? 'danger' : ''}" data-ask="yes">${esc(ok)}</button>
          </div>
        </div>`;
      const close = (value) => {
        wrap.remove();
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
      };
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ask]');
        if (e.target === wrap || (b && b.dataset.ask === 'no')) return close(false);
        if (b && b.dataset.ask === 'yes') {
          if (!input) return close(true);
          const v = wrap.querySelector('#ask-input').value.trim();
          if (!v) return wrap.querySelector('#ask-input').focus();
          close(v);
        }
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      (wrap.querySelector('#ask-input') || wrap.querySelector('[data-ask="yes"]')).focus();
    });
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
      nav.innerHTML = link('#/', '밥약 찾기', 'list') + link('#/food', '🍽️ 학식·맛집', 'food') + link('#/event', '☕ 이벤트', 'event') + link('#/login', '로그인', 'login');
      return;
    }
    const pendingReceived = S.requestsOf(me.id).received.filter((r) => r.status === 'pending').length;
    nav.innerHTML =
      link('#/', '밥약 찾기', 'list') +
      link('#/food', '🍽️ 학식·맛집', 'food') +
      link('#/event', '☕ 이벤트', 'event') +
      link('#/my', '내 밥약', 'my', pendingReceived) +
      link('#/notifications', '알림', 'notifications', S.unreadCount(me.id)) +
      link('#/profile', '내 프로필', 'profile') +
      `<button type="button" class="link-btn" data-action="logout">로그아웃</button>`;
  }

  // ---------- 선배 목록 ----------
  function viewList() {
    const seniors = S.publicSeniors(filters.kind);
    const depts = [...new Set(seniors.map((s) => s.user.dept))].sort();
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
    const me = S.currentUser();
    return `
      <section class="hero">
        <div class="hero-copy">
          <h1>선배, 밥 한 끼 해요!</h1>
          <p>전공, 진로, 학교생활이 궁금하다면 부담 없이 선배에게 밥약을 신청해 보세요.</p>
          ${me ? '' : '<p class="hero-cta"><a class="btn" href="#/login">로그인하고 시작하기</a></p>'}
        </div>
        <div class="hero-plate" aria-hidden="true">
          <span class="food f1">🍜</span><span class="food f2">🍙</span><span class="food f3">🥟</span>
        </div>
      </section>
      ${eventBanner()}
      ${kindTabs()}
      ${filters.kind === 'buddy' ? meetupBoard() : ''}
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
    const list = S.publicSeniors(filters.kind).filter(({ user, profile }) => {
      if (filters.dept && user.dept !== filters.dept) return false;
      if (filters.day && !S.availDays(profile).includes(filters.day)) return false;
      if (filters.slot && !(filters.day ? S.windowsOn(profile, filters.day).includes(filters.slot) : S.hasWindow(profile, filters.slot))) return false;
      if (q && ![user.name, user.dept, profile.bio, ...(profile.foods || []), ...(profile.spots || [])].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    if (!list.length) {
      box.innerHTML = `<p class="empty">조건에 맞는 ${S.KINDS[filters.kind]}가 없어요. 필터를 바꿔 보세요.</p>`;
      return;
    }
    const me = S.currentUser();
    const card = ({ user, profile }, tag) => `
        <a class="card senior-card ${tag ? 'highlight' : ''}" href="#/senior/${esc(user.id)}">
          ${tag ? `<span class="tag">${esc(tag)}</span>` : ''}
          <div class="card-head">${initial(user)}<div><strong>${esc(user.name)}</strong><div class="sub">${userLine(user)}</div></div></div>
          <p class="bio">${esc(profile.bio)}</p>
          ${foodLine(profile)}
          <div class="chips">${availChips(profile)}</div>
          ${S.supportsEvent(profile) ? '<div class="event-chip">☕ 수요일 공강 밥약 가능</div>' : ''}
          ${matchBadge(profile)}
        </a>`;
    const section = (title, desc, items, tag, cls) =>
      items.length
        ? `<section class="senior-section ${cls || ''}">
             <h2>${esc(title)} <span class="sub">${items.length}명</span></h2>
             ${desc ? `<p class="sub">${esc(desc)}</p>` : ''}
             <div class="grid">${byMatch(items).map((x) => card(x, tag)).join('')}</div>
           </section>`
        : '';

    const noun = S.KINDS[filters.kind]; // '선배' 또는 '밥친구'
    const sameDeptDesc =
      filters.kind === 'buddy' ? '같은 과 친구라 수업 이야기로 금방 친해질 수 있어요.' : '같은 학과 선배라 전공 이야기를 바로 나눌 수 있어요.';
    if (!me) {
      box.innerHTML =
        `<p class="note login-hint">로그인하면 우리 학과·단과대 ${noun}를 먼저 모아서 보여드려요.</p>` +
        section(`🍚 전체 ${noun}`, '', list, '', '');
      return;
    }
    const myCollege = S.collegeOf(me.dept);
    const sameDept = list.filter((x) => x.user.dept === me.dept);
    const sameCollege = list.filter((x) => x.user.dept !== me.dept && myCollege && S.collegeOf(x.user.dept) === myCollege);
    const others = list.filter((x) => !sameDept.includes(x) && !sameCollege.includes(x));
    box.innerHTML =
      section(`🍽️ 우리 학과 ${noun} · ${me.dept}`, sameDeptDesc, sameDept, '같은 학과', 'featured') +
      section(`🥢 같은 단과대 ${noun} · ${myCollege}`, '', sameCollege, '같은 단과대', 'featured') +
      section(sameDept.length || sameCollege.length ? `🍚 다른 학과 ${noun}` : `🍚 전체 ${noun}`, '', others, '', '');
  }

  // 홈 상단 탭: 선배에게 밥약 / 같이 먹을 밥친구
  function kindTabs() {
    const tab = (kind, label, desc) => `
      <button type="button" role="tab" class="kind-tab ${filters.kind === kind ? 'active' : ''}" aria-selected="${filters.kind === kind}" data-action="kind" data-kind="${kind}">
        <strong>${label}</strong><span>${desc}</span>
      </button>`;
    return `<div class="kind-tabs" role="tablist" aria-label="찾을 상대">
      ${tab('senior', '🧑‍🏫 선배 찾기', '선배에게 밥약 신청')}
      ${tab('buddy', '🍚 밥친구 찾기', '학년 상관없이 같이 먹을 친구')}
    </div>`;
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
      <a class="back" href="#/">← 목록으로</a>
      <article class="card">
        <div class="card-head big">${initial(user)}<div><h1>${esc(user.name)}</h1><div class="sub">${userLine(user)}</div></div></div>
        <p class="bio full">${esc(profile.bio)}</p>
        <dl class="facts">
          <dt>가능한 시간</dt><dd><div class="chips">${availChips(profile)}</div></dd>
          ${overlapRow(profile)}
          ${(profile.foods || []).length ? `<dt>좋아하는 메뉴</dt><dd><div class="chips">${(profile.foods).map((f) => `<span class="chip food">${esc(f)}</span>`).join("")}</div></dd>` : ""}
          ${(profile.spots || []).length ? `<dt>추천 맛집</dt><dd><ul class="spots">${profile.spots.map((s) => `<li>📍 ${esc(s)}</li>`).join("")}</ul></dd>` : ""}
          ${(profile.allergies || []).length ? `<dt>알레르기</dt><dd><div class="chips">${profile.allergies.map((a) => `<span class="chip allergy">⚠️ ${esc(a)}</span>`).join("")}</div></dd>` : ""}
          ${profile.timetable && profile.timetable.image
            ? `<dt>시간표</dt><dd><details class="tt-view"><summary>선배 시간표 보기</summary><img src="${esc(profile.timetable.image)}" alt="${esc(user.name)} 선배의 시간표"></details></dd>`
            : ''}
        </dl>
        ${safety}
      </article>
      <section class="card">${action}</section>`;
  }

  // ---------- 수요일 공강 커피 이벤트 ----------
  function eventBanner() {
    return `
      <a class="event-banner" href="#/event">
        <span class="event-icon" aria-hidden="true">☕</span>
        <span class="event-text">
          <strong>수요일 공강 밥약 이벤트</strong>
          <span>매주 수요일 13:00~15:00 전체 공강 시간에 밥약을 잡으면 커피 기프티콘 추첨에 자동 응모!</span>
        </span>
        <span class="event-go">자세히 →</span>
      </a>`;
  }

  function viewEvent() {
    const me = S.currentUser();
    const mine = me ? S.eventEntriesOf(me.id) : [];
    const myBox = !me
      ? '<p class="note">로그인하면 내 응모 내역을 볼 수 있어요.</p>'
      : mine.length
        ? `<p><strong>${mine.length}번 응모했어요.</strong></p><ul class="options">${mine
            .map((r) => {
              const other = S.userById(r.fromId === me.id ? r.toId : r.fromId);
              const o = r.options[r.chosen];
              return `<li>${fmtDate(o.date)} ${esc(slotText(o.slot))} · ${esc(other ? other.name : '')}님과 밥약</li>`;
            })
            .join('')}</ul>`
        : '<p class="note">아직 응모한 밥약이 없어요. 수요일 13:00~15:00로 밥약을 잡아 보세요!</p>';
    const seniors = S.publicSeniors().filter((x) => S.supportsEvent(x.profile)).length;
    return `
      <section class="event-hero">
        <div class="event-big" aria-hidden="true">☕</div>
        <h1>수요일 공강 밥약 이벤트</h1>
        <p>매주 수요일 <strong>13:00~15:00</strong>는 우리 학교 전체 공강 시간이에요.<br>이 시간에 밥약을 잡으면 커피 기프티콘 추첨에 자동으로 응모돼요.</p>
        <a class="btn" href="#/">공강 시간 가능한 선배 찾기</a>
      </section>
      <section class="card">
        <h2>참여 방법</h2>
        <ol class="steps">
          <li>선배 목록에서 <span class="event-chip inline-chip">☕ 수요일 공강 밥약 가능</span> 표시가 있는 선배를 찾아요. (지금 ${seniors}명)</li>
          <li>밥약 신청할 때 <strong>수요일</strong> 날짜와 <strong>13:00~15:00</strong> 시간대를 골라요. ☕ 표시가 붙어 있어요.</li>
          <li>선배가 그 일시로 수락하면 <strong>신청한 후배와 선배 모두</strong> 응모돼요.</li>
        </ol>
        <p class="note">밥약이 확정될 때마다 1번씩 응모돼요. 지금까지 전체 ${S.eventEntryCount()}건 응모됐어요.</p>
      </section>
      <section class="card">
        <h2>내 응모 내역</h2>
        ${myBox}
      </section>`;
  }

  // 앞으로 8주 안에서 선배가 가능한 요일에 해당하는 날짜들 (YYYY-MM-DD)
  const WEEKDAY = '일월화수목금토';
  function availableDates(profile) {
    const out = [];
    const d = new Date(S.today() + 'T00:00:00');
    for (let i = 0; i < 56; i++) {
      if (S.availDays(profile).includes(WEEKDAY[d.getDay()])) {
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  const monthKey = (iso) => iso.slice(0, 7);
  const monthLabel = (key) => `${Number(key.slice(5, 7))}월`;
  const dayLabel = (iso) => {
    const wd = WEEKDAY[new Date(iso + 'T00:00:00').getDay()];
    return `${Number(iso.slice(8, 10))}일 (${wd})${wd === S.EVENT.day ? ' ☕' : ''}`;
  };

  // 월을 고르면 그 달의 가능한 날짜만 일(日) 선택지에 채움
  function dayOptions(dates, month) {
    if (!month) return '<option value="">일</option>';
    return dates
      .filter((iso) => monthKey(iso) === month)
      .map((iso) => `<option value="${iso}">${dayLabel(iso)}</option>`)
      .join('');
  }

  // 고른 날짜의 요일에 선배가 가능한 2시간짜리 시간대만 채움
  function slotOptions(profile, iso) {
    if (!iso) return '<option value="">시간</option>';
    const wd = WEEKDAY[new Date(iso + 'T00:00:00').getDay()];
    return S.windowsOn(profile, wd)
      .map((s) => {
        const coffee = S.isEventOption({ date: iso, slot: s }) ? ' ☕ 공강 이벤트' : '';
        return `<option value="${esc(s)}">${esc(slotText(s))}${coffee}</option>`;
      })
      .join('');
  }

  function requestForm(id, profile) {
    const dates = availableDates(profile);
    requestForm.profile = profile;
    const months = [...new Set(dates.map(monthKey))];
    const row = (i) => {
      const first = i === 0;
      const monthOpts =
        (first ? '' : '<option value="">선택 안 함</option>') +
        months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
      return `
      <div class="option-row">
        <label>희망 일시 ${i + 1}${first ? ' (필수)' : ' (선택)'}</label>
        <div class="date-row">
          <select data-month="${i}" aria-label="희망 월 ${i + 1}">${monthOpts}</select>
          <select name="date${i}" data-day="${i}" aria-label="희망 날짜 ${i + 1}" ${first ? 'required' : 'disabled'}>${dayOptions(dates, first ? months[0] : '')}</select>
          <select name="slot${i}" aria-label="희망 시간대 ${i + 1}" ${first ? '' : 'disabled'}>${slotOptions(profile, first ? dates[0] : '')}</select>
        </div>
      </div>`;
    };
    if (!dates.length) return '<p class="note">가능한 요일이 아직 등록되지 않았어요.</p>';
    requestForm.dates = dates;
    return `
      <h2>${S.kindOf(profile) === 'buddy' ? '밥친구 신청하기' : '밥약 신청하기'}</h2>
      ${allergyNote(profile, '이 ' + S.KINDS[S.kindOf(profile)])}
      ${recommendBox(profile)}
      <p class="sub">가능한 요일(${esc(S.availDays(profile).join(', '))})의 날짜만 보여요. 날짜를 고르면 그날 가능한 시간이 나와요. 후보는 최대 3개까지 넣을 수 있어요.</p>
      ${S.supportsEvent(profile)
        ? `<p class="event-note">☕ 이 ${S.KINDS[S.kindOf(profile)]}는 수요일 13:00~15:00 공강 시간에 가능해요. 이 시간으로 확정되면 <a href="#/event">커피 기프티콘 이벤트</a>에 응모돼요!</p>`
        : ''}
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
    const coffee = (o) => (S.isEventOption(o) ? ' ☕' : '');
    const options = r.options
      .map((o, i) => `<li class="${r.chosen === i ? 'chosen' : ''}">${fmtDate(o.date)} ${esc(slotText(o.slot))}${coffee(o)}${r.chosen === i ? ' · 확정' : ''}</li>`)
      .join('');
    let eventLine = '';
    if (r.status === 'accepted' && S.isEventOption(r.options[r.chosen])) {
      eventLine = '<p class="event-note">☕ 수요일 공강 밥약이라 커피 기프티콘 이벤트에 응모됐어요!</p>';
    } else if (r.status === 'pending' && r.options.some(S.isEventOption)) {
      eventLine = `<p class="event-note">${tab === 'received' ? '☕ 표시된 일시로 수락하면' : '선배가 ☕ 표시된 일시로 수락하면'} 두 사람 모두 커피 기프티콘 이벤트에 응모돼요.</p>`;
    }
    let body = '';
    if (r.status === 'accepted') {
      body = `<div class="contact"><strong>${esc(other.name)}님 연락처</strong><span>${esc(other.contact || '등록된 연락처가 없어요.')}</span></div>
              <p class="note">첫 만남은 학생식당 등 교내의 사람이 많은 곳에서 하는 걸 권해요.</p>`;
    } else if (r.status === 'pending' && tab === 'received') {
      body = `
        <form data-form="respond" data-id="${esc(r.id)}" class="stack">
          <fieldset><legend>확정할 일시</legend>
            ${r.options.map((o, i) => `<label class="radio"><input type="radio" name="chosen" value="${i}" ${i === 0 ? 'checked' : ''}> ${fmtDate(o.date)} ${esc(slotText(o.slot))}${coffee(o)}</label>`).join('')}
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
        ${eventLine}
        ${r.message ? `<blockquote>${esc(r.message)}</blockquote>` : ''}
        ${body}
        ${chatButton(r)}
      </article>`;
  }

  // ---------- 신청별 대화 ----------
  function chatButton(r) {
    const me = S.currentUser();
    const count = S.messagesOf(r.id).length;
    if (!S.canChat(r) && !count) return '';
    const unread = S.unreadMessages(r.id, me.id);
    const label = S.canChat(r) ? '💬 대화하기' : '💬 지난 대화 보기';
    return `<a class="btn ghost chat-btn" href="#/chat/${esc(r.id)}">${label}${unread ? ` <span class="count">${unread}</span>` : ''}</a>`;
  }

  // 메시지 보내기 (입력창, 빠른 답장 공통). 성공하면 대화 화면을 다시 그리고 입력창에 포커스
  function sendChat(requestId, text) {
    const err = S.sendMessage(requestId, text);
    if (err) {
      toast(err);
      return false;
    }
    route();
    document.querySelector('.composer textarea')?.focus();
    scheduleDemoReply(requestId);
    return true;
  }

  // 상대가 예시 계정이면 '입력 중…'을 잠깐 보여준 뒤 자동 답장 (데모에서 대화가 오가는 느낌을 주기 위함)
  function scheduleDemoReply(requestId) {
    const me = S.currentUser();
    const r = S.requestById(requestId);
    const other = r && S.userById(r.fromId === me.id ? r.toId : r.fromId);
    if (!other || other.pwHash) return;
    const box = document.getElementById('messages');
    if (box) {
      box.insertAdjacentHTML('beforeend', `<div class="bubble-row typing">${initial(other)}<div class="bubble">입력 중…</div></div>`);
      scrollChatToBottom();
    }
    clearTimeout(scheduleDemoReply.t);
    scheduleDemoReply.t = setTimeout(() => {
      const m = S.demoReply(requestId);
      if (location.hash === `#/chat/${requestId}`) route();
      else if (m) renderNav();
    }, 1200);
  }

  // 빠른 답장: 누르면 바로 보내지는 기본 문장. 상대가 마지막에 보낸 말에 맞춰 첫 줄을 바꿈
  function quickReplies(msgs, me, tab) {
    const last = msgs[msgs.length - 1];
    const fromOther = last && last.fromId !== me.id ? last.text : '';
    let first;
    if (!msgs.length) first = tab === 'received' ? '안녕하세요! 신청 고마워요 😊' : '안녕하세요! 밥약 신청드린 ' + me.name + '이에요 😊';
    else if (/안녕|반가/.test(fromOther)) first = '안녕하세요! 반가워요 😊';
    else if (/언제|시간|괜찮/.test(fromOther)) first = '저는 신청한 시간 다 괜찮아요!';
    else if (/어디|장소|메뉴|뭐 먹/.test(fromOther)) first = '학식 어때요? 다른 곳도 좋아요!';
    else if (/엔빵|원/.test(fromOther)) first = '확인했어요! 바로 보낼게요 💸';
    else first = '좋아요! 😄';
    const list = [first, '언제 시간 괜찮으세요?', '어디서 먹을까요?', '좋아요! 그때 봬요 🙌', '감사합니다 🙏'];
    return `<div class="quick-replies" aria-label="빠른 답장">${[...new Set(list)]
      .map((t) => `<button type="button" class="chip quick" data-action="quick-reply" data-text="${esc(t)}">${esc(t)}</button>`)
      .join('')}</div>`;
  }

  function msgTime(ts) {
    const d = new Date(ts);
    const hm = `${d.getHours() < 12 ? '오전' : '오후'} ${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
    return new Date().toDateString() === d.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }

  function viewChat(id) {
    const me = S.currentUser();
    const r = S.requestById(id);
    if (!S.isParticipant(r, me.id)) {
      return '<div class="card"><p>볼 수 없는 대화예요.</p><a class="btn ghost" href="#/my">내 밥약으로</a></div>';
    }
    const other = S.userById(r.fromId === me.id ? r.toId : r.fromId);
    const tab = r.fromId === me.id ? 'sent' : 'received';
    const msgs = S.messagesOf(id);
    S.markMessagesRead(id, me.id);
    const bubbles = msgs.length
      ? msgs
          .map((m) => {
            const mine = m.fromId === me.id;
            return `<div class="bubble-row ${mine ? 'mine' : ''}">
                ${mine ? '' : initial(other)}
                <div class="bubble">${esc(m.text)}</div>
                <span class="bubble-time">${m.auto ? '<span class="auto-tag">예시 자동 답장</span>' : ''}${msgTime(m.createdAt)}</span>
              </div>`;
          })
          .join('')
      : `<p class="empty">아직 주고받은 메시지가 없어요.<br>${tab === 'received' ? '신청해 준 후배에게' : '선배에게'} 먼저 인사해 보세요 👋</p>`;
    const composer = S.canChat(r)
      ? `${quickReplies(msgs, me, tab)}
         <form data-form="chat" data-id="${esc(id)}" class="composer">
           <textarea name="text" rows="1" maxlength="${S.MESSAGE_TEXT_MAX}" placeholder="메시지를 입력하세요 (Enter로 보내기)" aria-label="메시지" required></textarea>
           <button class="btn" type="submit">보내기</button>
         </form>`
      : '<p class="note center">끝난 신청이라 메시지를 보낼 수 없어요.</p>';
    return `
      <a class="back" href="#/my?tab=${tab}">← 내 밥약</a>
      <section class="card chat">
        <div class="card-head chat-head">${initial(other)}
          <div class="grow"><strong>${esc(other.name)}</strong> <span class="sub">${userLine(other)}</span>
            <div class="sub">${tab === 'sent' ? '내가 보낸' : '내가 받은'} 밥약 신청</div></div>
          ${badge(r.status)}
        </div>
        ${allergyNote(S.getProfile(other.id) || {}, other.name + '님')}
        <div class="messages" id="messages">${bubbles}</div>
        ${composer}
        ${dutchPay({ people: 2, chatId: S.canChat(r) ? id : '' })}
        <p class="note">연락처는 밥약이 수락되면 공개돼요. 그 전에는 여기서 편하게 이야기하세요.</p>
      </section>`;
  }

  // 가능 시간 한 줄: [요일] [시작] ~ [끝] [삭제]
  function availRow(a) {
    const hours = (from, to, cur) =>
      Array.from({ length: to - from + 1 }, (_, i) => from + i)
        .map((h) => `<option value="${h}" ${h === cur ? 'selected' : ''}>${h}:00</option>`)
        .join('');
    return `
      <div class="avail-row">
        <select name="aday" aria-label="요일">${S.DAYS.map((d) => `<option ${d === a.day ? 'selected' : ''}>${d}</option>`).join('')}</select>
        <select name="astart" aria-label="시작 시각">${hours(S.HOUR_MIN, S.HOUR_MAX - S.MIN_RANGE, a.start)}</select>
        <span aria-hidden="true">~</span>
        <select name="aend" aria-label="끝 시각">${hours(S.HOUR_MIN + S.MIN_RANGE, S.HOUR_MAX, a.end)}</select>
        <button type="button" class="link-btn remove" data-action="remove-range" aria-label="이 시간 삭제">✕</button>
      </div>`;
  }

  // ---------- 학식 · 주변 맛집/카페 ----------
  // 학교 식단은 서버 없이 불러올 수 없어서 요일별 '예시 메뉴'를 보여주고, 실제 메뉴는 검색으로 확인하게 안내
  const CAFETERIA = [
    {
      name: '학생식당',
      hours: '점심 11:00~14:00 · 저녁 17:00~18:30 (예시)',
      menu: {
        월: ['제육볶음', '된장찌개', '계란말이'], 화: ['돈까스', '우동', '양배추샐러드'], 수: ['치킨마요덮밥', '미소국', '단무지'],
        목: ['김치찌개', '고등어구이', '잡채'], 금: ['카레라이스', '떡볶이', '요구르트'],
      },
    },
    {
      name: '교직원식당',
      hours: '점심 11:30~13:30 (예시)',
      menu: {
        월: ['소불고기', '시금치국', '나물무침'], 화: ['닭갈비', '콩나물국', '샐러드'], 수: ['생선까스', '크림스프', '피클'],
        목: ['비빔밥', '유부장국', '군만두'], 금: ['순두부찌개', '오징어볶음', '과일'],
      },
    },
  ];
  const mapLinks = (query) => {
    const q = encodeURIComponent(query);
    return `<a href="https://map.kakao.com/?q=${q}" target="_blank" rel="noopener">카카오맵</a>
      · <a href="https://map.naver.com/p/search/${q}" target="_blank" rel="noopener">네이버지도</a>
      · <a href="https://www.google.com/maps/search/${q}" target="_blank" rel="noopener">구글지도</a>`;
  };
  const NEARBY = [
    ['🍚', '한식·국밥', '한양대 에리카 한식'],
    ['🍢', '분식', '한양대 에리카 분식'],
    ['🍜', '중식·마라탕', '한양대 에리카 중식'],
    ['🍣', '일식·초밥', '한양대 에리카 일식'],
    ['🍝', '양식·파스타', '한양대 에리카 양식'],
    ['🍔', '버거·패스트푸드', '한양대 에리카 햄버거'],
    ['☕', '카페', '한양대 에리카 카페'],
    ['🍰', '디저트·베이커리', '한양대 에리카 디저트'],
    ['🚇', '한대앞역 맛집', '한대앞역 맛집'],
    ['🧋', '한대앞역 카페', '한대앞역 카페'],
  ];

  function viewFood() {
    const wd = WEEKDAY[new Date().getDay()];
    const day = S.DAYS.includes(wd) ? wd : '월';
    const cafeteria = CAFETERIA.map(
      (c) => `
        <article class="card cafeteria">
          <h3>${esc(c.name)}</h3>
          <p class="sub">${esc(c.hours)}</p>
          <div class="day-tabs" role="tablist">${S.DAYS.map(
            (d) => `<button type="button" role="tab" class="day-tab ${d === day ? 'active' : ''}" data-action="menu-day" data-day="${d}" aria-selected="${d === day}">${d}</button>`
          ).join('')}</div>
          ${S.DAYS.map((d) => `<ul class="menu" data-menu-day="${d}" ${d === day ? '' : 'hidden'}>${c.menu[d].map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`).join('')}
        </article>`
    ).join('');
    // 선배·밥친구 프로필에 적힌 추천 맛집 모아보기
    const spots = [];
    S.publicSeniors('senior').concat(S.publicSeniors('buddy')).forEach(({ user, profile }) =>
      (profile.spots || []).forEach((s) => spots.push({ s, user }))
    );
    const spotList = spots.length
      ? `<ul class="spot-list">${spots
          .slice(0, 12)
          .map(({ s, user }) => {
            const name = s.split(' - ')[0];
            return `<li><div><b>📍 ${esc(s)}</b><div class="sub">${esc(user.name)} · ${esc(user.dept)} 추천</div></div>
              <div class="sub map-links">${mapLinks('한양대 에리카 ' + name)}</div></li>`;
          })
          .join('')}</ul>`
      : '<p class="empty">아직 추천 맛집이 없어요.</p>';
    return `
      <section class="hero food-hero">
        <div class="hero-copy">
          <h1>오늘 뭐 먹지? 🍽️</h1>
          <p>교내 학식 메뉴와 학교 주변 맛집·카페를 한곳에서 보고, 밥약 장소를 정해 보세요.</p>
        </div>
      </section>
      <h2>🏫 교내 식당 <span class="sub">오늘은 ${day}요일</span></h2>
      <p class="note">⚠️ 학교 식단은 이 사이트에서 직접 불러올 수 없어서 <b>예시 메뉴</b>를 보여줘요.
        실제 메뉴는 <a href="https://www.google.com/search?q=${encodeURIComponent('한양대 에리카 학식 메뉴')}" target="_blank" rel="noopener">학교 식단 검색</a>으로 확인해 주세요.</p>
      <div class="grid cafeteria-grid">${cafeteria}</div>
      <h2 style="margin-top:24px">🗺️ 학교 주변 맛집·카페 찾기</h2>
      <p class="note">누르면 지도 앱에서 학교 근처 가게가 바로 검색돼요.</p>
      <div class="nearby-grid">${NEARBY.map(
        ([icon, label, q]) => `<div class="nearby"><span class="nearby-icon">${icon}</span><b>${esc(label)}</b><div class="sub map-links">${mapLinks(q)}</div></div>`
      ).join('')}</div>
      <h2 style="margin-top:24px">⭐ 선배·밥친구 추천 맛집</h2>
      <p class="note">프로필에 적힌 추천 맛집을 모았어요. (예시 데이터의 가게 이름은 지어낸 이름이에요)</p>
      ${spotList}`;
  }

  // ---------- 더치페이(엔빵) 계산기 ----------
  // 1인당 금액은 10원 단위로 올림. 실제 송금은 하지 않고, 송금처 메모만 함께 공유
  const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
  function splitBill(total, people) {
    if (!(total > 0) || !(people >= 2)) return null;
    const each = Math.ceil(total / people / 10) * 10;
    return { each, extra: each * people - total };
  }
  const dutchText = (total, people, memo) => {
    const s = splitBill(total, people);
    if (!s) return '';
    return `🧾 엔빵: 총 ${won(total)} ÷ ${people}명 = 1인 ${won(s.each)}${s.extra ? ` (올림 때문에 ${won(s.extra)} 남아요)` : ''}${memo ? ` · 송금처: ${memo}` : ''}`;
  };
  function dutchPay({ people, chatId }) {
    return `
      <details class="dutch">
        <summary>🧾 엔빵 계산기</summary>
        <div class="dutch-body" data-chat="${esc(chatId)}">
          <div class="inline two">
            <label>총 금액 (원)<input type="number" name="dutchTotal" min="0" step="100" inputmode="numeric" placeholder="예: 23000"></label>
            <label>인원<input type="number" name="dutchPeople" min="2" max="20" value="${people}" inputmode="numeric"></label>
          </div>
          <label>송금처 메모 <span class="sub">(선택)</span><input name="dutchMemo" maxlength="40" placeholder="예: 카카오페이로 보내주세요"></label>
          <p class="dutch-result note">금액을 입력하면 1인당 금액을 계산해요.</p>
          ${chatId ? '<button type="button" class="btn small" data-action="send-dutch">대화방에 보내기</button>' : ''}
        </div>
      </details>`;
  }
  function readDutch(box) {
    return {
      total: Number(box.querySelector('[name=dutchTotal]').value),
      people: Number(box.querySelector('[name=dutchPeople]').value),
      memo: box.querySelector('[name=dutchMemo]').value.trim(),
    };
  }

  // ---------- 밥친구 모집 · 그룹 밥약 ----------
  function meetupCard(m) {
    const me = S.currentUser();
    const host = S.userById(m.hostId);
    const joined = me && m.memberIds.includes(me.id);
    const full = S.isMeetupFull(m);
    const avatars = m.memberIds.map((id) => S.userById(id)).filter(Boolean).map(initial).join('');
    const empty = '<div class="avatar seat" aria-hidden="true">＋</div>'.repeat(Math.max(0, m.capacity - m.memberIds.length));
    const action = joined
      ? '<span class="badge badge-accepted">참여 중</span>'
      : full
        ? '<span class="badge badge-muted">마감</span>'
        : `<button type="button" class="btn small" data-action="join-meetup" data-id="${esc(m.id)}">참여하기</button>`;
    return `
      <article class="card meetup-card">
        <div class="meetup-top"><span class="chip format">${esc(S.MEETUP_FORMATS[m.format])}</span><span class="sub">${m.memberIds.length}/${m.capacity}명</span></div>
        <a class="meetup-title" href="#/meetup/${esc(m.id)}">${esc(m.title)}</a>
        <p class="sub">📅 ${fmtDate(m.date)} ${esc(slotText(m.slot))}${S.isEventOption(m) ? ' ☕' : ''} · 📍 ${esc(m.place)}</p>
        <p class="sub">주최: ${esc(host ? host.name : '')} (${host ? userLine(host) : ''})</p>
        <div class="meetup-bottom"><div class="seats">${avatars}${empty}</div>${action}</div>
      </article>`;
  }

  function meetupBoard() {
    const list = S.upcomingMeetups();
    const me = S.currentUser();
    return `
      <section class="senior-section featured meetup-board">
        <div class="board-head">
          <div><h2>🔥 밥친구 모집 · 그룹 밥약</h2>
            <p class="sub">1:1이 부담스러우면 친구랑 같이! 번개 모집이나 2:2·3:3 그룹 밥약에 참여해 보세요.</p></div>
          <a class="btn small" href="${me ? '#/meetup/new' : '#/login?next=' + encodeURIComponent('#/meetup/new')}">+ 모집글 쓰기</a>
        </div>
        ${list.length ? `<div class="grid">${list.map(meetupCard).join('')}</div>` : '<p class="empty">지금 열린 모집이 없어요. 첫 모집글을 써 보세요!</p>'}
      </section>`;
  }

  function viewMeetup(id) {
    const m = S.meetupById(id);
    const me = S.currentUser();
    if (!m) return '<div class="card"><p>찾을 수 없는 모집이에요.</p><a class="btn ghost" href="#/">목록으로</a></div>';
    const joined = me && m.memberIds.includes(me.id);
    const members = m.memberIds
      .map((uid2) => S.userById(uid2))
      .filter(Boolean)
      .map(
        (u) => `<li class="member">${initial(u)}<div><strong>${esc(u.name)}</strong>${u.id === m.hostId ? ' <span class="chip">주최</span>' : ''}
            <div class="sub">${userLine(u)}</div>
            ${joined ? `<div class="sub">📞 ${esc(u.contact || '연락처 없음')}</div>` : ''}</div></li>`
      )
      .join('');
    let action = '';
    if (m.cancelled) action = '<p class="note">취소된 모집이에요.</p>';
    else if (!me) action = `<a class="btn" href="#/login?next=${encodeURIComponent('#/meetup/' + m.id)}">로그인하고 참여하기</a>`;
    else if (joined)
      action = `<button type="button" class="btn ghost" data-action="leave-meetup" data-id="${esc(m.id)}">${m.hostId === me.id ? '모집 취소하기' : '참여 취소하기'}</button>`;
    else if (S.isMeetupFull(m)) action = '<p class="note">자리가 다 찼어요.</p>';
    else action = `<button type="button" class="btn" data-action="join-meetup" data-id="${esc(m.id)}">참여하기</button>`;
    return `
      <a class="back" href="#/">← 목록으로</a>
      <article class="card">
        <span class="chip format">${esc(S.MEETUP_FORMATS[m.format])}</span>
        <h1 style="margin-top:8px">${esc(m.title)}</h1>
        <dl class="facts">
          <dt>일시</dt><dd>${fmtDate(m.date)} ${esc(slotText(m.slot))}${S.isEventOption(m) ? ' ☕ 공강 이벤트 시간' : ''}</dd>
          <dt>장소</dt><dd>${esc(m.place)}</dd>
          <dt>인원</dt><dd>${m.memberIds.length}/${m.capacity}명</dd>
        </dl>
        <h2 style="margin-top:16px">멤버</h2>
        <ul class="members">${members}</ul>
        ${joined ? '' : '<p class="note">참여하면 멤버들의 연락처를 볼 수 있어요.</p>'}
        <div style="margin-top:12px">${action}</div>
        ${joined ? dutchPay({ people: m.memberIds.length, chatId: '' }) : ''}
      </article>`;
  }

  function viewMeetupNew() {
    if (!S.currentUser()) return '<div class="card"><p>로그인이 필요해요.</p><a class="btn" href="#/login">로그인</a></div>';
    const dates = [];
    const d = new Date(S.today() + 'T00:00:00');
    for (let i = 0; i < 21; i++) {
      if (S.DAYS.includes(WEEKDAY[d.getDay()])) {
        dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
      d.setDate(d.getDate() + 1);
    }
    return `
      <a class="back" href="#/">← 목록으로</a>
      <section class="card narrow">
        <h1>모집글 쓰기</h1>
        <form data-form="meetup" class="stack">
          <label>제목 <span class="sub">(40자 이내)</span><input name="title" maxlength="40" required placeholder="예: 공강에 학식 같이 먹을 사람!"></label>
          <fieldset><legend>모집 방식</legend><div class="checks">
            ${Object.entries(S.MEETUP_FORMATS).map(([k, v], i) => `<label class="radio"><input type="radio" name="format" value="${k}" ${i === 0 ? 'checked' : ''}> ${esc(v)}</label>`).join('')}
          </div></fieldset>
          <label>인원 (자유 모집일 때) <select name="capacity">${[2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === 4 ? 'selected' : ''}>${n}명</option>`).join('')}</select></label>
          <div class="inline two">
            <label>날짜<select name="date">${dates.map((iso) => `<option value="${iso}">${fmtDate(iso)}</option>`).join('')}</select></label>
            <label>시간<select name="slot">${S.SLOTS.map((s) => `<option value="${s.id}" ${s.id === 'h12' ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
          </div>
          <label>장소 <span class="sub">(30자 이내)</span><input name="place" maxlength="30" required placeholder="예: 학생식당, 한대앞역 근처"></label>
          <button class="btn" type="submit">모집 시작하기</button>
          <p class="note">수요일 13:00~15:00로 모으면 공강 이벤트 시간이에요 ☕</p>
        </form>
      </section>`;
  }

  // ---------- 겹치는 공강 ----------
  const rangeText = (r) => `${r.day} ${r.start}:00~${r.end}:00`;
  const matchOf = (profile) => {
    const me = S.currentUser();
    return me ? S.matchWith(me.id, profile) : null;
  };
  // 목록 카드: '🤝 공강 4시간 겹침 · 🍴 마라탕'
  function matchBadge(profile) {
    const m = matchOf(profile);
    if (!m || (!m.hours && !m.sharedFoods.length)) return '';
    const parts = [];
    if (m.hours) parts.push(`🤝 공강 ${m.hours}시간 겹침`);
    if (m.sharedFoods.length) parts.push(`🍴 ${m.sharedFoods.map(esc).join(', ')}`);
    return `<div class="match-chip">${parts.join(' · ')}</div>`;
  }
  // 섹션 안에서 나와 잘 맞는 사람이 먼저 오도록 정렬 (로그인 안 했으면 그대로)
  const byMatch = (items) => {
    if (!S.currentUser()) return items;
    return items
      .map((x) => ({ x, s: matchOf(x.profile).score }))
      .sort((a, b) => b.s - a.s)
      .map((o) => o.x);
  };
  // 상세 화면: 나와 겹치는 공강
  function overlapRow(profile) {
    const me = S.currentUser();
    if (!me || me.id === profile.userId) return '';
    const m = matchOf(profile);
    const body = m.overlap.length
      ? `<div class="chips">${m.overlap.map((r) => `<span class="chip match">${esc(rangeText(r))}</span>`).join('')}</div>`
      : !S.myFreeTime(me.id).length
        ? '<span class="note"><a href="#/profile">내 시간표</a>를 등록하면 겹치는 공강을 찾아드려요.</span>'
        : '<span class="note">2시간 이상 겹치는 공강이 없어요.</span>';
    return `<dt>🤝 나와 겹치는 공강</dt><dd>${body}</dd>`;
  }
  // 신청 화면: 겹치는 공강으로 추천 일시 채우기
  function recommendBox(profile) {
    const me = S.currentUser();
    if (!me) return '';
    const recs = S.recommendTimes(me.id, profile);
    if (!recs.length) return '';
    const list = recs.map((r) => `${fmtDate(r.date)} ${slotText(r.slot)}${S.isEventOption(r) ? ' ☕' : ''}`).join(', ');
    return `<div class="recommend">
        <p>⭐ 시간표로 찾은 추천 일시: <b>${esc(list)}</b></p>
        <button type="button" class="btn small" data-action="fill-recommend">추천 일시로 채우기</button>
      </div>`;
  }

  // ---------- 알레르기 ----------
  function allergyEditor(p) {
    const mine = p.allergies || [];
    const others = mine.filter((a) => !S.ALLERGENS.includes(a));
    return `
      <fieldset><legend>⚠️ 알레르기 <span class="sub">(메뉴 고를 때 상대가 참고해요)</span></legend>
        <div class="checks">${S.ALLERGENS.map(
          (a) => `<label class="check"><input type="checkbox" name="allergy" value="${esc(a)}" ${mine.includes(a) ? 'checked' : ''}> ${esc(a)}</label>`
        ).join('')}</div>
        <input name="allergyOther" value="${esc(others.join(', '))}" placeholder="기타 (쉼표로 구분, 예: 오이, 고수)" aria-label="기타 알레르기" style="margin-top:8px">
      </fieldset>`;
  }
  const allergyNote = (profile, who) =>
    (profile.allergies || []).length
      ? `<p class="allergy-note">⚠️ ${esc(who)}는 <b>${profile.allergies.map(esc).join(', ')}</b> 알레르기가 있어요. 메뉴 고를 때 참고해 주세요.</p>`
      : '';

  // ---------- 시간표 올리기 ----------
  // 수업 칸을 눌러 표시하면 공강 시간을 계산해 '가능한 시간'에 채울 수 있음. 시간표 캡처 이미지도 첨부 가능
  function timetableEditor(p) {
    const tt = p.timetable || { classes: [], image: null };
    const isClass = (day, h) => tt.classes.some((c) => c.day === day && c.start <= h && h < c.end);
    const hours = Array.from({ length: S.TIMETABLE_END - S.TIMETABLE_START }, (_, i) => S.TIMETABLE_START + i);
    const grid = `
      <div class="tt-grid" role="grid" aria-label="주간 시간표">
        <div class="tt-corner"></div>${S.DAYS.map((d) => `<div class="tt-day">${d}</div>`).join('')}
        ${hours
          .map(
            (h) => `<div class="tt-hour">${h}시</div>${S.DAYS.map(
              (d) => `<button type="button" class="tt-cell ${isClass(d, h) ? 'on' : ''}" data-action="toggle-cell" data-day="${d}" data-hour="${h}" aria-pressed="${isClass(d, h)}" aria-label="${d} ${h}시 수업"></button>`
            ).join('')}`
          )
          .join('')}
      </div>`;
    return `
      <fieldset class="tt-editor"><legend>내 시간표</legend>
        <p class="sub">수업이 있는 칸을 눌러 칠해 주세요. 그다음 '공강 시간으로 채우기'를 누르면 아래 가능한 시간이 자동으로 채워져요.</p>
        ${grid}
        <div class="inline wrap tt-actions">
          <button type="button" class="btn ghost small" data-action="fill-free">🍱 공강 시간으로 채우기</button>
          <button type="button" class="link-btn" data-action="clear-cells">시간표 비우기</button>
        </div>
        <div class="tt-image">
          <label class="file-label">시간표 이미지 첨부 <span class="sub">(에브리타임 캡처 등, 선택)</span>
            <input type="file" accept="image/*" data-action-change="tt-image">
          </label>
          <input type="hidden" name="ttimage" value="${esc(tt.image || '')}">
          <div class="tt-preview">${tt.image ? `<img src="${esc(tt.image)}" alt="내 시간표 이미지"><button type="button" class="link-btn" data-action="remove-tt-image">이미지 삭제</button>` : ''}</div>
        </div>
      </fieldset>`;
  }

  // 시간표 칸 → 요일별 수업 구간
  function classesFromGrid(form) {
    const on = [...form.querySelectorAll('.tt-cell.on')].map((c) => ({ day: c.dataset.day, start: Number(c.dataset.hour), end: Number(c.dataset.hour) + 1 }));
    return S.mergeRanges(on);
  }

  // 이미지를 가로 900px 이하 JPEG로 줄여서 data URL로 만듦 (브라우저 저장 공간 절약)
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const scale = Math.min(1, 900 / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- 내 프로필 ----------
  function viewProfile() {
    const me = S.currentUser();
    const p = S.getProfile(me.id) || { bio: '', avail: [], isPublic: false };
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
            <label>출생연도${birthSelect(me.birthYear)}</label>
          </div>
          <label>연락처 <span class="sub">(밥약이 수락된 상대에게만 보여요)</span><input name="contact" value="${esc(me.contact)}" placeholder="예: 카카오톡 오픈채팅 링크 또는 인스타그램 @아이디"></label>
          <button class="btn" type="submit">기본 정보 저장</button>
        </form>
      </section>
      <section class="card">
        <h2>내 밥약 프로필</h2>
        <p class="sub">공개하면 다른 학생들이 목록에서 보고 신청할 수 있어요. 새내기도 밥친구 프로필을 만들 수 있어요.</p>
        <form data-form="senior" class="stack">
          <fieldset><legend>어떤 프로필인가요?</legend>
            <div class="checks">
              <label class="radio"><input type="radio" name="kind" value="senior" ${S.kindOf(p) === 'senior' ? 'checked' : ''}> 🧑‍🏫 선배로 후배 밥약 받기</label>
              <label class="radio"><input type="radio" name="kind" value="buddy" ${S.kindOf(p) === 'buddy' ? 'checked' : ''}> 🍚 같이 먹을 밥친구 찾기</label>
            </div>
          </fieldset>
          <label class="switch"><input type="checkbox" name="isPublic" ${p.isPublic ? 'checked' : ''}> 목록에 프로필 공개하기</label>
          <label>자기소개 (${S.BIO_MAX}자 이내)<textarea name="bio" rows="4" maxlength="${S.BIO_MAX}" placeholder="전공, 동아리, 나눌 수 있는 이야기를 적어 주세요.">${esc(p.bio)}</textarea></label>
          <label>🍴 좋아하는 메뉴 <span class="sub">(쉼표로 구분, ${S.FOODS_MAX}개까지)</span>
            <input name="foods" value="${esc((p.foods || []).join(', '))}" placeholder="예: 돈까스, 마라탕, 쌀국수"></label>
          <label>📍 추천 맛집 <span class="sub">(한 줄에 한 곳, ${S.SPOTS_MAX}곳까지)</span>
            <textarea name="spots" rows="3" placeholder="예: 학교 앞 돈까스집 - 치즈돈까스 추천&#10;학생식당 2층 - 금요일 특식">${esc((p.spots || []).join('\n'))}</textarea></label>
          ${allergyEditor(p)}
          ${timetableEditor(p)}
          <fieldset class="avail-editor"><legend>가능한 시간</legend>
            <p class="sub">요일마다 밥약 가능한 시간을 하나씩 따로 추가하세요. 겹치는 시간은 저장할 때 하나로 합쳐져요.</p>
            <div class="avail-rows">${(p.avail || []).map(availRow).join('')}</div>
            <button type="button" class="btn ghost small" data-action="add-range">+ 시간 추가</button>
          </fieldset>
          <button class="btn" type="submit">밥약 프로필 저장</button>
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
          <button class="btn ghost" type="button" data-action="demo" data-id="u_j1" data-next="${esc(next)}">후배로 체험 (박정환, 26학번 새내기)</button>
          <button class="btn ghost" type="button" data-action="demo" data-id="u_s1" data-next="${esc(next)}">선배로 체험 (김민준, 23학번)</button>
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
            <label>출생연도${birthSelect(0)}</label>
          </div>
          <label>연락처 <span class="sub">(수락된 상대에게만 공개)</span><input name="contact" placeholder="예: 카카오톡 오픈채팅 링크 또는 인스타그램 @아이디"></label>
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
    const needsLogin = ['my', 'profile', 'notifications', 'chat'];

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
      case 'event': html = viewEvent(); break;
      case 'food': html = viewFood(); break;
      case 'chat': html = viewChat(parts[1]); active = 'my'; break;
      case 'meetup': html = parts[1] === 'new' ? viewMeetupNew() : viewMeetup(parts[1]); active = 'list'; break;
      case 'login': html = viewLogin(params); break;
      case 'signup': html = viewSignup(params); active = 'login'; break;
      default: html = '<div class="card"><p>없는 페이지예요.</p><a class="btn ghost" href="#/">홈으로</a></div>';
    }
    app.innerHTML = html;
    renderNav(active);
    renderResults();
    window.scrollTo(0, 0);
    scrollChatToBottom();
  }

  function scrollChatToBottom() {
    const box = document.getElementById('messages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  // ---------- 이벤트 ----------
  // 시간표 이미지 선택 → 줄여서 미리보기, 저장은 '밥약 프로필 저장'을 눌러야 됨
  document.addEventListener('change', async (e) => {
    if (e.target.dataset.actionChange !== 'tt-image' || !e.target.files[0]) return;
    const box = e.target.closest('.tt-image');
    try {
      const url = await shrinkImage(e.target.files[0]);
      box.querySelector('input[name=ttimage]').value = url;
      box.querySelector('.tt-preview').innerHTML =
        `<img src="${url}" alt="내 시간표 이미지"><button type="button" class="link-btn" data-action="remove-tt-image">이미지 삭제</button>`;
      toast('시간표 이미지를 불러왔어요. 저장 버튼을 눌러야 반영돼요.');
    } catch (err) {
      toast('이미지를 읽지 못했어요. 다른 파일로 시도해 주세요.');
    }
    e.target.value = '';
  });

  // 대화 입력창: Enter로 보내기, Shift+Enter는 줄바꿈 (한글 조합 중에는 보내지 않음)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const box = e.target.closest('.composer textarea');
    if (!box) return;
    e.preventDefault();
    box.form.requestSubmit();
  });

  // 신청 폼: 월을 바꾸면 일 선택지를, 일을 바꾸면 그날 가능한 시간대를 다시 채움.
  // '선택 안 함'이면 일·시간대를 끔
  document.addEventListener('change', (e) => {
    const { month: mi, day: di } = e.target.dataset;
    if (mi == null && di == null) return;
    const i = mi != null ? mi : di;
    const form = e.target.form;
    const day = form.querySelector(`[data-day="${i}"]`);
    const slot = form.querySelector(`[name="slot${i}"]`);
    if (mi != null) {
      const month = e.target.value;
      day.innerHTML = dayOptions(requestForm.dates || [], month);
      day.disabled = !month;
      slot.disabled = !month;
    }
    slot.innerHTML = slotOptions(requestForm.profile, day.disabled ? '' : day.value);
  });

  // 엔빵 계산기: 입력할 때마다 결과 갱신
  document.addEventListener('input', (e) => {
    const box = e.target.closest('.dutch-body');
    if (!box) return;
    const { total, people, memo } = readDutch(box);
    box.querySelector('.dutch-result').textContent = dutchText(total, people, memo) || '총 금액과 2명 이상 인원을 입력해 주세요.';
  });

  document.addEventListener('input', (e) => {
    const map = { 'f-q': 'q', 'f-dept': 'dept', 'f-day': 'day', 'f-slot': 'slot' };
    if (map[e.target.id]) {
      filters[map[e.target.id]] = e.target.value;
      renderResults();
    }
  });

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id, next } = el.dataset;
    if (action === 'menu-day') {
      // 학식 카드 안에서 요일 탭 전환
      const card = el.closest('.cafeteria');
      card.querySelectorAll('.day-tab').forEach((t) => {
        t.classList.toggle('active', t === el);
        t.setAttribute('aria-selected', t === el);
      });
      card.querySelectorAll('.menu').forEach((m) => (m.hidden = m.dataset.menuDay !== el.dataset.day));
      return;
    }
    if (action === 'quick-reply') {
      const form = document.querySelector('form[data-form="chat"]');
      return sendChat(form.dataset.id, el.dataset.text);
    }
    if (action === 'send-dutch') {
      const box = el.closest('.dutch-body');
      const { total, people, memo } = readDutch(box);
      const text = dutchText(total, people, memo);
      if (!text) return toast('총 금액과 2명 이상 인원을 입력해 주세요.');
      if (sendChat(box.dataset.chat, text)) toast('엔빵 결과를 대화방에 보냈어요.');
      return;
    }
    if (action === 'join-meetup') {
      if (!S.currentUser()) return go('#/login?next=' + encodeURIComponent('#/meetup/' + id));
      const err = S.joinMeetup(id);
      toast(err || '참여했어요! 멤버 연락처를 확인해 보세요.');
      return err ? route() : go('#/meetup/' + id);
    }
    if (action === 'leave-meetup') {
      const m = S.meetupById(id);
      const host = m && m.hostId === S.currentUser()?.id;
      if (!(await ask({ message: host ? '모집을 취소할까요? 참여한 멤버에게 알림이 가요.' : '참여를 취소할까요?', ok: host ? '모집 취소' : '참여 취소', danger: true }))) return;
      const err = S.leaveMeetup(id);
      toast(err || (host ? '모집을 취소했어요.' : '참여를 취소했어요.'));
      return route();
    }
    if (action === 'fill-recommend') {
      // 추천 일시를 희망 일시 1~3번 칸에 차례로 넣음 (월 → 일 → 시간대 순서로 바꿔야 선택지가 채워짐)
      const form = document.querySelector('form[data-form="request"]');
      const recs = S.recommendTimes(S.currentUser().id, requestForm.profile);
      const fire = (sel) => sel.dispatchEvent(new Event('change', { bubbles: true }));
      recs.forEach((r, i) => {
        const month = form.querySelector(`[data-month="${i}"]`);
        month.value = r.date.slice(0, 7);
        fire(month);
        const day = form.querySelector(`[data-day="${i}"]`);
        day.value = r.date;
        fire(day);
        form.querySelector(`[name="slot${i}"]`).value = r.slot;
      });
      toast(`추천 일시 ${recs.length}개를 채웠어요.`);
      return;
    }
    if (action === 'kind') {
      filters.kind = el.dataset.kind;
      filters.dept = '';
      route();
      return;
    }
    // 가능 시간 편집: 화면에서만 줄을 늘리고 줄이며, 저장 버튼을 눌러야 반영됨
    if (action === 'add-range') {
      el.previousElementSibling.insertAdjacentHTML('beforeend', availRow({ day: '월', start: 11, end: 13 }));
      return;
    }
    if (action === 'remove-range') {
      el.closest('.avail-row').remove();
      return;
    }
    if (action === 'toggle-cell') {
      el.classList.toggle('on');
      el.setAttribute('aria-pressed', el.classList.contains('on'));
      return;
    }
    if (action === 'clear-cells') {
      el.form.querySelectorAll('.tt-cell.on').forEach((c) => {
        c.classList.remove('on');
        c.setAttribute('aria-pressed', 'false');
      });
      return;
    }
    if (action === 'fill-free') {
      const form = el.form;
      const free = S.freeRanges(classesFromGrid(form));
      if (!free.length) return toast('2시간 이상 비는 공강 시간이 없어요.');
      form.querySelector('.avail-rows').innerHTML = free.map(availRow).join('');
      form.querySelector('.avail-editor').scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(`공강 시간 ${free.length}개로 채웠어요. 밥약이 어려운 시간은 ✕로 지워 주세요.`);
      return;
    }
    if (action === 'remove-tt-image') {
      const box = el.closest('.tt-image');
      box.querySelector('input[name=ttimage]').value = '';
      box.querySelector('.tt-preview').innerHTML = '';
      return;
    }
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
        if (!(await ask({ message: '이 신청을 거절할까요?', ok: '거절하기', danger: true }))) return;
        err = S.respond(id, false);
        if (!err) toast('신청을 거절했어요.');
        break;
      case 'cancel':
        if (!(await ask({ message: '신청을 취소할까요?', ok: '신청 취소', danger: true }))) return;
        err = S.cancel(id);
        if (!err) toast('신청을 취소했어요.');
        break;
      case 'report': {
        const reason = await ask({ message: '신고 사유를 적어 주세요.', input: '예: 약속 장소에 나오지 않았어요', ok: '신고하기', danger: true });
        if (!reason || !String(reason).trim()) return;
        S.report(id, reason);
        toast('신고가 접수됐어요.');
        return;
      }
      case 'block':
        if (!(await ask({ message: '차단하면 서로의 목록에서 보이지 않고, 진행 중인 신청은 취소돼요. 차단할까요?', ok: '차단하기', danger: true }))) return;
        S.block(id);
        toast('차단했어요.');
        go('#/');
        return;
      case 'reset':
        if (!(await ask({ message: '모든 데이터를 처음 상태로 되돌릴까요? 가입한 계정과 신청 내역이 지워져요.', ok: '초기화', danger: true }))) return;
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
          dept: d.dept, year: (d.year || '').trim(), birthYear: Number(d.birthYear), contact: d.contact || '',
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
      case 'meetup': {
        const res = S.createMeetup({
          title: d.title || '', format: d.format, date: d.date, slot: d.slot, place: d.place || '', capacity: Number(d.capacity),
        });
        if (typeof res === 'string') {
          err = res;
          break;
        }
        toast('모집글을 올렸어요!');
        return go(`#/meetup/${res.id}`);
      }
      case 'chat':
        sendChat(form.dataset.id, d.text || '');
        return;
      case 'respond':
        err = S.respond(form.dataset.id, true, Number(d.chosen));
        if (!err) {
          toast('밥약을 수락했어요! 연락처가 공개됐어요.');
          return route();
        }
        break;
      case 'user':
        err = S.updateUser({ name: d.name || '', dept: d.dept, year: (d.year || '').trim(), birthYear: Number(d.birthYear), contact: d.contact || '' });
        if (!err) toast('기본 정보를 저장했어요.');
        break;
      case 'senior':
        err = S.saveProfile({
          bio: d.bio || '',
          kind: d.kind || 'senior',
          foods: S.parseFoods(d.foods),
          spots: S.parseSpots(d.spots),
          allergies: [...new Set([...asArray(d.allergy), ...S.parseFoods(d.allergyOther)])],
          avail: asArray(d.aday).map((day, i) => ({ day, start: Number(asArray(d.astart)[i]), end: Number(asArray(d.aend)[i]) })),
          isPublic: 'isPublic' in d,
          timetable: { classes: classesFromGrid(form), image: d.ttimage || null },
        });
        if (!err) toast('밥약 프로필을 저장했어요.');
        break;
    }
    if (err) toast(err);
  });

  window.addEventListener('hashchange', route);
  route();
})();
