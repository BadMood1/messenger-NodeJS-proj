// Компоненты shadcn/ui (Radix), адаптированные к поверхностям FLUX.
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = ({
    className,
    sideOffset = 6,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) => (
    <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
            sideOffset={sideOffset}
            className={cn(
                "z-50 min-w-32 max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto rounded-xl border border-blue-100 bg-white/95 p-1 text-slate-700 shadow-lg shadow-blue-200/30 backdrop-blur-md dark:border-white/10 dark:bg-[#102238]/95 dark:text-slate-200 dark:shadow-black/20",
                className,
            )}
            {...props}
        />
    </DropdownMenuPrimitive.Portal>
);

export const DropdownMenuItem = ({
    className,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) => (
    <DropdownMenuPrimitive.Item
        className={cn(
            "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors focus:bg-blue-50 data-disabled:pointer-events-none data-disabled:opacity-50 dark:focus:bg-white/7 [&_svg]:size-4 [&_svg]:shrink-0",
            className,
        )}
        {...props}
    />
);
