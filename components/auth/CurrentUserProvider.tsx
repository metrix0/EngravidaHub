// components/auth/CurrentUserProvider.tsx
"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

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

export function CurrentUserProvider({ children }: { children: ReactNode }) {
    const [currentUser, setCurrentUser] =
        useState<CurrentUserResponse | null>(null);
    const [isLoadingCurrentUser, setIsLoadingCurrentUser] = useState(true);
    const [currentUserError, setCurrentUserError] = useState<string | null>(null);

    const refreshCurrentUser = useCallback(async (force = false) => {
        const cached = getCachedCurrentUser();

        if (cached) {
            setCurrentUser(cached);
            setIsLoadingCurrentUser(false);
        } else {
            setIsLoadingCurrentUser(true);
        }

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

            return cached;
        } finally {
            setIsLoadingCurrentUser(false);
        }
    }, []);

    useEffect(() => {
        const cached = getCachedCurrentUser();

        if (cached) {
            setCurrentUser(cached);
            setIsLoadingCurrentUser(false);
        }

        const unsubscribe = subscribeCurrentUser((nextCurrentUser) => {
            setCurrentUser(nextCurrentUser);
            setIsLoadingCurrentUser(false);
        });

        // One validation per full app load. Client-side tab changes reuse this provider.
        void refreshCurrentUser(true);

        function handlePermissionsChanged() {
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
    }, [refreshCurrentUser]);

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
