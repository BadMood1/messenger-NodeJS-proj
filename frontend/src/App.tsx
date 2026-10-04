import { useEffect } from "react";
import { Route, Routes } from "react-router";

import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicRoute } from "./components/PublicRoute";
import { LoginPage } from "./pages/LoginPage";
import { MessengerPage } from "./pages/MessengerPage";

function App() {
    useEffect(() => {
        // Touch :active ненадёжен: одна общая отметка нажатия для кнопок и сообщений.
        let pressedTarget: HTMLElement | null = null;
        // снимает состояние нажатия и забывает элемент
        const release = () => {
            pressedTarget?.removeAttribute("data-pressed");
            pressedTarget = null;
        };
        // мышку игнорируем, это для touch
        const press = (event: PointerEvent) => {
            release();
            if (event.pointerType === "mouse" || !(event.target instanceof Element)) return;
            // всплытие
            pressedTarget = event.target.closest<HTMLElement>(
                "button:not(:disabled), .flux-message-placeholder",
            );
            pressedTarget?.setAttribute("data-pressed", "true");
        };
        // расширяем браузерные events
        document.addEventListener("pointerdown", press, { passive: true });
        document.addEventListener("pointerup", release, { passive: true });
        document.addEventListener("pointercancel", release, { passive: true });
        return () => {
            release();
            document.removeEventListener("pointerdown", press);
            document.removeEventListener("pointerup", release);
            document.removeEventListener("pointercancel", release);
        };
    }, []);

    return (
        <Routes>
            {/* PublicRoute для того чтобы сначала проверить Auth*/}
            <Route
                path="/login"
                element={
                    <PublicRoute>
                        <LoginPage />
                    </PublicRoute>
                }
            />
            {/* Сначала отрисовываем ProtectedRoute перед тем, что внутри */}
            <Route element={<ProtectedRoute />}>
                <Route path="/" element={<MessengerPage />} />
            </Route>
        </Routes>
    );
}

export default App;
