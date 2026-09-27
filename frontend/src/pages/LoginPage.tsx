import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "../features/auth/useAuth";

const LightDecor = () => (
    <div className="flux-light-decor">
        <div className="flux-light-bubble-left" />
        <div className="flux-light-card-glow" />
        <div className="flux-light-bubble-right" />
        <div className="flux-light-blue-glow" />
        <div className="flux-light-mint-glow" />
        <div className="flux-light-violet-glow" />
    </div>
);

const DarkDecor = () => (
    <div className="flux-dark-decor">
        <div className="flux-dark-cloud-left">
            <div className="flux-dark-cloud-left-base" />
            <div className="flux-dark-cloud-left-lobe-one" />
            <div className="flux-dark-cloud-left-lobe-two" />
            <div className="flux-dark-cloud-left-lobe-three" />
        </div>

        <div className="flux-dark-cloud-right">
            <div className="flux-dark-cloud-right-base" />
            <div className="flux-dark-cloud-right-lobe-one" />
            <div className="flux-dark-cloud-right-lobe-two" />
            <div className="flux-dark-cloud-right-lobe-three" />
        </div>

        <div className="flux-dark-center-haze" />
        <div className="flux-dark-card-glow" />
        <div className="flux-dark-sphere-left" />
        <div className="flux-dark-sphere-right" />
    </div>
);

const BottomDecor = () => (
    <>
        <img src="/decor/login-bottom-light.png" alt="" className="flux-bottom-decor flux-bottom-light" />
        <img src="/decor/login-bottom-dark.png" alt="" className="flux-bottom-decor flux-bottom-dark" />
    </>
);

export const LoginPage = () => {
    const { login } = useAuth();
    const navigate = useNavigate();

    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();

        try {
            setError("");
            setIsSubmitting(true);
            await login(identifier, password);

            // После успешного login переходим в мессенджер
            navigate("/");
        } catch {
            setError("Неверный username/email или пароль");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <main className="flux-login-page">
            {/* ==================== LIGHT DECOR ==================== */}
            <LightDecor />

            {/* ==================== DARK DECOR ==================== */}
            <DarkDecor />

            {/* ==================== BOTTOM DECOR ==================== */}
            <BottomDecor />

            <section className="flux-login-content">
                {/* ==================== BRAND ==================== */}
                <div className="flux-login-brand">
                    {/* Сам браузер выбирает logo под системную тему */}
                    <picture>
                        <source srcSet="/brand/logo-dark.png" media="(prefers-color-scheme: dark)" />
                        <img src="/brand/logo-light.png" alt="FLUX" className="flux-brand-logo" />
                    </picture>

                    <h1 className="flux-brand-name">FLUX</h1>
                    <p className="flux-brand-tagline">Conversations flow better here.</p>
                </div>

                {/* ==================== LOGIN CARD ==================== */}
                <div className="flux-login-card">
                    <div className="mb-7">
                        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                            Welcome back
                        </h1>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            Sign in to continue to FLUX
                        </p>
                    </div>

                    {/* ==================== FORM ==================== */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="identifier" className="flux-login-label">
                                Username or email
                            </label>
                            <input
                                id="identifier"
                                value={identifier}
                                onChange={(event) => setIdentifier(event.target.value)}
                                autoComplete="username"
                                placeholder="bmoood"
                                className="flux-input"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="flux-login-label">
                                Password
                            </label>
                            <input
                                id="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                type="password"
                                autoComplete="current-password"
                                placeholder="••••••••"
                                className="flux-input"
                            />
                        </div>

                        {error && <p className="text-sm text-red-500">{error}</p>}

                        <button type="submit" disabled={isSubmitting} className="flux-primary-button">
                            {isSubmitting ? "Signing in..." : "Sign in"}
                        </button>
                    </form>

                    <div className="my-6 flex items-center gap-4">
                        <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                        <span className="text-xs text-slate-400">or</span>
                        <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                    </div>

                    <button type="button" className="flux-secondary-button">
                        Create a new account
                    </button>
                </div>

                {/* ==================== FOOTER ==================== */}
                <p className="flux-login-footer">PEOPLE / IDEAS / ALWAYS IN FLOW</p>
            </section>
        </main>
    );
};
