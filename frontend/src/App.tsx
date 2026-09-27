import { Route, Routes } from "react-router";

import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicRoute } from "./components/PublicRoute";
import { LoginPage } from "./pages/LoginPage";
import { MessengerPage } from "./pages/MessengerPage";

function App() {
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
