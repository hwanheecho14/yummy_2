// 데이터 저장소: 모든 데이터는 브라우저 localStorage에 저장됩니다 (백엔드 없음).
(function () {
  const KEY = 'bapyak-db-v4';
  const DB_VERSION = 4;
  const DAY_MS = 864e5;

  const DAYS = ['월', '화', '수', '목', '금'];
  // 2시간짜리 밥약 시간대를 1시간 간격으로: 8:00~10:00, 9:00~11:00, ..., 18:00~20:00
  const SLOTS = Array.from({ length: 11 }, (_, i) => {
    const start = 8 + i;
    return { id: 'h' + start, start, label: `${start}:00~${start + 2}:00` };
  });
  // 예전 시간대(아침/점심/저녁)를 새 시간대로 바꿀 때 사용
  const LEGACY = { breakfast: ['h8'], lunch: ['h11', 'h12', 'h13'], dinner: ['h17', 'h18'] };
  const expandSlots = (ids) => [...new Set(ids.flatMap((id) => LEGACY[id] || [id]))];
  // 한양대학교 ERICA 단과대학·학과 (출처: studyerica.hanyang.ac.kr 학과안내, 2026년 기준)
  const COLLEGES = [
    { name: '공학대학', depts: ['건축학부', '건설환경공학과', '교통∙물류공학과', '전자공학부', '재료화학공학과', '기계공학과', '산업경영공학과', '생명나노공학과', '로봇공학과'] },
    { name: '소프트웨어융합대학', depts: ['컴퓨터학부', '인공지능학과', 'ICT융합학부'] },
    { name: '과학기술융합대학', depts: ['수리데이터사이언스학과', '응용물리학과', '의약생명과학과', '화학분자공학과', '해양융합공학과', '나노광전자학과'] },
    { name: '국제문화대학', depts: ['한국언어문학과', '문화콘텐츠학과', '문화인류학과', '중국학과', '일본학과', '영미언어문화학과', '프랑스학과'] },
    { name: '언론정보대학', depts: ['광고홍보학과', '정보사회미디어학과'] },
    { name: '경상대학', depts: ['경영학부', '경제학부'] },
    { name: '디자인대학', depts: ['주얼리패션디자인학과', '산업디자인학과', '커뮤니케이션디자인학과', '영상디자인학과'] },
    { name: '예체능대학', depts: ['스포츠과학부', '무용예술학과', '실용음악학과'] },
    { name: '약학대학', depts: ['약학과'] },
  ];
  const DEPTS = COLLEGES.flatMap((c) => c.depts);
  const collegeOf = (dept) => (COLLEGES.find((c) => c.depts.includes(dept)) || {}).name || '';
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

  const weekday = (iso) => '일월화수목금토'[new Date(iso + 'T00:00:00').getDay()];

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
      user('u_s1', 'demo_senior', '김민준', '컴퓨터학부', '20', '카카오톡 오픈채팅 "민준 선배와 밥약"'),
      user('u_s2', 'seoyeon', '이서연', '경영학부', '21', '인스타그램 @seoyeon.demo'),
      user('u_s3', 'jiho', '박지호', '문화인류학과', '19', '카카오톡 오픈채팅 "지호 선배"'),
      user('u_s4', 'yujin', '최유진', '기계공학과', '21', '카카오톡 ID yujin_demo'),
      user('u_s5', 'haneul', '정하늘', '산업디자인학과', '20', '인스타그램 @haneul.design'),
      user('u_s6', 'doyoon', '강도윤', '컴퓨터학부', '22', '카카오톡 ID doyoon_dev'),
      user('u_s7', 'sujin', '윤수진', '인공지능학과', '21', '카카오톡 ID sujin_ai'),
      user('u_s8', 'taeho', '임태호', 'ICT융합학부', '20', '인스타그램 @taeho.ict'),
      user('u_s9', 'jimin', '서지민', '컴퓨터학부', '21', '카카오톡 오픈채팅 "지민 선배 밥약"'),
      user('u_s10', 'hyunwoo', '오현우', '전자공학부', '19', '카카오톡 ID hyunwoo_ee'),
      user('u_s11', 'nayeon', '신나연', '건축학부', '20', '인스타그램 @nayeon.arch'),
      user('u_s12', 'seungmin', '권승민', '로봇공학과', '21', '카카오톡 ID seungmin_robot'),
      user('u_s13', 'dahye', '황다혜', '산업경영공학과', '22', '카카오톡 ID dahye_ime'),
      user('u_s14', 'minseo', '배민서', '경제학부', '20', '인스타그램 @minseo.econ'),
      user('u_s15', 'eunji', '송은지', '광고홍보학과', '21', '인스타그램 @eunji.ad'),
      user('u_s16', 'junho', '류준호', '정보사회미디어학과', '20', '카카오톡 ID junho_media'),
      user('u_s17', 'chaeyoung', '문채영', '일본학과', '21', '카카오톡 ID chaeyoung_jp'),
      user('u_s18', 'sihyun', '백시현', '스포츠과학부', '20', '인스타그램 @sihyun.sports'),
      user('u_s19', 'yuna', '조유나', '약학과', '19', '카카오톡 ID yuna_pharm'),
      user('u_s20', 'gunwoo', '남건우', '수리데이터사이언스학과', '21', '카카오톡 ID gunwoo_data'),
      user('u_s21', 'sohee', '안소희', '커뮤니케이션디자인학과', '22', '인스타그램 @sohee.design'),
      user('u_s22', 'jaewon', '홍재원', '재료화학공학과', '20', '카카오톡 ID jaewon_mce'),
      user('u_j1', 'demo_junior', '조새내', '컴퓨터학부', '25', '카카오톡 ID saenae_25'),
      user('u_j2', 'yerin', '한예린', '경영학부', '25', '인스타그램 @yerin.25'),
    ];
    const profile = (userId, bio, days, slots) => ({ userId, bio, days, slots: expandSlots(slots), isPublic: true });
    const profiles = [
      profile('u_s1', '백엔드 개발 동아리 운영진이에요. 전공 공부, 동아리, 인턴 준비까지 편하게 물어보세요!', ['월', '수', '금'], ['lunch', 'dinner']),
      profile('u_s2', '마케팅 공모전을 여러 번 나갔어요. 학교 앞 맛집은 제가 제일 잘 압니다.', ['화', '목'], ['lunch']),
      profile('u_s3', '문화인류학과 4학년, 대학원 진학 준비 중이에요. 진로 고민 같이 나눠요.', ['월', '화', '수'], ['dinner']),
      profile('u_s4', '자동차 동아리 활동 중! 전공 과목 선택 팁 알려드릴게요.', ['수', '목', '금'], ['breakfast', 'lunch']),
      profile('u_s5', '졸업 전시 준비 중이에요. 포트폴리오나 디자인 툴 얘기 좋아해요.', ['목', '금'], ['lunch', 'dinner']),
      profile('u_s6', '알고리즘 스터디장이에요. 코딩테스트, 복수전공 고민 상담 환영!', ['월', '화', '목'], ['lunch']),
      profile('u_s7', '머신러닝 연구실 학부연구생이에요. AI 대학원이나 연구실 생활이 궁금하면 물어보세요.', ['화', '수', '목'], ['lunch', 'dinner']),
      profile('u_s8', '웹·앱 서비스 기획과 디자인을 같이 하고 있어요. 팀플 꿀팁 알려드릴게요.', ['수', '금'], ['lunch']),
      profile('u_s9', '교내 해커톤 2회 수상! 첫 프로젝트 시작하는 법 같이 이야기해요.', ['월', '수'], ['lunch', 'dinner']),
      profile('u_s10', '반도체 회사 인턴 다녀왔어요. 전자공학 진로와 대외활동 얘기 환영해요.', ['화', '목'], ['dinner']),
      profile('u_s11', '5년제 건축학 전공, 설계 스튜디오 밤샘 버티는 법 알려드려요.', ['수', '목'], ['lunch']),
      profile('u_s12', '로봇 대회 동아리 회장이에요. 하드웨어 좋아하는 후배 대환영!', ['월', '수', '금'], ['breakfast', 'lunch']),
      profile('u_s13', '데이터 분석 공모전 준비 중이에요. 복수전공·교환학생 이야기 나눠요.', ['화', '수'], ['lunch']),
      profile('u_s14', '경제학부 학회 활동 중이에요. 금융권 취업 준비 이야기 편하게 해요.', ['월', '목'], ['dinner']),
      profile('u_s15', '광고 공모전 수상 경험 있어요. 포트폴리오, 동아리 고민 들어드릴게요.', ['수', '금'], ['lunch', 'dinner']),
      profile('u_s16', '학보사 기자 출신이에요. 글쓰기와 언론사 대외활동 이야기 좋아해요.', ['화', '수'], ['lunch']),
      profile('u_s17', '일본 교환학생 다녀왔어요. JLPT, 교환 준비 팁 알려드릴게요.', ['월', '수'], ['lunch']),
      profile('u_s18', '교내 축구 동아리 주장이에요. 운동하면서 학교생활 즐기는 법 공유해요.', ['수', '목', '금'], ['breakfast', 'dinner']),
      profile('u_s19', '약대 생활과 실습 이야기 궁금하면 언제든 신청하세요.', ['수'], ['lunch']),
      profile('u_s20', '통계·데이터 분석 스터디 운영 중! 수학 과목 공부법 알려드려요.', ['월', '화', '수'], ['lunch']),
      profile('u_s21', '브랜딩 디자인 외주 경험 있어요. 툴 배우는 순서 같이 정해봐요.', ['수', '목'], ['lunch', 'dinner']),
      profile('u_s22', '배터리 소재 연구실 학부연구생이에요. 연구실 컨택 방법 알려드릴게요.', ['화', '수', '금'], ['lunch']),
    ];
    const requests = [
      {
        id: 'r_seed1', fromId: 'u_j2', toId: 'u_s1',
        options: [{ date: plusDays(2), slot: 'h12' }, { date: plusDays(4), slot: 'h18' }],
        message: '안녕하세요 선배님! 컴퓨터학부 복수전공을 고민 중인데 이야기 들어보고 싶어요.',
        status: 'pending', chosen: null, createdAt: now - DAY_MS, respondedAt: null,
      },
      {
        id: 'r_seed2', fromId: 'u_j1', toId: 'u_s2',
        options: [{ date: plusDays(1), slot: 'h12' }],
        message: '경영학 복수전공에 관심이 있어요. 밥 한번 같이 먹어요!',
        status: 'accepted', chosen: 0, createdAt: now - 2 * DAY_MS, respondedAt: now - DAY_MS,
      },
      {
        id: 'r_seed3', fromId: 'u_j1', toId: 'u_s3',
        options: [{ date: plusDays(3), slot: 'h18' }, { date: plusDays(5), slot: 'h18' }],
        message: '문화인류학 교양을 듣고 관심이 생겼어요.',
        status: 'pending', chosen: null, createdAt: now - 2 * DAY_MS, respondedAt: null,
      },
    ];
    const notifications = [
      { id: 'n_seed1', userId: 'u_s1', text: '한예린님이 밥약을 신청했어요.', link: '#/my?tab=received', read: false, createdAt: now - DAY_MS },
      { id: 'n_seed2', userId: 'u_j1', text: '이서연님이 밥약을 수락했어요. 연락처를 확인해 보세요.', link: '#/my?tab=sent', read: false, createdAt: now - DAY_MS },
    ];
    return { version: DB_VERSION, users, profiles, requests, notifications, reports: [], blocks: [], session: null };
  }

  function load() {
    try {
      db = JSON.parse(localStorage.getItem(KEY));
    } catch (e) {
      db = null;
    }
    if (!db || db.version !== DB_VERSION) {
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
    if (!DEPTS.includes(dept)) return '학과를 선택해 주세요.';
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
    if (options.some((o) => !p.slots.includes(o.slot))) return '선배가 가능한 시간대 중에서 골라 주세요.';
    if (options.some((o) => !p.days.includes(weekday(o.date)))) return '선배가 가능한 요일 중에서 골라 주세요.';
    if (new Set(options.map((o) => o.date + o.slot)).size !== options.length) return '같은 일시를 두 번 고를 수 없어요.';
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
    if (accept && isEventOption(r.options[chosen])) {
      const text = '☕ 수요일 공강 밥약이 확정돼서 커피 기프티콘 이벤트에 응모됐어요!';
      notify(r.fromId, text, '#/event');
      notify(r.toId, text, '#/event');
    }
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

  // ---------- 수요일 공강 커피 이벤트 ----------
  // 매주 수요일 13:00~15:00은 학교 전체 공강 시간. 이 시간으로 밥약이 확정되면 두 사람 모두 커피 기프티콘 추첨에 응모됩니다.
  const EVENT = { day: '수', slot: 'h13', label: '수요일 13:00~15:00' };
  function isEventOption(o) {
    return !!o && o.slot === EVENT.slot && weekday(o.date) === EVENT.day;
  }
  const isEventRequest = (r) => r.status === 'accepted' && isEventOption(r.options[r.chosen]);
  const eventEntriesOf = (userId) => db.requests.filter((r) => (r.fromId === userId || r.toId === userId) && isEventRequest(r));
  const eventEntryCount = () => db.requests.filter(isEventRequest).length;
  const supportsEvent = (profile) => profile.days.includes(EVENT.day) && profile.slots.includes(EVENT.slot);

  load();

  window.Store = {
    DAYS, SLOTS, COLLEGES, DEPTS, collegeOf, MAX_PENDING_PER_SENIOR, EXPIRE_DAYS, BIO_MAX, MESSAGE_MAX,
    today, userById, currentUser, signup, login, loginAs, logout, updateUser,
    getProfile, saveProfile, publicSeniors, isBlocked, block, report,
    activeRequest, pendingCountFor, createRequest, respond, cancel, expireOld, requestsOf,
    notificationsOf, unreadCount, markAllRead, reset,
    EVENT, isEventOption, eventEntriesOf, eventEntryCount, supportsEvent,
  };
})();
