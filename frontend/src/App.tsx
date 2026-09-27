import { Route, Routes } from "react-router";

import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { MessengerPage } from "./pages/MessengerPage";

function App() {
    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Сначала отрисовываем ProtectedRoute перед тем, что внутри */}
            <Route element={<ProtectedRoute />}>
                <Route path="/" element={<MessengerPage />} />
            </Route>
        </Routes>
    );
}

export default App;
