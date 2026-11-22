import { MessageCircleMore, UserRound, UsersRound } from "lucide-react";

import type { MessengerSection } from "./NavRail";

type MessengerMobileNavProps = {
    activeSection: MessengerSection;
    onSelectSection: (section: MessengerSection) => void;
};

// Получает текущий раздел и обработчик переключения страницы.
// Выделяет Chats или Friends и передаёт нажатие в MessengerPage.
// Возвращает одну и ту же нижнюю навигацию для обоих мобильных экранов.
export const MessengerMobileNav = ({ activeSection, onSelectSection }: MessengerMobileNavProps) => (
    <nav className="flux-mobile-nav" aria-label="Мобильная навигация">
        <button
            type="button"
            aria-current={activeSection === "chats" ? "page" : undefined}
            onClick={() => onSelectSection("chats")}
        >
            <MessageCircleMore size={20} strokeWidth={1.8} aria-hidden="true" />
            Chats
        </button>
        <button
            type="button"
            aria-current={activeSection === "friends" ? "page" : undefined}
            onClick={() => onSelectSection("friends")}
        >
            <UsersRound size={20} strokeWidth={1.8} aria-hidden="true" />
            Friends
        </button>
        <button type="button">
            <UserRound size={20} strokeWidth={1.8} aria-hidden="true" />
            Profile
        </button>
    </nav>
);
