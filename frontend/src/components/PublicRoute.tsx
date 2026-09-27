import { type ReactNode } from "react";
import { Navigate } from "react-router";

import { useAuth } from "../features/auth/useAuth";

export const PublicRoute = ({ children }: { children: ReactNode }) => {
    const { user, loading } = useAuth();

    // Пока восстанавливаем сессию — страницу ещё не показываем
    if (loading) {
        return <p>Loading...</p>;
    }

    // Авторизованному пользователю login уже не нужен
    return user ? <Navigate to="/" replace /> : children;
};
