// app/layout.tsx
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import { InviteRedirect } from "@/components/auth/InviteRedirect";
import { CurrentUserProvider } from "@/components/auth/CurrentUserProvider";
import { PermissionGuard } from "@/components/auth/PermissionGuard";
import PermanentClientProfilePanel from "@/components/clientes/PermanentClientProfilePanel";
import { FloatingConversationPanel } from "@/components/conversations/FloatingConversationPanel";
import { DashboardDateFilterProvider } from "@/components/dashboard/DashboardDateFilterProvider";
import SidePanel from "@/components/layout/SidePanel";
import {
    dashboardDateFilterBootstrapScript,
    DATE_FILTER_COOKIE_NAME,
    parseDashboardDateFilterCookie,
} from "@/lib/dashboard/dateFilterStorage";

const inter = Inter({
    variable: "--font-inter",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Engravida Hub",
    description: "Dashboard de análise de atendimento",
    icons: {
        icon: "/favicon.ico",
    },
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const cookieStore = await cookies();
    const initialDateFilters = parseDashboardDateFilterCookie(
        cookieStore.get(DATE_FILTER_COOKIE_NAME)?.value,
    );

    return (
        <html lang="pt-BR" className={`${inter.variable} antialiased`}>
            <head>
                <script
                    dangerouslySetInnerHTML={{
                        __html: dashboardDateFilterBootstrapScript(),
                    }}
                />
            </head>
            <body>
                <DashboardDateFilterProvider
                    initialFilters={initialDateFilters}
                >
                    <InviteRedirect />

                    <CurrentUserProvider>
                        <PermissionGuard>
                            <div className="flex min-h-dvh w-full flex-col overflow-hidden md:h-screen md:min-h-0 md:w-screen md:flex-row">
                                <SidePanel persistent />

                                <div className="app-content min-h-0 min-w-0 flex-1 overflow-hidden [&>main]:!w-full [&>main]:!max-w-full">
                                    {children}
                                </div>

                                <FloatingConversationPanel />
                                <PermanentClientProfilePanel />
                            </div>
                        </PermissionGuard>
                    </CurrentUserProvider>
                </DashboardDateFilterProvider>
            </body>
        </html>
    );
}
