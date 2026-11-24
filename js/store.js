// 데이터 저장소: 모든 데이터는 브라우저 localStorage에 저장됩니다 (백엔드 없음).
(function () {
  const KEY = 'bapyak-db-v10';
  const DB_VERSION = 10;
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

  // ---------- 가능 시간 (요일별 시간 구간) ----------
  // 선배는 '수 11:00~15:00'처럼 요일마다 가능한 구간을 따로 추가합니다.
  // 화면에는 겹치는 구간을 합쳐서 보여주고, 신청할 때는 그 안에서 2시간짜리 시간대를 고릅니다.
  const HOUR_MIN = 8;
  const HOUR_MAX = 20;
  const MIN_RANGE = 2;

  // 같은 요일의 겹치거나 맞닿은 구간을 하나로 합침
  function mergeRanges(avail) {
    const out = [];
    DAYS.forEach((day) => {
      const list = (avail || []).filter((a) => a.day === day).sort((a, b) => a.start - b.start);
      list.forEach((a) => {
        const last = out[out.length - 1];
        if (last && last.day === day && a.start <= last.end) last.end = Math.max(last.end, a.end);
        else out.push({ day, start: a.start, end: a.end });
      });
    });
    return out;
  }
  const availDays = (p) => DAYS.filter((d) => (p.avail || []).some((a) => a.day === d));
  // 그 요일에 들어가는 2시간짜리 시간대 id 목록 (1시간 간격)
  const windowsOn = (p, day) =>
    SLOTS.filter((s) => mergeRanges(p.avail).some((r) => r.day === day && r.start <= s.start && s.start + 2 <= r.end)).map((s) => s.id);
  const hasWindow = (p, slotId) => DAYS.some((d) => windowsOn(p, d).includes(slotId));
  // 예전 형식(요일 목록 × 시간대 목록)을 요일별 구간으로 바꿈
  const rangesFrom = (days, slotIds) =>
    mergeRanges(days.flatMap((day) => expandSlots(slotIds).map((id) => ({ day, start: Number(id.slice(1)), end: Number(id.slice(1)) + 2 }))));
  // 한양대학교 ERICA 단과대학·학과 (2025학년도 학제 개편 이후 10개 단과대학)
  // 출처: 한양대학교 ERICA 2026학년도 신입학 전형계획 모집단위 (goerica.hanyang.ac.kr/upload/GUIDES/2026_plan_02.pdf)
  //       디자인대학 세부 학과는 모집요강의 '디자인계열'을 학과 단위로 나눈 것
  // 지능형시스템공학과: 팀원 소속 학과라 추가 (위 모집단위 표에는 없음)
  const COLLEGES = [
    {
      name: '공학대학',
      depts: ['건축학부', '건설환경공학과', '교통·물류공학과', '전자공학부', '배터리소재화학공학과', '기계공학과', '산업경영공학과',
        '로봇공학과', '에너지바이오학과', '해양융합공학과', '융합시스템공학과', '스마트융합공학부', '지능형시스템공학과'],
    },
    { name: '소프트웨어융합대학', depts: ['컴퓨터학부', 'ICT융합학부', '인공지능학과', '수리데이터사이언스학과'] },
    { name: '약학대학', depts: ['약학과'] },
    { name: '첨단융합대학', depts: ['차세대반도체융합공학부', '바이오신약융합학부', '지능정보양자공학전공', '국방전략기술공학과'] },
    { name: '글로벌문화통상대학', depts: ['글로벌문화통상학부'] },
    { name: '커뮤니케이션&컬처대학', depts: ['광고홍보학과', '미디어학과', '문화인류학과', '문화콘텐츠학과'] },
    { name: '경상대학', depts: ['경제학부', '경영학부', '보험계리학과', '회계세무학과'] },
    { name: '디자인대학', depts: ['주얼리·패션디자인학과', '영상디자인학과', '융합디자인학부'] },
    { name: '예체능대학', depts: ['스포츠과학부', '무용예술학과', '실용음악학과'] },
    { name: 'LIONS칼리지', depts: ['LIONS자율전공학부'] },
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
      user('u_s1', 'demo_senior', '김민준', '컴퓨터학부', '23', '카카오톡 오픈채팅 "민준 선배와 밥약"'),
      user('u_s2', 'seoyeon', '이서연', '경영학부', '24', '인스타그램 @seoyeon.demo'),
      user('u_s3', 'jiho', '박지호', '문화인류학과', '23', '카카오톡 오픈채팅 "지호 선배"'),
      user('u_s4', 'yujin', '최유진', '기계공학과', '24', '카카오톡 ID yujin_demo'),
      user('u_s5', 'haneul', '정하늘', '융합디자인학부', '23', '인스타그램 @haneul.design'),
      user('u_s6', 'doyoon', '강도윤', '컴퓨터학부', '25', '카카오톡 ID doyoon_dev'),
      user('u_s7', 'sujin', '윤수진', '인공지능학과', '24', '카카오톡 ID sujin_ai'),
      user('u_s8', 'taeho', '임태호', 'ICT융합학부', '23', '인스타그램 @taeho.ict'),
      user('u_s9', 'jimin', '서지민', '컴퓨터학부', '24', '카카오톡 오픈채팅 "지민 선배 밥약"'),
      user('u_s10', 'hyunwoo', '오현우', '전자공학부', '23', '카카오톡 ID hyunwoo_ee'),
      user('u_s11', 'nayeon', '신나연', '건축학부', '23', '인스타그램 @nayeon.arch'),
      user('u_s12', 'seungmin', '권승민', '로봇공학과', '24', '카카오톡 ID seungmin_robot'),
      user('u_s13', 'dahye', '황다혜', '산업경영공학과', '25', '카카오톡 ID dahye_ime'),
      user('u_s14', 'minseo', '배민서', '경제학부', '23', '인스타그램 @minseo.econ'),
      user('u_s15', 'eunji', '송은지', '광고홍보학과', '24', '인스타그램 @eunji.ad'),
      user('u_s16', 'junho', '류준호', '미디어학과', '23', '카카오톡 ID junho_media'),
      user('u_s17', 'chaeyoung', '문채영', '글로벌문화통상학부', '24', '카카오톡 ID chaeyoung_jp'),
      user('u_s18', 'sihyun', '백시현', '스포츠과학부', '23', '인스타그램 @sihyun.sports'),
      user('u_s19', 'yuna', '조유나', '약학과', '23', '카카오톡 ID yuna_pharm'),
      user('u_s20', 'gunwoo', '남건우', '수리데이터사이언스학과', '24', '카카오톡 ID gunwoo_data'),
      user('u_s21', 'sohee', '안소희', '영상디자인학과', '25', '인스타그램 @sohee.design'),
      user('u_s22', 'jaewon', '홍재원', '배터리소재화학공학과', '23', '카카오톡 ID jaewon_mce'),
      user('u_s23', 'hyunsung', '김현성', '지능형시스템공학과', '24', '인스타그램 @hyunsung.eats'),
      user('u_j1', 'demo_junior', '박정환', '지능형시스템공학과', '26', '카카오톡 ID jeonghwan_26'),
      user('u_j2', 'yerin', '한예린', '경영학부', '26', '인스타그램 @yerin.26'),
      user('u_b1', 'bokyung', '추보경', '지능정보양자공학전공', '26', '인스타그램 @bokyung.26'),
      user('u_b2', 'dohyun', '정도현', '문화콘텐츠학과', '25', '카카오톡 ID dohyun_eats'),
    ];
    const profile = (userId, bio, days, slots) => ({ userId, bio, avail: rangesFrom(days, slots), isPublic: true });
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
      profile('u_s17', '일본 교환학생 다녀왔어요. 교환 준비와 통상 공모전 팁 알려드릴게요.', ['월', '수'], ['lunch']),
      profile('u_s18', '교내 축구 동아리 주장이에요. 운동하면서 학교생활 즐기는 법 공유해요.', ['수', '목', '금'], ['breakfast', 'dinner']),
      profile('u_s19', '약대 생활과 실습 이야기 궁금하면 언제든 신청하세요.', ['수'], ['lunch']),
      profile('u_s20', '통계·데이터 분석 스터디 운영 중! 수학 과목 공부법 알려드려요.', ['월', '화', '수'], ['lunch']),
      profile('u_s21', '모션그래픽 외주 경험 있어요. 영상 툴 배우는 순서 같이 정해봐요.', ['수', '목'], ['lunch', 'dinner']),
      profile('u_s22', '배터리 소재 연구실 학부연구생이에요. 연구실 컨택 방법 알려드릴게요.', ['화', '수', '금'], ['lunch']),
      profile('u_s23', '지능형시스템공학과 3학년이에요. 전공 과목 순서, 팀플, 과 생활 다 물어보세요! 새내기 환영해요.', ['화', '수', '목'], ['lunch', 'dinner']),
    ];
    // 좋아하는 메뉴와 추천 맛집 (예시라 가게 이름은 지어낸 이름)
    const tastes = {
      u_s1: [['돈까스', '마라탕', '쌀국수'], ['학교 앞 돈까스집 - 치즈돈까스가 진짜 맛있어요', '학생식당 2층 - 금요일 특식 추천']],
      u_s2: [['떡볶이', '파스타'], ['한대앞역 파스타집 - 크림 파스타 강추']],
      u_s3: [['국밥', '김치찌개'], ['정문 앞 국밥집 - 든든한 순대국밥']],
      u_s4: [['햄버거', '샐러드'], ['후문 수제버거 - 감자튀김이 바삭해요']],
      u_s5: [['초밥', '우동'], ['학교 앞 초밥집 - 점심 세트가 가성비 최고']],
      u_s6: [['라멘', '덮밥'], ['한대앞 라멘집 - 돈코츠 라멘']],
      u_s7: [['샌드위치', '커피'], ['학교 카페 - 아침 샌드위치 세트']],
      u_s8: [['피자', '치킨'], []],
      u_s9: [['마라탕', '탕후루'], ['후문 마라탕집 - 2단계 맵기 추천']],
      u_s10: [['제육볶음', '라면'], ['학생식당 1층 - 제육볶음 나오는 날은 꼭']],
      u_s11: [['비빔밥', '칼국수'], []],
      u_s12: [['햄버거', '돈까스'], ['후문 수제버거 - 더블패티']],
      u_s13: [['쌀국수', '분짜'], ['학교 앞 베트남 식당 - 분짜 맛집']],
      u_s14: [['삼겹살', '냉면'], ['한대앞 고깃집 - 저녁 밥약은 여기']],
      u_s15: [['떡볶이', '김밥'], ['정문 분식집 - 떡튀순 세트']],
      u_s16: [['부대찌개', '김치볶음밥'], []],
      u_s17: [['오코노미야키', '우동'], ['한대앞 일식 주점 - 점심엔 우동 정식']],
      u_s18: [['닭가슴살 샐러드', '포케'], ['학교 앞 포케집 - 운동 끝나고 딱']],
      u_s19: [['파스타', '리조또'], []],
      u_s20: [['돈까스', '카레'], ['학생식당 2층 - 카레 데이 추천']],
      u_s21: [['브런치', '케이크'], ['한대앞 브런치 카페 - 팬케이크']],
      u_s22: [['짜장면', '탕수육'], ['정문 중국집 - 탕수육 소 사이즈로 둘이 딱']],
      u_s23: [['국밥', '돈까스', '마라탕'], ['정문 앞 국밥집 - 수업 끝나고 든든하게', '학생식당 2층 - 돈까스 나오는 날 강추']],
    };
    profiles.forEach((p) => {
      const [foods, spots] = tastes[p.userId] || [[], []];
      Object.assign(p, { kind: 'senior', foods, spots });
    });
    // 밥친구 찾기 예시: 학년 상관없이 같이 밥 먹을 친구를 찾는 프로필
    const buddy = (userId, bio, days, slots, foods) => ({ ...profile(userId, bio, days, slots), kind: 'buddy', foods, spots: [] });
    profiles.push(
      buddy('u_b1', '26학번 새내기예요! 같은 과 동기나 공강 맞는 친구랑 학식 같이 먹고 싶어요 🍚', ['월', '수', '목'], ['lunch'], ['학식', '떡볶이', '마라탕']),
      buddy('u_j2', '혼밥 탈출하고 싶어요. 경영 수업 끝나고 저녁 같이 먹을 친구 구해요!', ['화', '목'], ['dinner'], ['파스타', '김밥']),
      buddy('u_b2', '공강에 새로운 맛집 찾아다니는 걸 좋아해요. 다른 과 친구도 환영!', ['수', '금'], ['lunch'], ['쌀국수', '초밥'])
    );
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
    // 신청마다 주고받는 대화 (선배 체험 계정이 받은 신청에 예시 대화)
    const msg = (id, requestId, fromId, text, ago) => ({ id, requestId, fromId, text, createdAt: now - ago, readBy: [fromId] });
    const messages = [
      msg('m_seed1', 'r_seed1', 'u_j2', '선배님 안녕하세요! 신청 보낸 한예린이에요. 혹시 시간 괜찮으실까요?', DAY_MS - 6e5),
    ];
    return { version: DB_VERSION, users, profiles, requests, notifications, messages, reports: [], blocks: [], session: null };
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
    if (!Array.isArray(db.messages)) db.messages = []; // 대화 기능 이전에 저장된 데이터
  }

  // 저장에 성공하면 true. 저장 공간이 꽉 찼거나 저장할 수 없는 환경이면 false (메모리에서만 동작)
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      return false;
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

  // ---------- 시간표 ----------
  // 수업 시간(요일별 구간)을 받아 HOUR_MIN~HOUR_MAX 사이의 공강 중 MIN_RANGE시간 이상인 구간을 돌려줌
  const TIMETABLE_START = 9;
  const TIMETABLE_END = 19;
  const IMAGE_MAX_CHARS = 400000; // 압축한 시간표 이미지 크기 한도 (약 300KB)
  function freeRanges(classes) {
    const out = [];
    DAYS.forEach((day) => {
      const busy = mergeRanges(classes.filter((c) => c.day === day));
      let cursor = HOUR_MIN;
      busy.concat([{ start: HOUR_MAX, end: HOUR_MAX }]).forEach((c) => {
        if (c.start - cursor >= MIN_RANGE) out.push({ day, start: cursor, end: Math.min(c.start, HOUR_MAX) });
        cursor = Math.max(cursor, c.end);
      });
    });
    return out;
  }

  // 좋아하는 메뉴는 쉼표로 구분한 최대 5개, 추천 맛집은 줄마다 하나씩 최대 3곳
  const FOODS_MAX = 5;
  const SPOTS_MAX = 3;
  const parseFoods = (text) => [...new Set(String(text || '').split(/[,，\n]/).map((s) => s.trim()).filter(Boolean))];
  const parseSpots = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);

  function saveProfile({ bio, avail, isPublic, timetable, foods = [], spots = [], kind = 'senior' }) {
    const u = currentUser();
    if (!u) return '로그인이 필요해요.';
    if (!KINDS[kind]) return '프로필 종류를 다시 골라 주세요.';
    if (bio.length > BIO_MAX) return `자기소개는 ${BIO_MAX}자 이내로 써 주세요.`;
    if (isPublic && !bio.trim()) return '공개하려면 자기소개를 써 주세요.';
    for (const a of avail) {
      if (!DAYS.includes(a.day)) return '요일을 다시 골라 주세요.';
      if (!(a.start >= HOUR_MIN && a.end <= HOUR_MAX && a.end - a.start >= MIN_RANGE)) {
        return `가능 시간은 ${HOUR_MIN}시~${HOUR_MAX}시 사이에서 ${MIN_RANGE}시간 이상으로 정해 주세요. (${a.day} ${a.start}:00~${a.end}:00)`;
      }
    }
    if (isPublic && !avail.length) return '공개하려면 가능한 시간을 하나 이상 추가해 주세요.';
    if (foods.length > FOODS_MAX) return `좋아하는 메뉴는 ${FOODS_MAX}개까지 적어 주세요.`;
    if (foods.some((f) => f.length > 15)) return '메뉴 이름은 15자 이내로 적어 주세요.';
    if (spots.length > SPOTS_MAX) return `추천 맛집은 ${SPOTS_MAX}곳까지 적어 주세요.`;
    if (spots.some((s) => s.length > 60)) return '맛집 한 줄은 60자 이내로 적어 주세요.';
    if (timetable && timetable.image && timetable.image.length > IMAGE_MAX_CHARS) return '시간표 이미지가 너무 커요. 더 작은 이미지를 올려 주세요.';
    let p = getProfile(u.id);
    if (!p) {
      p = { userId: u.id };
      db.profiles.push(p);
    }
    const before = JSON.stringify(p);
    Object.assign(p, {
      kind,
      bio: bio.trim(),
      avail: mergeRanges(avail),
      isPublic,
      timetable: timetable ? { classes: mergeRanges(timetable.classes || []), image: timetable.image || null } : p.timetable || null,
      foods,
      spots,
    });
    if (!save()) {
      Object.assign(p, JSON.parse(before)); // 저장 공간이 부족하면 되돌림
      return '브라우저 저장 공간이 부족해서 저장하지 못했어요. 시간표 이미지를 빼고 다시 저장해 보세요.';
    }
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

  // ---------- 공개 프로필 목록 ----------
  // kind: 'senior'(선배가 밥약 받기) | 'buddy'(학년 상관없이 같이 밥 먹을 밥친구 찾기)
  const KINDS = { senior: '선배', buddy: '밥친구' };
  const kindOf = (p) => (p && p.kind === 'buddy' ? 'buddy' : 'senior');
  function publicSeniors(kind = 'senior') {
    const me = currentUser();
    return db.profiles
      .filter((p) => p.isPublic && kindOf(p) === kind)
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
    if (!p || !p.isPublic) return '지금은 신청을 받지 않는 프로필이에요.';
    if (isBlocked(me.id, toId)) return '신청할 수 없는 사용자예요.';
    if (activeRequest(me.id, toId)) return '이 선배에게 이미 진행 중인 신청이 있어요.';
    if (pendingCountFor(toId) >= MAX_PENDING_PER_SENIOR) return '이 선배는 지금 신청이 많이 밀려 있어요. 나중에 다시 시도해 주세요.';
    if (!options.length) return '희망 일시를 하나 이상 골라 주세요.';
    if (options.some((o) => o.date < today())) return '지난 날짜는 고를 수 없어요.';
    if (options.some((o) => !windowsOn(p, weekday(o.date)).includes(o.slot))) return '선배가 가능한 시간 안에서 골라 주세요.';
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

  // ---------- 신청별 대화 ----------
  // 신청이 대기 중이거나 수락된 동안 두 사람이 사이트 안에서 메시지를 주고받을 수 있습니다.
  const MESSAGE_TEXT_MAX = 300;
  const requestById = (id) => db.requests.find((r) => r.id === id) || null;
  const isParticipant = (r, userId) => !!r && (r.fromId === userId || r.toId === userId);
  const canChat = (r) => !!r && (r.status === 'pending' || r.status === 'accepted') && !isBlocked(r.fromId, r.toId);

  function messagesOf(requestId) {
    return db.messages.filter((m) => m.requestId === requestId).sort((a, b) => a.createdAt - b.createdAt);
  }

  function sendMessage(requestId, text) {
    const me = currentUser();
    const r = requestById(requestId);
    if (!me || !isParticipant(r, me.id)) return '대화할 수 없는 신청이에요.';
    if (!canChat(r)) return '끝난 신청이라 더 이상 메시지를 보낼 수 없어요.';
    text = text.trim();
    if (!text) return '메시지를 입력해 주세요.';
    if (text.length > MESSAGE_TEXT_MAX) return `메시지는 ${MESSAGE_TEXT_MAX}자 이내로 써 주세요.`;
    db.messages.push({ id: uid('m'), requestId, fromId: me.id, text, createdAt: Date.now(), readBy: [me.id] });
    const otherId = r.fromId === me.id ? r.toId : r.fromId;
    // 같은 신청에 아직 안 읽은 메시지 알림이 있으면 알림을 또 만들지 않음
    const link = `#/chat/${requestId}`;
    if (!db.notifications.some((n) => n.userId === otherId && n.link === link && !n.read)) {
      notify(otherId, `💬 ${me.name}님이 메시지를 보냈어요.`, link);
    }
    save();
    return null;
  }

  function markMessagesRead(requestId, userId) {
    let changed = false;
    db.messages.forEach((m) => {
      if (m.requestId === requestId && !m.readBy.includes(userId)) {
        m.readBy.push(userId);
        changed = true;
      }
    });
    db.notifications.forEach((n) => {
      if (n.userId === userId && n.link === `#/chat/${requestId}` && !n.read) {
        n.read = true;
        changed = true;
      }
    });
    if (changed) save();
  }

  const unreadMessages = (requestId, userId) =>
    db.messages.filter((m) => m.requestId === requestId && !m.readBy.includes(userId)).length;

  // ---------- 수요일 공강 커피 이벤트 ----------
  // 매주 수요일 13:00~15:00은 학교 전체 공강 시간. 이 시간으로 밥약이 확정되면 두 사람 모두 커피 기프티콘 추첨에 응모됩니다.
  const EVENT = { day: '수', slot: 'h13', label: '수요일 13:00~15:00' };
  function isEventOption(o) {
    return !!o && o.slot === EVENT.slot && weekday(o.date) === EVENT.day;
  }
  const isEventRequest = (r) => r.status === 'accepted' && isEventOption(r.options[r.chosen]);
  const eventEntriesOf = (userId) => db.requests.filter((r) => (r.fromId === userId || r.toId === userId) && isEventRequest(r));
  const eventEntryCount = () => db.requests.filter(isEventRequest).length;
  const supportsEvent = (profile) => windowsOn(profile, EVENT.day).includes(EVENT.slot);

  load();

  window.Store = {
    KINDS, kindOf, FOODS_MAX, SPOTS_MAX, parseFoods, parseSpots, DAYS, SLOTS, HOUR_MIN, HOUR_MAX, MIN_RANGE, mergeRanges, availDays, windowsOn, hasWindow, freeRanges, TIMETABLE_START, TIMETABLE_END, COLLEGES, DEPTS, collegeOf, MAX_PENDING_PER_SENIOR, EXPIRE_DAYS, BIO_MAX, MESSAGE_MAX,
    today, userById, currentUser, signup, login, loginAs, logout, updateUser,
    getProfile, saveProfile, publicSeniors, isBlocked, block, report,
    activeRequest, pendingCountFor, createRequest, respond, cancel, expireOld, requestsOf,
    notificationsOf, unreadCount, markAllRead, reset,
    EVENT, isEventOption, eventEntriesOf, eventEntryCount, supportsEvent,
    MESSAGE_TEXT_MAX, requestById, isParticipant, canChat, messagesOf, sendMessage, markMessagesRead, unreadMessages,
  };
})();
