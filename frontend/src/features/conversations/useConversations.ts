import { useEffect, useState } from "react";

import { getConversations, type Conversation } from "./conversations.api";

export const useConversations = (accessToken: string | null) => {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(Boolean(accessToken));
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!accessToken) {
            return;
        }

        const controller = new AbortController();

        const loadConversations = async () => {
            setLoading(true);
            setError(null);

            try {
                const result = await getConversations(accessToken, {
                    signal: controller.signal,
                });

                if (!controller.signal.aborted) {
                    setConversations(result);
                }
            } catch (requestError) {
                // Отмена ожидаема при смене токена или уходе со страницы.
                if (!controller.signal.aborted) {
                    setError(
                        requestError instanceof Error
                            ? requestError.message
                            : "Failed to load conversations",
                    );
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        };

        void loadConversations();

        return () => {
            controller.abort();
        };
    }, [accessToken]);

    // После выхода не показываем данные, оставшиеся в памяти от прошлого токена.
    return {
        conversations: accessToken ? conversations : [],
        loading: Boolean(accessToken) && loading,
        error: accessToken ? error : null,
    };
};
