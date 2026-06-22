// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { InviteRedirect } from "@/components/auth/InviteRedirect";
import { CurrentUserProvider } from "@/components/auth/CurrentUserProvider";
import { PermissionGuard } from "@/components/auth/PermissionGuard";
import { FloatingConversationPanel } from "@/components/conversations/FloatingConversationPanel";
import SidePanel from "@/components/layout/SidePanel";

const inter = Inter({
    variable: "--font-inter",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Engravida Insights",
    description: "Dashboard de análise de atendimento",
    icons: {
        icon: "/favicon.ico",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="pt-BR" className={`${inter.variable} antialiased`}>
        <body>
        <InviteRedirect />

        <div className="flex min-h-screen items-center justify-center bg-white px-6 text-center md:hidden">
            <div>
                <h1 className="text-2xl font-bold text-slate-950">
                    Acesse pelo computador
                </h1>

                <p className="mt-3 text-sm leading-6 text-slate-500">
                    O Engravida Insights foi feito para telas maiores.
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
        </body>
        </html>
    );
}
