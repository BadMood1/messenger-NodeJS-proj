import { useContext } from "react";

import { AuthContext } from "./auth-context";

export const useAuth = () => {
    const context = useContext(AuthContext);

    // Хук должен использоваться только внутри AuthProvider
    if (!context) {
        throw new Error("useAuth must be used inside AuthProvider");
    }

    return context;
};
