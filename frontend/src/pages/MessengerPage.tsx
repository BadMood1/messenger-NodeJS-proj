import { useAuth } from "../features/auth/useAuth";

export const MessengerPage = () => {
    const { user } = useAuth();

    return (
        <main className="min-h-screen bg-flux-page p-8">
            <h1 className="text-2xl font-semibold text-slate-900">
                FLUX
            </h1>

            <p className="mt-2 text-slate-500">
                Welcome, {user?.username}
            </p>
        </main>
    );
};
