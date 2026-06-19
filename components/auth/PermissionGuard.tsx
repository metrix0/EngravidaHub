// components/auth/PermissionGuard.tsx
"use client";

import { useEffect, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { useCurrentUser } from "@/components/auth/CurrentUserProvider";
import {
    canAccessPathname,
    getFirstAllowedHref,
    getTabIdForPathname,
} from "@/lib/auth/userAccess";

function isPublicPath(pathname: string) {
    return pathname === "/login" || pathname.startsWith("/login/");
}

export function PermissionGuard({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const {
        currentUser,
        isLoadingCurrentUser,
        currentUserError,
    } = useCurrentUser();

    const publicPath = isPublicPath(pathname);
    const authenticated = Boolean(currentUser?.user);
    const guardedTab = getTabIdForPathname(pathname);
    const permission = currentUser?.permission ?? null;
    const allowedTabs = permission?.allowed_tabs ?? [];
    const firstAllowedHref = getFirstAllowedHref(allowedTabs);

    const shouldRedirectToLogin =
        !publicPath &&
        !isLoadingCurrentUser &&
        !currentUserError &&
        !authenticated;

    const shouldRedirectForPermission =
        !publicPath &&
        authenticated &&
        Boolean(permission?.active) &&
        Boolean(guardedTab) &&
        !canAccessPathname(pathname, allowedTabs) &&
        Boolean(firstAllowedHref);

    useEffect(() => {
        if (!shouldRedirectToLogin) return;

        const next = pathname || "/";
        router.replace(`/login?next=${encodeURIComponent(next)}`);
    }, [pathname, router, shouldRedirectToLogin]);

    useEffect(() => {
        if (!shouldRedirectForPermission || !firstAllowedHref) return;

        router.replace(firstAllowedHref);
    }, [firstAllowedHref, router, shouldRedirectForPermission]);

    if (publicPath) {
        return <>{children}</>;
    }

    if (isLoadingCurrentUser && !authenticated) {
        return <AccessLoading />;
    }

    // Never expose the protected application when authentication could not be
    // verified. A temporary API failure shows an explicit error instead of
    // failing open and rendering every page.
    if (currentUserError && !authenticated) {
        return (
            <AccessMessage
                title="Não foi possível validar o acesso"
                description="Atualize a página para tentar novamente."
            />
        );
    }

    if (!authenticated) {
        return <AccessLoading />;
    }

    // No permission row means no tabs. Access must be explicitly granted in
    // Usuários instead of falling back to full access.
    if (!permission) {
        return (
            <AccessMessage
                title="Nenhuma aba liberada"
                description="Seu usuário não possui nenhuma aba permitida no momento."
            />
        );
    }

    if (!permission.active) {
        return (
            <AccessMessage
                title="Acesso desativado"
                description="Seu acesso ao Engravida Hub está inativo. Entre em contato com um administrador."
            />
        );
    }

    if (!canAccessPathname(pathname, allowedTabs)) {
        if (firstAllowedHref) {
            return <AccessLoading />;
        }

        return (
            <AccessMessage
                title="Nenhuma aba liberada"
                description="Seu usuário não possui nenhuma aba permitida no momento."
            />
        );
    }

    return <>{children}</>;
}

function AccessLoading() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-white">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand" />
        </div>
    );
}

function AccessMessage({
    title,
    description,
}: {
    title: string;
    description: string;
}) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-white px-6">
            <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-soft text-red">
                    <ShieldAlert size={24} />
                </div>

                <h1 className="mt-5 text-xl font-bold text-slate-950">
                    {title}
                </h1>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                    {description}
                </p>
            </div>
        </div>
    );
}
