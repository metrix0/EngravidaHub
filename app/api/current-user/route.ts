import { NextResponse } from "next/server";

import { getCurrentUserResponse } from "@/lib/auth/getCurrentUserResponse";

export async function GET() {
    try {
        return NextResponse.json(await getCurrentUserResponse());
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load current user",
            },
            { status: 500 },
        );
    }
}
