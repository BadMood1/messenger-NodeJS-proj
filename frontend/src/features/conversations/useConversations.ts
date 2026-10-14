import { useCallback, useEffect, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import type { Message, MessageDeletedEvent } from "../messages/messages.api";
import { applyConversationMessageEvent, type ConversationMessageEvent } from "./conversation-state-updates";
import { getConversations, type Conversation } from "./conversations.api";

type UseConversationsOptions = {
    enabled: boolean;
    authenticatedRequest: AuthenticatedRequest;
};

// Получает признак авторизации и функцию защищённых запросов.
// Загружает диалоги и обновляет их preview по событиям сообщений.
// Возвращает список, состояния загрузки и обработчики realtime.
export const useConversations = ({ enabled, authenticatedRequest }: UseConversationsOptions) => {
    // ------- СОСТОЯНИЯ И REFS -------
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<string | null>(null);
    const [refreshError, setRefreshError] = useState<string | null>(null); // ошибка при повторной загрузке, когда список уже есть
    const [reloadVersion, setReloadVersion] = useState(0); // state счетчик GET'ов
    const conversationsRef = useRef<Conversation[]>([]); // актуальный список для обработчиков событий
    const controllerRef = useRef<AbortController | null>(null); // контроллер текущего GET
    const hasLoadedRef = useRef(false); // Была ли хотя бы одна успешная загрузка
    const reloadQueuedRef = useRef(false); // Нужно ли выполнить еще один GET после текущего
    const eventsDuringLoadRef = useRef<ConversationMessageEvent[]>([]); // события полученные во время GET
    const deletedMessageIdsRef = useRef(new Set<string>()); // id сообщений, которые были удалены ( уже знаем )

    // ------- ОБНОВЛЕНИЕ СПИСКА -------
    // Получает новый список диалогов.
    // Сохраняет его для обработчиков событий и для React одновременно.
    // Обновляет sidebar через state.
    const updateConversationList = useCallback((nextConversations: Conversation[]) => {
        conversationsRef.current = nextConversations;
        setConversations(nextConversations);
    }, []);

    // ------- ЗАПРОС ПОВТОРНОЙ ЗАГРУЗКИ -------
    // Получает запрос на повторную загрузку списка диалогов.
    // Запускает GET, а если GET уже идёт — ставит одну загрузку в очередь.
    // Обновляет список через effect(ниже) без параллельных запросов.
    const requestConversationsReload = useCallback(() => {
        if (!enabled) return;
        if (controllerRef.current) {
            reloadQueuedRef.current = true;
            return;
        }
        setReloadVersion((version) => version + 1);
    }, [enabled]);

    // ------- Обработчики ниже передаются в useRealtimeConnection -------

    // Получает созданное или изменённое серверное сообщение.
    // Обновляет preview его чата, а неизвестный диалог загружает через REST.
    // Сохраняет новый текст и порядок списка диалогов.
    const handleConversationMessage = useCallback(
        (message: Message) => {
            if (!enabled || deletedMessageIdsRef.current.has(message.id)) return;
            // есть ли conversation в списке
            const conversationExists = conversationsRef.current.some(
                (conversation) => conversation.id === message.conversationId,
            );
            // оборачиваем сообщение во внутренний объект
            const event: ConversationMessageEvent = { type: "message", message };
            if (controllerRef.current) eventsDuringLoadRef.current.push(event);
            // меняем превью диалога, если он есть, и применяем изменения к списку диалогов
            updateConversationList(applyConversationMessageEvent(conversationsRef.current, event));
            if (!conversationExists) requestConversationsReload(); // если диалога не было — загружаем его через REST
        },
        [enabled, updateConversationList, requestConversationsReload],
    );

    // ------- ОБРАБОТКА УДАЛЕНИЯ -------
    // Получает id удалённого сообщения и id его чата.
    // Убирает удалённый preview и запрашивает предыдущее сообщение через REST.
    // Обновляет только список диалогов, не историю открытого чата.
    const handleConversationMessageDeleted = useCallback(
        (message: MessageDeletedEvent) => {
            if (!enabled || deletedMessageIdsRef.current.has(message.id)) return;
            deletedMessageIdsRef.current.add(message.id);
            // находим диалог, в котором было удалено сообщение
            const conversation = conversationsRef.current.find(
                (listedConversation) => listedConversation.id === message.conversationId,
            );
            const event: ConversationMessageEvent = { type: "deleted", message };
            if (controllerRef.current) eventsDuringLoadRef.current.push(event);
            // меняем превью диалога, если он есть, и применяем изменения к списку диалогов (удаляем)
            updateConversationList(applyConversationMessageEvent(conversationsRef.current, event));
            // если удалили превью, то загружаем диалоги через REST, чтобы получить предыдущее сообщение на место превью
            if (!conversation || conversation.lastMessage?.id === message.id) requestConversationsReload();
        },
        [enabled, updateConversationList, requestConversationsReload],
    );

    // ------- ЗАГРУЗКА СПИСКА ЧЕРЕЗ REST -------
    // Первая загрузка списка диалогов и повторная загрузка по кнопке Retry.
    // Также обновляет список после connect/reconnect и событий, которым понадобился GET.
    useEffect(() => {
        if (!enabled) {
            return;
        }

        const controller = new AbortController();
        controllerRef.current = controller;
        eventsDuringLoadRef.current = [];

        // Получает диалоги через существующий GET /conversations.
        // Добавляет к ответу события, пришедшие во время запроса.
        // Сохраняет актуальный список или ошибку загрузки.
        const loadConversations = async () => {
            setLoading(!hasLoadedRef.current);
            setError(null);
            setRefreshError(null);

            try {
                const result = await getConversations(authenticatedRequest, {
                    signal: controller.signal,
                });

                // Для всех событий во время GET применяем их к ответу
                if (!controller.signal.aborted) {
                    // GET мог начаться до socket-события: применяем события к ответу, а не теряем их.
                    let updatedConversations = result;
                    for (const event of eventsDuringLoadRef.current) {
                        // Если в очереди есть Create/Edit и Delete одного сообщения,
                        // пропускаем Create/Edit, потому что сообщение уже помечено как удалённое.
                        if (event.type === "message" && deletedMessageIdsRef.current.has(event.message.id))
                            continue;
                        updatedConversations = applyConversationMessageEvent(updatedConversations, event);
                    }
                    updateConversationList(updatedConversations);
                    hasLoadedRef.current = true;
                }
            } catch (requestError) {
                // Отмена ожидаема при смене токена или уходе со страницы.
                if (!controller.signal.aborted) {
                    const message =
                        requestError instanceof Error ? requestError.message : "Failed to load conversations";
                    // Первая загрузка показывает error state; фоновая сохраняет список и предлагает Retry.
                    if (hasLoadedRef.current) setRefreshError(message);
                    else setError(message);
                }
            } finally {
                if (controllerRef.current === controller) {
                    controllerRef.current = null;
                    eventsDuringLoadRef.current = [];
                    if (!controller.signal.aborted) {
                        setLoading(false);
                        // если попросили ещё одну загрузку (requestConversationsReload это делает)
                        if (reloadQueuedRef.current) {
                            reloadQueuedRef.current = false;
                            setReloadVersion((version) => version + 1);
                        }
                    }
                }
            }
        };

        void loadConversations();

        return () => {
            controller.abort(); // Cleanup отменяет запрос при смене токена или уходе со страницы.
            if (controllerRef.current === controller) {
                controllerRef.current = null;
                eventsDuringLoadRef.current = [];
                reloadQueuedRef.current = false;
            }
        };
    }, [authenticatedRequest, enabled, reloadVersion, updateConversationList]);

    // ------- ДАННЫЕ ДЛЯ СТРАНИЦЫ -------
    // После выхода не показываем данные, оставшиеся в памяти от прошлого токена.
    return {
        conversations: enabled ? conversations : [],
        loading: enabled && loading,
        error: enabled ? error : null,
        refreshError: enabled ? refreshError : null,
        requestConversationsReload,
        handleConversationMessage,
        handleConversationMessageDeleted,
    };
};
