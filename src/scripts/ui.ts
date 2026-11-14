/** 全站共享 UI 小件：toast / modal / confirm / prompt（全面替代原生 alert/prompt） */

export function toast(msg: string, ms = 2200): void {
  const box = document.getElementById('toast-box');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, ms - 300);
  setTimeout(() => el.remove(), ms);
}

export function modal(title: string, bodyHTML: string): { el: HTMLDivElement; close: () => void } {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const box = document.createElement('div');
  box.className = 'modal';
  const h = document.createElement('h2');
  h.textContent = title;
  h.style.marginBottom = '14px';
  const body = document.createElement('div');
  body.innerHTML = bodyHTML;
  box.append(h, body);
  overlay.appendChild(box);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  document.body.appendChild(overlay);
  return { el: overlay, close };
}

export function confirmDialog(title: string, message: string, okText = '确定'): Promise<boolean> {
  return new Promise((resolve) => {
    const { el, close } = modal(title, `<p class="muted">${message}</p>
      <div class="row" style="justify-content:flex-end;margin-top:20px">
        <button class="btn btn--ghost" data-act="no">取消</button>
        <button class="btn btn--red" data-act="ok">${okText}</button>
      </div>`);
    el.querySelector('[data-act="no"]')?.addEventListener('click', () => { close(); resolve(false); });
    el.querySelector('[data-act="ok"]')?.addEventListener('click', () => { close(); resolve(true); });
  });
}

export function promptDialog(title: string, placeholder = '', initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const { el, close } = modal(title, `
      <input class="input" id="__pd" placeholder="${placeholder}" value="${initial.replace(/"/g, '&quot;')}" />
      <div class="row" style="justify-content:flex-end;margin-top:20px">
        <button class="btn btn--ghost" data-act="no">取消</button>
        <button class="btn" data-act="ok">确定</button>
      </div>`);
    const input = el.querySelector<HTMLInputElement>('#__pd')!;
    input.focus(); input.select();
    const done = (v: string | null) => { close(); resolve(v); };
    el.querySelector('[data-act="no"]')?.addEventListener('click', () => done(null));
    el.querySelector('[data-act="ok"]')?.addEventListener('click', () => done(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
  });
}

/** localStorage 封装（JSON + 异常安全） */
export const store = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; }
    catch { return fallback; }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 隐私模式静默 */ }
  },
};

/** Fisher–Yates 洗牌（非破坏） */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 下载文本/数据为文件 */
export function download(filename: string, content: string | Blob, mime = 'text/plain'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: `${mime};charset=utf-8` }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
