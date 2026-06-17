// app/src/lib/attendants/currentAttendantApi.ts
export type CurrentAttendant = {
    id: string;
    name: string;
    email: string | null;
    active: boolean;
    is_online: boolean;
    auth_user_id: string | null;
    units?: {
        id: string;
        name: string;
    } | null;
};

export type CurrentAttendantResponse = {
    ok: boolean;
    debug?: unknown;
    user: {
        id: string;
        email: string | null;
    } | null;
    attendant: CurrentAttendant | null;
};

export async function fetchCurrentAttendant() {
    const response = await fetch("/api/current-attendant", {
        credentials: "include",
    });

    const json = await response.json();

    console.log("[currentAttendantApi] fetchCurrentAttendant response", json);

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to load current attendant");
    }

    return json as CurrentAttendantResponse;
}

export async function setCurrentAttendantOnline() {
    const response = await fetch("/api/current-attendant/online", {
        method: "POST",
        credentials: "include",
    });

    const json = await response.json();

    console.log("[currentAttendantApi] setCurrentAttendantOnline response", json);

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to set attendant online");
    }

    return json as {
        ok: boolean;
        attendant: CurrentAttendant;
    };
}

export async function setCurrentAttendantOffline() {
    const response = await fetch("/api/current-attendant/offline", {
        method: "POST",
        credentials: "include",
    });

    const json = await response.json();

    console.log("[currentAttendantApi] setCurrentAttendantOffline response", json);

    if (!response.ok) {
        throw new Error(json.error ?? "Failed to set attendant offline");
    }

    return json as {
        ok: boolean;
        attendant: CurrentAttendant | null;
    };
}