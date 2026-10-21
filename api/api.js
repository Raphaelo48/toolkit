// D&D Toolkit — API layer (HTTP-запросы к backend)

window.DND_API = {
  // Адрес backend. Для локальной разработки можно переопределить:
  // localStorage.setItem('dnd_backend_url', 'http://localhost:5000')
  baseUrl: (() => {
    try { const v = localStorage.getItem('dnd_backend_url'); if (v) return v.replace(/\/$/, ''); } catch (e) {}
    return 'https://dnd-toolkit-backend.onrender.com';
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
