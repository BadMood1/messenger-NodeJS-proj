import { useEffect, useState, type ReactNode } from "react";

import { getMeRequest, loginRequest, refreshRequest, type User } from "./auth.api";
import { AuthContext } from "./auth-context";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);

    // Access token специально держим только в памяти
    const [accessToken, setAccessToken] = useState<string | null>(null);

    // Пока пытаемся восстановить авторизацию, приложение не должно
    // сразу считать пользователя гостем
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const restoreSession = async () => {
            try {
                // После перезагрузки accessToken потерян,
                // поэтому пробуем получить новый через refresh cookie
                const refreshResult = await refreshRequest();

                if (!refreshResult) {
                    return;
                }

                setAccessToken(refreshResult.accessToken);

                // По новому accessToken узнаём текущего пользователя
                const meResult = await getMeRequest(refreshResult.accessToken);

                setUser(meResult.user);
            } finally {
                setLoading(false);
            }
        };

        restoreSession();
    }, []);

    const login = async (identifier: string, password: string) => {
        const result = await loginRequest(identifier, password);

        // Backend уже вернул и user, и accessToken
        setUser(result.user);
        setAccessToken(result.accessToken);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                accessToken,
                loading,
                login,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};
