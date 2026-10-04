import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { requestWithAuth, type AuthenticatedRequest } from "./authenticated-request";
import { getMeRequest, loginRequest, refreshRequest, type User } from "./auth.api";
import { AuthContext } from "./auth-context";

// При первом монтировании восстанавливает сессию через refresh cookie.
// Через Context отдаёт user, accessToken, login и authenticatedRequest;
// последнюю используют hooks/API для защищённых запросов с retry после 401.

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);

    // Access token специально держим только в памяти
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const accessTokenRef = useRef<string | null>(null);

    // Один Promise не даёт параллельным 401 запускать несколько refresh-запросов.
    const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

    // Пока пытаемся восстановить авторизацию, приложение не должно
    // сразу считать пользователя гостем
    const [loading, setLoading] = useState(true);

    // useCallback — хук в React, который мемоизирует функцию между рендерами

    const updateAccessToken = useCallback((token: string | null) => {
        accessTokenRef.current = token;
        setAccessToken(token);
    }, []);

    // завершаем локальную сессию
    const clearAuth = useCallback(() => {
        setUser(null);
        updateAccessToken(null);
    }, [updateAccessToken]);

    const refreshAccessToken = useCallback((): Promise<string | null> => {
        if (refreshPromiseRef.current) {
            return refreshPromiseRef.current;
        }

        const refreshPromise = refreshRequest()
            .then((result) => {
                if (!result) {
                    // Истёкший refresh token завершает локальную сессию пользователя.
                    clearAuth();
                    return null;
                }

                updateAccessToken(result.accessToken);
                return result.accessToken;
            })
            .catch(() => {
                // Ошибка refresh также очищает auth, чтобы ProtectedRoute открыл /login.
                clearAuth();
                return null;
            })
            .finally(() => {
                refreshPromiseRef.current = null;
            });

        refreshPromiseRef.current = refreshPromise;
        return refreshPromise;
    }, [clearAuth, updateAccessToken]);

    // единая ф-ция для всех защищенных API-запросов
    const authenticatedRequest = useCallback<AuthenticatedRequest>(
        async (input, init) => {
            // input, init для дальнейшего fetch
            const currentAccessToken = accessTokenRef.current; // получ. актуал. токен

            if (!currentAccessToken) {
                throw new Error("Unauthorized");
            }

            // если два запроса в похожее время, то проверяем не был ли запрос отправлен со старым токеном
            // если да, то просто повторяем с текущим(который новый), иначе обновл. access token
            const resolveAccessTokenAfter401 = () => {
                // Поздний 401 со старым токеном использует уже обновлённый результат другого refresh.
                if (accessTokenRef.current !== currentAccessToken) {
                    return Promise.resolve(accessTokenRef.current);
                }

                return refreshAccessToken();
            };

            return requestWithAuth(input, init, currentAccessToken, resolveAccessTokenAfter401);
        },
        [refreshAccessToken],
    );

    // восстанавливаем авторизацию после запуска / перезагрузки приложения
    useEffect(() => {
        let cancelled = false; // старый async-запрос чтоб не менял React state после ухода со страницы

        const restoreSession = async () => {
            try {
                // После перезагрузки accessToken получаем заново через refresh cookie.
                const newAccessToken = await refreshAccessToken();

                if (!newAccessToken || cancelled) {
                    return;
                }

                const meResult = await getMeRequest(newAccessToken);

                if (!cancelled) {
                    setUser(meResult.user);
                }
            } catch {
                if (!cancelled) {
                    clearAuth();
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void restoreSession();

        return () => {
            cancelled = true;
        };
    }, [clearAuth, refreshAccessToken]);

    const login = async (identifier: string, password: string) => {
        const result = await loginRequest(identifier, password);

        setUser(result.user);
        updateAccessToken(result.accessToken);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                accessToken,
                loading,
                login,
                authenticatedRequest,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};
