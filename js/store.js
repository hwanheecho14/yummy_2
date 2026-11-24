// 데이터 저장소: 모든 데이터는 브라우저 localStorage에 저장됩니다 (백엔드 없음).
(function () {
  const KEY = 'bapyak-db-v1';
  const DAY_MS = 864e5;

  const DAYS = ['월', '화', '수', '목', '금'];
  const SLOTS = [
    { id: 'breakfast', label: '아침', time: '8–10시' },
    { id: 'lunch', label: '점심', time: '11–14시' },
    { id: 'dinner', label: '저녁', time: '17–20시' },
  ];
  const DEPTS = ['컴퓨터공학과', '경영학과', '심리학과', '기계공학과', '디자인학과', '국어국문학과'];
  const MAX_PENDING_PER_SENIOR = 5; // 선배 한 명이 받을 수 있는 대기 중 신청 수
  const EXPIRE_DAYS = 7; // 응답이 없으면 자동 만료
  const BIO_MAX = 300;
  const MESSAGE_MAX = 200;

  let db = null;

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function isoDate(d) {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 6e4);
    return local.toISOString().slice(0, 10);
  }

  function plusDays(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }

  function today() {
    return isoDate(new Date());
  }

  async function hashPassword(pw) {
    const text = 'bapyak:' + pw;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // 보안 컨텍스트가 아닐 때의 대체 해시 (데모용)
    let h = 0;
    for (const ch of text) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
    return 'fallback-' + (h >>> 0).toString(16);
  }

  // ---------- 초기 더미 데이터 ----------
  function seed() {
    const now = Date.now();
    const user = (id, username, name, dept, year, contact) => ({
      id, username, name, dept, year, contact, pwHash: null, createdAt: now,
    });
    const users = [
      user('u_s1', 'demo_senior', '김민준', '컴퓨터공학과', '20', '카카오톡 오픈채팅 "민준 선배와 밥약"'),
      user('u_s2', 'seoyeon', '이서연', '경영학과', '21', '인스타그램 @seoyeon.demo'),
      user('u_s3', 'jiho', '박지호', '심리학과', '19', '카카오톡 오픈채팅 "지호 선배"'),
      user('u_s4', 'yujin', '최유진', '기계공학과', '21', '카카오톡 ID yujin_demo'),
      user('u_s5', 'haneul', '정하늘', '디자인학과', '20', '인스타그램 @haneul.design'),
      user('u_s6', 'doyoon', '강도윤', '컴퓨터공학과', '22', '카카오톡 ID doyoon_dev'),
      user('u_j1', 'demo_junior', '조새내', '컴퓨터공학과', '25', '카카오톡 ID saenae_25'),
      user('u_j2', 'yerin', '한예린', '경영학과', '25', '인스타그램 @yerin.25'),
    ];
    const profile = (userId, bio, days, slots) => ({ userId, bio, days, slots, isPublic: true });
    const profiles = [
      profile('u_s1', '백엔드 개발 동아리 운영진이에요. 전공 공부, 동아리, 인턴 준비까지 편하게 물어보세요!', ['월', '수', '금'], ['lunch', 'dinner']),
      profile('u_s2', '마케팅 공모전을 여러 번 나갔어요. 학교 앞 맛집은 제가 제일 잘 압니다.', ['화', '목'], ['lunch']),
      profile('u_s3', '심리학과 4학년, 대학원 진학 준비 중이에요. 진로 고민 같이 나눠요.', ['월', '화', '수'], ['dinner']),
      profile('u_s4', '자동차 동아리 활동 중! 전공 과목 선택 팁 알려드릴게요.', ['수', '목', '금'], ['breakfast', 'lunch']),
      profile('u_s5', '졸업 전시 준비 중이에요. 포트폴리오나 디자인 툴 얘기 좋아해요.', ['목', '금'], ['lunch', 'dinner']),
      profile('u_s6', '알고리즘 스터디장이에요. 코딩테스트, 복수전공 고민 상담 환영!', ['월', '화', '목'], ['lunch']),
    ];
    const requests = [
      {
        id: 'r_seed1', fromId: 'u_j2', toId: 'u_s1',
        options: [{ date: plusDays(2), slot: 'lunch' }, { date: plusDays(4), slot: 'dinner' }],
        message: '안녕하세요 선배님! 컴공 전과를 고민 중인데 이야기 들어보고 싶어요.',
        status: 'pending', chosen: null, createdAt: now - DAY_MS, respondedAt: null,
      },
      {
        id: 'r_seed2', fromId: 'u_j1', toId: 'u_s2',
        options: [{ date: plusDays(1), slot: 'lunch' }],
        message: '경영학 복수전공에 관심이 있어요. 밥 한번 같이 먹어요!',
        status: 'accepted', chosen: 0, createdAt: now - 2 * DAY_MS, respondedAt: now - DAY_MS,
      },
      {
        id: 'r_seed3', fromId: 'u_j1', toId: 'u_s3',
        options: [{ date: plusDays(3), slot: 'dinner' }, { date: plusDays(5), slot: 'dinner' }],
        message: '심리학 교양을 듣고 관심이 생겼어요.',
        status: 'pending', chosen: null, createdAt: now - 2 * DAY_MS, respondedAt: null,
      },
    ];
    const notifications = [
      { id: 'n_seed1', userId: 'u_s1', text: '한예린님이 밥약을 신청했어요.', link: '#/my?tab=received', read: false, createdAt: now - DAY_MS },
      { id: 'n_seed2', userId: 'u_j1', text: '이서연님이 밥약을 수락했어요. 연락처를 확인해 보세요.', link: '#/my?tab=sent', read: false, createdAt: now - DAY_MS },
    ];
    return { version: 1, users, profiles, requests, notifications, reports: [], blocks: [], session: null };
  }

  function load() {
    try {
      db = JSON.parse(localStorage.getItem(KEY));
    } catch (e) {
      db = null;
    }
    if (!db || db.version !== 1) {
      db = seed();
      save();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      /* 저장 불가 환경(사생활 보호 모드 등): 메모리에서만 동작 */
    }
  }

  // ---------- 사용자 ----------
  const userById = (id) => db.users.find((u) => u.id === id) || null;
  const currentUser = () => (db.session ? userById(db.session) : null);

  async function signup({ username, password, name, dept, year, contact }) {
    username = username.trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return '아이디는 영문, 숫자, _ 로 3~20자여야 해요.';
    if (db.users.some((u) => u.username === username)) return '이미 사용 중인 아이디예요.';
    if (password.length < 4) return '비밀번호는 4자 이상이어야 해요.';
    if (!name.trim()) return '이름을 입력해 주세요.';
    if (!/^\d{2}$/.test(year)) return '학번은 입학년도 두 자리로 입력해 주세요. (예: 25)';
    const u = {
      id: uid('u'), username, name: name.trim(), dept, year, contact: contact.trim(),
      pwHash: await hashPassword(password), createdAt: Date.now(),
    };
    db.users.push(u);
    db.session = u.id;
    save();
    return null;
  }

  async function login(username, password) {
    const u = db.users.find((x) => x.username === username.trim());
    if (!u || !u.pwHash || u.pwHash !== (await hashPassword(password))) return '아이디 또는 비밀번호가 맞지 않아요.';
    db.session = u.id;
    save();
    return null;
  }

  function loginAs(userId) {
    if (!userById(userId)) return;
    db.session = userId;
    save();
  }

  function logout() {
    db.session = null;
    save();
  }

  function updateUser(fields) {
    const u = currentUser();
    if (!u) return '로그인이 필요해요.';
    if (!fields.name.trim()) return '이름을 입력해 주세요.';
    if (!/^\d{2}$/.test(fields.year)) return '학번은 입학년도 두 자리로 입력해 주세요.';
    Object.assign(u, { name: fields.name.trim(), dept: fields.dept, year: fields.year, contact: fields.contact.trim() });
    save();
    return null;
  }

  // ---------- 선배 프로필 ----------
  const getProfile = (userId) => db.profiles.find((p) => p.userId === userId) || null;

  function saveProfile({ bio, days, slots, isPublic }) {
    const u = currentUser();
    if (!u) return '로그인이 필요해요.';
    if (bio.length > BIO_MAX) return `자기소개는 ${BIO_MAX}자 이내로 써 주세요.`;
    if (isPublic && !bio.trim()) return '공개하려면 자기소개를 써 주세요.';
    if (isPublic && (!days.length || !slots.length)) return '공개하려면 가능한 요일과 시간대를 하나 이상 골라 주세요.';
    let p = getProfile(u.id);
    if (!p) {
      p = { userId: u.id };
      db.profiles.push(p);
    }
    Object.assign(p, { bio: bio.trim(), days, slots, isPublic });
    save();
    return null;
  }

  // ---------- 차단·신고 ----------
  const isBlocked = (a, b) => db.blocks.some((x) => (x.userId === a && x.targetId === b) || (x.userId === b && x.targetId === a));

  function block(targetId) {
    const u = currentUser();
    if (!u || isBlocked(u.id, targetId)) return;
    db.blocks.push({ userId: u.id, targetId, createdAt: Date.now() });
    // 진행 중인 신청은 취소 처리
    db.requests.forEach((r) => {
      const between = (r.fromId === u.id && r.toId === targetId) || (r.fromId === targetId && r.toId === u.id);
      if (between && r.status === 'pending') r.status = 'cancelled';
    });
    save();
  }

  function report(targetId, reason) {
    const u = currentUser();
    if (!u) return;
    db.reports.push({ id: uid('rp'), reporterId: u.id, targetId, reason: reason.trim(), createdAt: Date.now() });
    save();
  }

  // ---------- 선배 목록 ----------
  function publicSeniors() {
    const me = currentUser();
    return db.profiles
      .filter((p) => p.isPublic)
      .map((p) => ({ user: userById(p.userId), profile: p }))
      .filter((x) => x.user && (!me || (x.user.id !== me.id && !isBlocked(me.id, x.user.id))));
  }

  // ---------- 밥약 신청 ----------
  const activeRequest = (fromId, toId) =>
    db.requests.find((r) => r.fromId === fromId && r.toId === toId && (r.status === 'pending' || r.status === 'accepted')) || null;

  const pendingCountFor = (seniorId) => db.requests.filter((r) => r.toId === seniorId && r.status === 'pending').length;

  function notify(userId, text, link) {
    db.notifications.push({ id: uid('n'), userId, text, link, read: false, createdAt: Date.now() });
  }

  function createRequest(toId, options, message) {
    const me = currentUser();
    if (!me) return '로그인이 필요해요.';
    if (me.id === toId) return '자기 자신에게는 신청할 수 없어요.';
    const p = getProfile(toId);
    if (!p || !p.isPublic) return '지금은 신청을 받지 않는 선배예요.';
    if (isBlocked(me.id, toId)) return '신청할 수 없는 사용자예요.';
    if (activeRequest(me.id, toId)) return '이 선배에게 이미 진행 중인 신청이 있어요.';
    if (pendingCountFor(toId) >= MAX_PENDING_PER_SENIOR) return '이 선배는 지금 신청이 많이 밀려 있어요. 나중에 다시 시도해 주세요.';
    if (!options.length) return '희망 일시를 하나 이상 골라 주세요.';
    if (options.some((o) => o.date < today())) return '지난 날짜는 고를 수 없어요.';
    if (message.length > MESSAGE_MAX) return `한마디는 ${MESSAGE_MAX}자 이내로 써 주세요.`;
    db.requests.push({
      id: uid('r'), fromId: me.id, toId, options, message: message.trim(),
      status: 'pending', chosen: null, createdAt: Date.now(), respondedAt: null,
    });
    notify(toId, `${me.name}님이 밥약을 신청했어요.`, '#/my?tab=received');
    save();
    return null;
  }

  function respond(requestId, accept, chosen) {
    const me = currentUser();
    const r = db.requests.find((x) => x.id === requestId);
    if (!me || !r || r.toId !== me.id || r.status !== 'pending') return '처리할 수 없는 신청이에요.';
    if (accept && !(chosen >= 0 && chosen < r.options.length)) return '확정할 일시를 골라 주세요.';
    r.status = accept ? 'accepted' : 'rejected';
    r.chosen = accept ? chosen : null;
    r.respondedAt = Date.now();
    notify(
      r.fromId,
      accept ? `${me.name}님이 밥약을 수락했어요. 연락처를 확인해 보세요.` : `${me.name}님이 이번 밥약은 어렵다고 했어요.`,
      '#/my?tab=sent'
    );
    save();
    return null;
  }

  function cancel(requestId) {
    const me = currentUser();
    const r = db.requests.find((x) => x.id === requestId);
    if (!me || !r || r.fromId !== me.id || r.status !== 'pending') return '취소할 수 없는 신청이에요.';
    r.status = 'cancelled';
    save();
    return null;
  }

  function expireOld() {
    const limit = Date.now() - EXPIRE_DAYS * DAY_MS;
    let changed = false;
    db.requests.forEach((r) => {
      if (r.status === 'pending' && r.createdAt < limit) {
        r.status = 'expired';
        notify(r.fromId, `${userById(r.toId)?.name || '선배'}님이 ${EXPIRE_DAYS}일 동안 응답하지 않아 신청이 만료됐어요.`, '#/my?tab=sent');
        changed = true;
      }
    });
    if (changed) save();
  }

  function requestsOf(userId) {
    const sorted = db.requests.slice().sort((a, b) => b.createdAt - a.createdAt);
    return {
      sent: sorted.filter((r) => r.fromId === userId),
      received: sorted.filter((r) => r.toId === userId),
    };
  }

  // ---------- 알림 ----------
  const notificationsOf = (userId) =>
    db.notifications.filter((n) => n.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
  const unreadCount = (userId) => db.notifications.filter((n) => n.userId === userId && !n.read).length;

  function markAllRead(userId) {
    db.notifications.forEach((n) => {
      if (n.userId === userId) n.read = true;
    });
    save();
  }

  function reset() {
    db = seed();
    save();
  }

  load();

  window.Store = {
    DAYS, SLOTS, DEPTS, MAX_PENDING_PER_SENIOR, EXPIRE_DAYS, BIO_MAX, MESSAGE_MAX,
    today, userById, currentUser, signup, login, loginAs, logout, updateUser,
    getProfile, saveProfile, publicSeniors, isBlocked, block, report,
    activeRequest, pendingCountFor, createRequest, respond, cancel, expireOld, requestsOf,
    notificationsOf, unreadCount, markAllRead, reset,
  };
})();
