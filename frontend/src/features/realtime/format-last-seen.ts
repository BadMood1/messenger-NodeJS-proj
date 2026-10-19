// Получает lastSeenAt с backend и текущую дату (по умолчанию — сейчас).
// Сравнивает местные календарные даты и форматирует время в часовом поясе браузера.
// Возвращает Last seen с today/yesterday/датой либо Offline, если время неизвестно или некорректно.
export const formatLastSeen = (lastSeenAt: string | null, now = new Date()) => {
    if (!lastSeenAt) return "Offline";

    const lastSeen = new Date(lastSeenAt);
    if (Number.isNaN(lastSeen.getTime())) return "Offline";

    const time = new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).format(lastSeen);

    if (lastSeen.toDateString() === now.toDateString()) return `Last seen today at ${time}`;

    // Вычитаем календарный день, а не 24 часа: это сохраняет правильное «вчера» при переводе часов.
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (lastSeen.toDateString() === yesterday.toDateString()) return `Last seen yesterday at ${time}`;

    const date = new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: lastSeen.getFullYear() === now.getFullYear() ? undefined : "numeric",
    }).format(lastSeen);

    return `Last seen ${date} at ${time}`;
};
