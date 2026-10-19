export const API_URL = import.meta.env.VITE_API_URL;

// Socket.IO подключается к backend origin, а не к REST-префиксу /api.
export const SOCKET_URL = new URL(API_URL, window.location.origin).origin;
