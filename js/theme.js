// 테마(라이트/다크) 전환. 화면이 그려지기 전에 적용되도록 <head>에서 불러옵니다.
// 선택: 'system'(기기 설정 따름) → 'light' → 'dark' 순서로 바뀌고, 브라우저에 저장됩니다.
(function () {
  const KEY = 'bapyak-theme';
  const MODES = {
    system: { icon: '🌗', label: '기기 설정에 맞춤' },
    light: { icon: '☀️', label: '라이트 모드' },
    dark: { icon: '🌙', label: '다크 모드' },
  };
  const ORDER = ['system', 'light', 'dark'];

  function read() {
    try {
      const v = localStorage.getItem(KEY);
      return MODES[v] ? v : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function apply(mode) {
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = MODES[mode].icon;
      btn.title = `${MODES[mode].label} (눌러서 바꾸기)`;
      btn.setAttribute('aria-label', `테마: ${MODES[mode].label}. 눌러서 바꾸기`);
    }
  }

  let mode = read();
  apply(mode);

  document.addEventListener('DOMContentLoaded', () => {
    apply(mode);
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
      try {
        localStorage.setItem(KEY, mode);
      } catch (e) {
        /* 저장할 수 없어도 이번 화면에는 적용 */
      }
      apply(mode);
    });
  });
})();
