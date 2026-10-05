// Компоненты в стиле shadcn/ui на Radix, адаптированные к поверхностям FLUX.
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { useEffect, useRef, type ComponentProps } from "react";

import { cn } from "../../lib/utils";

export const ContextMenu = ContextMenuPrimitive.Root;

export const ContextMenuTrigger = ({
    disabled, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, ...props
}: ComponentProps<typeof ContextMenuPrimitive.Trigger>) => {
    const timerRef = useRef(0);
    const cancelHold = () => window.clearTimeout(timerRef.current);
    useEffect(() => () => window.clearTimeout(timerRef.current), []);
    useEffect(() => { if (disabled) window.clearTimeout(timerRef.current); }, [disabled]);

    return <ContextMenuPrimitive.Trigger
        {...props}
        disabled={disabled}
        onPointerDown={(event) => {
            onPointerDown?.(event);
            if (disabled || event.defaultPrevented || event.pointerType === "mouse") return;
            // Вместо встроенных 700 мс открываем тот же Radix menu через 350 мс.
            event.preventDefault();
            cancelHold();
            const { currentTarget, clientX, clientY } = event;
            timerRef.current = window.setTimeout(() => {
                currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY }));
            }, 350);
        }}
        onPointerMove={(event) => { cancelHold(); onPointerMove?.(event); }}
        onPointerUp={(event) => { cancelHold(); onPointerUp?.(event); }}
        onPointerCancel={(event) => { cancelHold(); onPointerCancel?.(event); }}
    />;
};

export const ContextMenuContent = ({
    className,
    ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) => (
    <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
            className={cn(
                "flux-popover-motion z-50 min-w-32 max-h-(--radix-context-menu-content-available-height) overflow-y-auto rounded-xl border border-blue-100 bg-white/95 p-1 text-slate-700 shadow-lg shadow-blue-200/30 backdrop-blur-md dark:border-white/10 dark:bg-[#102238]/95 dark:text-slate-200 dark:shadow-black/20",
                className,
            )}
            {...props}
        />
    </ContextMenuPrimitive.Portal>
);

export const ContextMenuItem = ({
    className,
    ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item>) => (
    <ContextMenuPrimitive.Item
        className={cn(
            "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors focus:bg-blue-50 data-disabled:pointer-events-none data-disabled:opacity-50 dark:focus:bg-white/7 [&_svg]:size-4 [&_svg]:shrink-0",
            className,
        )}
        {...props}
    />
);
