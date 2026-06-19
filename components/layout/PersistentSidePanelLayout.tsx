// components/layout/PersistentSidePanelLayout.tsx
"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import SidePanel from "@/components/layout/SidePanel";

export default function PersistentSidePanelLayout({
                                                      children,
                                                  }: {
    children: ReactNode;
}) {
    const pathname = usePathname();
    const isInbox = pathname.startsWith("/inbox");

    return (
        <div className="flex h-screen w-screen overflow-hidden">
            <div className="persistent-layout-sidepanel">
                <SidePanel
                    affectLayout={!isInbox}
                    defaultExpanded={!isInbox}
                />
            </div>

            <div className="persistent-app-content min-w-0 flex-1 overflow-hidden">
                {children}
            </div>

            <style jsx global>{`
                /*
                 * Every page still contains its old SidePanel for now.
                 * Hide those page-level instances; the persistent instance
                 * above is the only visible sidebar.
                 */
                .persistent-app-content > main > div.relative.z-50.h-screen.shrink-0 {
                    display: none !important;
                }

                /*
                 * Pages previously used w-screen because the sidebar lived
                 * inside each page. Inside the persistent layout they must
                 * use the available content width instead.
                 */
                .persistent-app-content > main {
                    width: 100% !important;
                    max-width: 100% !important;
                    min-width: 0 !important;
                }

                /*
                 * CSS hover is immediately recalculated after a refresh,
                 * unlike the previous React mouse-enter state. This keeps
                 * the collapse chevron visible when the cursor was already
                 * over the expanded sidebar during refresh.
                 */
                .persistent-layout-sidepanel aside:hover
                    > button.absolute.top-\[46px\] {
                    pointer-events: auto !important;
                    opacity: 1 !important;
                }
            `}</style>
        </div>
    );
}
