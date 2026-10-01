import { MessageCircleMore, Settings, UsersRound } from "lucide-react";

type NavRailProps = {
    username?: string;
};

export const NavRail = ({ username = "bmoood" }: NavRailProps) => {
    const avatarLetter = username.charAt(0).toUpperCase();

    return (
        <nav className="flux-nav-rail" aria-label="Основная навигация">
            <div className="flex flex-col items-center">
                <div className="flux-nav-brand" aria-label="FLUX">
                    <img
                        src="/brand/logo-light.png"
                        alt=""
                        className="h-14 w-14 object-contain dark:hidden"
                    />
                    <img
                        src="/brand/logo-dark.png"
                        alt=""
                        className="hidden h-12 w-12 object-contain dark:block"
                    />
                </div>

                <div className="mt-10 flex w-full flex-col gap-2">
                    <button type="button" className="flux-nav-item flux-nav-item-active" aria-current="page">
                        <MessageCircleMore size={21} strokeWidth={1.8} aria-hidden="true" />
                        <span>Chats</span>
                    </button>

                    <button type="button" className="flux-nav-item">
                        <UsersRound size={21} strokeWidth={1.8} aria-hidden="true" />
                        <span>Friends</span>
                    </button>
                </div>
            </div>

            <div className="flex flex-col items-center gap-4">
                <div className="flex flex-col items-center gap-1.5">
                    <div className="flux-nav-avatar">
                        {avatarLetter}
                        <span aria-hidden="true" />
                    </div>
                </div>

                <button type="button" className="flux-icon-button" aria-label="Settings">
                    <Settings size={19} strokeWidth={1.8} aria-hidden="true" />
                </button>
            </div>
        </nav>
    );
};
