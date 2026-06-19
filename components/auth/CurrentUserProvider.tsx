// components/auth/CurrentUserProvider.tsx
"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import {
    fetchCurrentUser,
    getCachedCurrentUser,
    subscribeCurrentUser,
    type CurrentUserResponse,
} from "@/lib/auth/currentUserApi";

type CurrentUserContextValue = {
    currentUser: CurrentUserResponse | null;
    isLoadingCurrentUser: boolean;
    currentUserError: string | null;
    refreshCurrentUser: (force?: boolean) => Promise<CurrentUserResponse | null>;
};

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

function isPublicPath(pathname: string) {
    return pathname === "/login" || pathname.startsWith("/login/");
}

export function CurrentUserProvider({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const publicPath = isPublicPath(pathname);
    const validationStartedRef = useRef(false);

    const [currentUser, setCurrentUser] =
        useState<CurrentUserResponse | null>(null);
    const [isLoadingCurrentUser, setIsLoadingCurrentUser] = useState(true);
    const [currentUserError, setCurrentUserError] = useState<string | null>(null);

    const refreshCurrentUser = useCallback(async (force = false) => {
        const cached = getCachedCurrentUser();

        if (!force && cached) {
            setCurrentUser(cached);
            setCurrentUserError(null);
            setIsLoadingCurrentUser(false);
            return cached;
        }

        setIsLoadingCurrentUser(true);

        try {
            setCurrentUserError(null);

            const response = await fetchCurrentUser({ force });
            setCurrentUser(response);

            return response;
        } catch (error) {
            console.error("[CurrentUserProvider] failed to load current user", error);

            setCurrentUserError(
                error instanceof Error
                    ? error.message
                    : "Não foi possível carregar o usuário atual",
            );

            return null;
        } finally {
            setIsLoadingCurrentUser(false);
        }
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeCurrentUser((nextCurrentUser) => {
            setCurrentUser(nextCurrentUser);
        });

        function handlePermissionsChanged() {
            if (publicPath) return;
            void refreshCurrentUser(true);
        }

        window.addEventListener(
            "current-user-permissions-changed",
            handlePermissionsChanged,
        );

        return () => {
            unsubscribe();
            window.removeEventListener(
                "current-user-permissions-changed",
                handlePermissionsChanged,
            );
        };
    }, [publicPath, refreshCurrentUser]);

    useEffect(() => {
        if (publicPath) {
            // The provider survives client-side navigation. Reset this flag on
            // the login page so a successful login is validated exactly once
            // when navigation returns to the protected application.
            validationStartedRef.current = false;
            setCurrentUser(null);
            setCurrentUserError(null);
            setIsLoadingCurrentUser(false);
            return;
        }

        if (validationStartedRef.current) return;

        validationStartedRef.current = true;

        // Validate authentication and load permissions once for the full app
        // session. Root-layout persistence means changing tabs reuses this data
        // without another Supabase permissions query.
        void refreshCurrentUser(true);
    }, [publicPath, refreshCurrentUser]);

    const value = useMemo<CurrentUserContextValue>(
        () => ({
            currentUser,
            isLoadingCurrentUser,
            currentUserError,
            refreshCurrentUser,
        }),
        [
            currentUser,
            isLoadingCurrentUser,
            currentUserError,
            refreshCurrentUser,
        ],
    );

    return (
        <CurrentUserContext.Provider value={value}>
            {children}
        </CurrentUserContext.Provider>
    );
}

export function useCurrentUser() {
    const context = useContext(CurrentUserContext);

    if (!context) {
        throw new Error("useCurrentUser must be used inside CurrentUserProvider");
    }

    return context;
}
