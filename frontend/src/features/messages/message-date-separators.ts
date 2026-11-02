// Получает дату сообщения, дату предыдущего сообщения и текущую дату.
// Сравнивает локальные календарные дни и выбирает подпись начала дня.
// Возвращает Today, Yesterday или дату; для того же дня и неверной даты — null.
export const getMessageDateSeparatorLabel = (
    createdAt: string,
    previousCreatedAt?: string,
    currentDate = new Date(),
): string | null => {
    const messageDate = new Date(createdAt);
    // Если дата не распознана, разделитель не показываем.
    if (Number.isNaN(messageDate.getTime())) return null;

    const messageDay = messageDate.toDateString();
    // Если предыдущее сообщение за тот же день, повторный разделитель не нужен.
    if (previousCreatedAt && messageDay === new Date(previousCreatedAt).toDateString()) return null;
    // Если день сообщения совпал с сегодняшним, используем подпись Today.
    if (messageDay === currentDate.toDateString()) return "Today";

    const yesterday = new Date(currentDate);
    // Сдвигаем календарную дату на один день назад.
    yesterday.setDate(yesterday.getDate() - 1);
    // Если сообщение за вчерашний день, используем подпись Yesterday.
    if (messageDay === yesterday.toDateString()) return "Yesterday";

    // Для остальных дней выводим название месяца и число, например October 30.
    return new Intl.DateTimeFormat("en", {
        month: "long",
        day: "numeric",
        // Если год отличается от текущего, добавляем его; undefined — год не выводим.
        year: messageDate.getFullYear() === currentDate.getFullYear() ? undefined : "numeric",
    }).format(messageDate);
};
