// D&D Toolkit — API layer
// Сейчас сайт работает локально. Этот модуль подготовлен для будущего Backend/WebSocket.
// Игровые данные не отправляются на сервер автоматически.

window.DND_API = {
  baseUrl: "https://dnd-toolkit-backend.onrender.com",
  connected: false,

  configure(baseUrl) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
  },

  async request(path, options = {}) {
    if (!this.baseUrl) {
      throw new Error("Backend URL is not configured");
    }
    const response = await fetch(this.baseUrl + path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText}`);
    }
    const type = response.headers.get("content-type") || "";
    return type.includes("application/json") ? response.json() : response.text();
  }
};
