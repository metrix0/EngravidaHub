// app/layout.tsx
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import { InviteRedirect } from "@/components/auth/InviteRedirect";
import { CurrentUserProvider } from "@/components/auth/CurrentUserProvider";
import { PermissionGuard } from "@/components/auth/PermissionGuard";
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

                    <div className="flex min-h-screen items-center justify-center bg-white px-6 text-center md:hidden">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-950">
                                Acesse pelo computador
                            </h1>

                            <p className="mt-3 text-sm leading-6 text-slate-500">
                                O Engravida Hub foi feito para telas maiores.
                                Abra em um notebook ou computador para visualizar o dashboard.
                            </p>
                        </div>
                    </div>

                    <div className="hidden md:block">
                        <CurrentUserProvider>
                            <PermissionGuard>
                                <div className="flex h-screen w-screen overflow-hidden">
                                    <SidePanel persistent />

                                    <div className="min-w-0 flex-1 overflow-hidden [&>main]:!w-full [&>main]:!max-w-full">
                                        {children}
                                    </div>

                                    <FloatingConversationPanel />
                                </div>
                            </PermissionGuard>
                        </CurrentUserProvider>
                    </div>
                </DashboardDateFilterProvider>
            </body>
        </html>
    );
}
