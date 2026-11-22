// Компоненты в стиле shadcn/ui на Radix, с существующими поверхностями и анимациями FLUX.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

// Получает содержимое окна и стандартные props Radix Dialog.
// Выводит overlay и окно через Portal; Radix управляет фокусом, Escape и кликом снаружи.
// Возвращает модалку с общими короткими анимациями появления и закрытия.
export const DialogContent = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Content>) => (
    <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
            className="flux-overlay-motion fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm"
        />
        <DialogPrimitive.Content
            className={cn(
                "flux-popover-motion fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-2xl border border-blue-100 bg-white p-5 text-slate-900 shadow-xl dark:border-white/10 dark:bg-[#102238] dark:text-slate-100",
                className,
            )}
            {...props}
        />
    </DialogPrimitive.Portal>
);

// Получает заголовок и стандартные props Radix Title.
// Применяет общую типографику заголовков модалок FLUX.
// Возвращает заголовок, связанный с dialog для screen reader.
export const DialogTitle = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) => (
    <DialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />
);

// Получает описание и стандартные props Radix Description.
// Применяет спокойный цвет второстепенного текста в обеих темах.
// Возвращает описание, связанное с dialog для screen reader.
export const DialogDescription = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) => (
    <DialogPrimitive.Description
        className={cn("text-sm text-slate-500 dark:text-slate-400", className)}
        {...props}
    />
);
