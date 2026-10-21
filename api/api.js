// D&D Toolkit — API layer (HTTP-запросы к backend)

window.DND_API = {
  // Адрес backend:
  // - обычно сайт открыт с самого сервера (http://localhost:5000, адрес Radmin VPN, туннель) — тогда это тот же адрес;
  // - старый фронтенд на Render ходит в backend на Render;
  // - можно переопределить: localStorage.setItem('dnd_backend_url', 'http://192.168.1.10:5000')
  baseUrl: (() => {
    try { const v = localStorage.getItem('dnd_backend_url'); if (v) return v.replace(/\/$/, ''); } catch (e) {}
    if (location.hostname === 'dnd-toolkit-frontend.onrender.com') return 'https://dnd-toolkit-backend.onrender.com';
    if (location.protocol === 'file:') return 'http://localhost:5000';
    return location.origin;
  })(),

  configure(baseUrl) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
  },

  wsUrl(path) {
    return this.baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + path;
  },

  async request(path, options = {}) {
    const { timeout = 20000, headers = {}, ...rest } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetch(this.baseUrl + path, {
        ...rest,
        headers: { 'Content-Type': 'application/json', ...headers },
        signal: controller.signal
      });
    } catch (err) {
      throw new Error(err.name === 'AbortError'
        ? 'Сервер не отвечает. Возможно, он просыпается — попробуйте через минуту.'
        : 'Нет связи с сервером. Проверьте интернет.');
    } finally {
      clearTimeout(timer);
    }
    const type = response.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await response.json().catch(() => ({})) : await response.text();
    if (!response.ok) {
      const error = new Error((body && body.error) || `Ошибка сервера (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  },

  /** Разбудить backend (бесплатный Render засыпает после простоя). */
  async wake() {
    try { await this.request('/api/health', { timeout: 70000 }); return true; } catch (e) { return false; }
  }
};
