// 소스 열람 방지: 우클릭, 개발자 도구 단축키, 드래그/선택 차단
export function protect() {
  const block = (e) => { e.preventDefault(); e.stopPropagation(); return false; };
  document.addEventListener('contextmenu', block, true);
  document.addEventListener('dragstart', block, true);
  document.addEventListener('selectstart', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    block(e);
  }, true);
  document.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (
      e.key === 'F12' ||
      (ctrl && e.shiftKey && ['i', 'j', 'c', 'k', 'e'].includes(k)) ||
      (e.metaKey && e.altKey && ['i', 'j', 'c', 'u'].includes(k)) ||
      (ctrl && ['u', 's', 'p'].includes(k))
    ) block(e);
  }, true);
}
