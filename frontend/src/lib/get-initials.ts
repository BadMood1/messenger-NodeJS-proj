// Получает отображаемое имя собеседника.
// Берёт первые буквы максимум двух слов имени.
// Возвращает инициалы для avatar без изображения.
export const getInitials = (name: string) => {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("");
};
