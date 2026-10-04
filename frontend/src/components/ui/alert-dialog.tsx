// Компоненты shadcn/ui (Radix), адаптированные к поверхностям FLUX.
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

export const AlertDialog = AlertDialogPrimitive.Root;

export const AlertDialogContent = ({
    className,
    onOutsideClick,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content> & { onOutsideClick?: () => void }) => (
    <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
            className="flux-overlay-motion fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm"
            onClick={onOutsideClick}
        />
        <AlertDialogPrimitive.Content
            className={cn(
                "flux-popover-motion fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border border-blue-100 bg-white p-6 text-slate-900 shadow-xl dark:border-white/10 dark:bg-[#102238] dark:text-slate-100",
                className,
            )}
            {...props}
        />
    </AlertDialogPrimitive.Portal>
);

export const AlertDialogTitle = ({
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) => (
    <AlertDialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />
);

export const AlertDialogDescription = ({
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) => (
    <AlertDialogPrimitive.Description
        className={cn("text-sm text-slate-500 dark:text-slate-400", className)}
        {...props}
    />
);

export const AlertDialogCancel = ({
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Cancel>) => (
    <AlertDialogPrimitive.Cancel
        className={cn(
            "rounded-xl border border-blue-100 px-4 py-2 text-sm font-medium transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5 dark:focus-visible:outline-cyan-400",
            className,
        )}
        {...props}
    />
);

export const AlertDialogAction = ({
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Action>) => (
    <AlertDialogPrimitive.Action
        className={cn(
            "rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 disabled:opacity-50",
            className,
        )}
        {...props}
    />
);
