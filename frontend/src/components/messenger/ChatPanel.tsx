import { CheckCheck, MoreHorizontal, Phone, Plus, Search, SendHorizontal, Smile, Video } from "lucide-react";

export const ChatPanel = () => (
    <section className="flux-chat-panel">
        <header className="flux-chat-header">
            <div className="flex items-center gap-3">
                <div className="flux-chat-avatar">M</div>
                <div>
                    <h2 className="text-base font-semibold leading-5 text-slate-900 dark:text-slate-50">Mira</h2>
                    <p className="mt-0.5 text-xs text-emerald-600 dark:text-teal-300">Online</p>
                </div>
            </div>

            <div className="flex items-center gap-1">
                <button type="button" className="flux-icon-button" aria-label="Search chat">
                    <Search size={19} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button type="button" className="flux-icon-button" aria-label="Call">
                    <Phone size={19} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button type="button" className="flux-icon-button" aria-label="Video call">
                    <Video size={20} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button type="button" className="flux-icon-button" aria-label="More options">
                    <MoreHorizontal size={20} strokeWidth={1.8} aria-hidden="true" />
                </button>
            </div>
        </header>

        <div className="flux-chat-messages">
            <div className="flux-message-stack">
                <div className="flux-message-day" role="separator">
                    <span>Today</span>
                </div>

                <div className="flux-message-placeholder flux-message-placeholder-incoming">
                    <span className="flux-message-text">Hey!</span>
                    <span className="flux-message-meta-spacer" aria-hidden="true" />
                    <span className="flux-message-meta">
                        <time>14:18</time>
                    </span>
                </div>

                <div className="flux-message-placeholder flux-message-placeholder-outgoing ml-auto">
                    <span className="flux-message-text">Hi!</span>
                    <span className="flux-message-meta-spacer" aria-hidden="true" />
                    <span className="flux-message-meta">
                        <time>14:19</time>
                        <CheckCheck size={16} strokeWidth={2} aria-label="Read" />
                    </span>
                </div>

                <div className="flux-message-placeholder flux-message-placeholder-incoming">
                    <span className="flux-message-text">Are you still working on the new design?</span>
                    <span className="flux-message-meta-spacer" aria-hidden="true" />
                    <span className="flux-message-meta">
                        <time>14:20</time>
                    </span>
                </div>

                <div className="flux-message-placeholder flux-message-placeholder-outgoing ml-auto">
                    <span className="flux-message-text">Yes, I&apos;m finishing the spacing now.</span>
                    <span className="flux-message-meta-spacer" aria-hidden="true" />
                    <span className="flux-message-meta">
                        <time>14:21</time>
                        <CheckCheck size={16} strokeWidth={2} aria-label="Read" />
                    </span>
                </div>

                <div className="flux-message-placeholder flux-message-placeholder-incoming">
                    <span className="flux-message-text">
                        I finished most of it, but I still want to tweak the spacing before we ship it.
                    </span>
                    <span className="flux-message-meta-spacer" aria-hidden="true" />
                    <span className="flux-message-meta">
                        <time>14:22</time>
                    </span>
                </div>

                <div className="flux-message-placeholder flux-message-placeholder-outgoing ml-auto">
                    <span className="flux-message-text">
                        That sounds good. I also want to check how it feels on smaller screens.
                    </span>
                    <span className="flux-message-meta-spacer" aria-hidden="true" />
                    <span className="flux-message-meta">
                        <time>14:23</time>
                        <CheckCheck size={16} strokeWidth={2} aria-label="Read" />
                    </span>
                </div>

                <div className="flux-message-photo ml-auto" role="img" aria-label="Mountain lake at dusk">
                    <div className="flux-message-photo-scene" />
                    <div className="flux-message-photo-meta">
                        <time>14:24</time>
                        <CheckCheck size={16} strokeWidth={2} aria-label="Read" />
                    </div>
                </div>

                <div className="flux-message-placeholder flux-message-placeholder-incoming">
                    <span className="flux-message-text">
                        The direction already feels much cleaner, and the calmer spacing makes the whole conversation easier to scan.
                    </span>
                    <span className="flux-message-meta-spacer" aria-hidden="true" />
                    <span className="flux-message-meta">
                        <time>14:25</time>
                    </span>
                </div>

                <div className="flux-message-placeholder flux-message-placeholder-outgoing ml-auto">
                    <span className="flux-message-text">
                        Pretty good! I finished the main part of the design, but there are still a few small details I want to improve before calling it done.
                    </span>
                    <span className="flux-message-meta-spacer" aria-hidden="true" />
                    <span className="flux-message-meta">
                        <time>14:26</time>
                        <CheckCheck size={16} strokeWidth={2} aria-label="Read" />
                    </span>
                </div>
            </div>
        </div>

        <footer className="shrink-0 border-t border-slate-200/60 p-3.5 dark:border-white/8 lg:p-4">
            <div className="flux-composer">
                <button type="button" className="flux-composer-action" aria-label="Add attachment">
                    <Plus size={20} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <input
                    type="text"
                    className="flux-composer-input"
                    placeholder="Message Mira..."
                    aria-label="Message Mira"
                />
                <button type="button" className="flux-composer-emoji" aria-label="Choose emoji">
                    <Smile size={18} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button type="button" className="flux-composer-send" aria-label="Send message">
                    <SendHorizontal size={17} strokeWidth={1.8} aria-hidden="true" />
                </button>
            </div>
        </footer>
    </section>
);
