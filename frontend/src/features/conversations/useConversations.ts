import { useEffect, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { getConversations, type Conversation } from "./conversations.api";

type UseConversationsOptions = {
    enabled: boolean;
    authenticatedRequest: AuthenticatedRequest;
};

export const useConversations = ({ enabled, authenticatedRequest }: UseConversationsOptions) => {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled) {
            return;
        }

        const controller = new AbortController();

        const loadConversations = async () => {
            setLoading(true);
            setError(null);

            try {
                const result = await getConversations(authenticatedRequest, {
                    signal: controller.signal,
                });

                if (!controller.signal.aborted) {
                    setConversations(result);
                }
            } catch (requestError) {
                // Отмена ожидаема при смене токена или уходе со страницы.
                if (!controller.signal.aborted) {
                    setError(
                        requestError instanceof Error ? requestError.message : "Failed to load conversations",
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
            controller.abort(); // Cleanup отменяет запрос при смене токена или уходе со страницы.
        };
    }, [authenticatedRequest, enabled]);

    // После выхода не показываем данные, оставшиеся в памяти от прошлого токена.
    return {
        conversations: enabled ? conversations : [],
        loading: enabled && loading,
        error: enabled ? error : null,
    };
};
