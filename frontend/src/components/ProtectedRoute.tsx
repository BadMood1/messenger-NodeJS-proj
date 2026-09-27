import { Navigate, Outlet } from "react-router";

import { useAuth } from "../features/auth/useAuth";

export const ProtectedRoute = () => {
    const { user, loading } = useAuth();

    if (loading) {
        return <p>Loading...</p>;
    }

    // Outlet - место для вложенного маршрута ( / и т.д.)
    return user ? <Outlet /> : <Navigate to="/login" replace />;
};
