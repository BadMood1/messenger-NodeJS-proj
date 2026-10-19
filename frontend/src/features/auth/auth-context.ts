import { createContext } from "react";

import type { AuthenticatedRequest } from "./authenticated-request";
import type { User } from "./auth.api";

export type AuthContextValue = {
    user: User | null;
    accessToken: string | null;
    loading: boolean;
    login: (identifier: string, password: string) => Promise<void>;
    authenticatedRequest: AuthenticatedRequest;
    getAccessToken: () => string | null;
    resolveAccessTokenAfter401: (rejectedToken: string) => Promise<string | null>;
};

// Сам Context выносим отдельно, чтобы AuthProvider.tsx
// экспортировал только React-компонент
export const AuthContext = createContext<AuthContextValue | null>(null);
