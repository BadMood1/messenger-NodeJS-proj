import { useEffect, useState } from "react";

import { ChatPanel } from "../components/messenger/ChatPanel";
import { ConversationSidebar } from "../components/messenger/ConversationSidebar";
import { NavRail } from "../components/messenger/NavRail";
import { useAuth } from "../features/auth/useAuth";
import {
    getConversations,
    type Conversation,
} from "../features/conversations/conversations.api";

export const MessengerPage = () => {
    const { user, accessToken } = useAuth();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(Boolean(accessToken));
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!accessToken) {
            return;
        }

        let cancelled = false;

        const loadConversations = async () => {
            setLoading(true);
            setError(null);

            try {
                const result = await getConversations(accessToken);

                if (!cancelled) {
                    setConversations(result);
                }
            } catch (requestError) {
                if (!cancelled) {
                    setError(
                        requestError instanceof Error
                            ? requestError.message
                            : "Failed to load conversations",
                    );
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadConversations();

        return () => {
            cancelled = true;
        };
    }, [accessToken]);

    return (
        <main className="flux-messenger-shell">
            <div className="flux-messenger-ambient" aria-hidden="true" />

            {/* ==================== NAVIGATION ==================== */}
            <NavRail username={user?.username} />

            {/* ==================== CONVERSATIONS ==================== */}
            <ConversationSidebar conversations={conversations} loading={loading} error={error} />

            {/* ==================== CHAT ==================== */}
            <ChatPanel />
        </main>
    );
};
