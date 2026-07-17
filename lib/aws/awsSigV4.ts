// lib/aws/awsSigV4.ts
import { createHash, createHmac } from "node:crypto";

type AwsRequest = {
    service: "bedrock" | "s3";
    region: string;
    method: "GET" | "POST" | "PUT" | "HEAD" | "DELETE";
    url: string;
    body?: string | Uint8Array;
    headers?: Record<string, string>;
};

export async function awsFetch(request: AwsRequest) {
    const accessKeyId = requiredEnv("AWS_ACCESS_KEY_ID");
    const secretAccessKey = requiredEnv("AWS_SECRET_ACCESS_KEY");
    const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const url = new URL(request.url);
    const payload = request.body ?? "";
    const payloadHash = sha256(payload);

    const headers = new Headers(request.headers);
    headers.set("host", url.host);
    headers.set("x-amz-date", amzDate);
    headers.set("x-amz-content-sha256", payloadHash);
    if (sessionToken) headers.set("x-amz-security-token", sessionToken);

    const signedHeaderNames = [...headers.keys()]
        .map((name) => name.toLowerCase())
        .sort();
    const canonicalHeaders = signedHeaderNames
        .map((name) => `${name}:${normalizeHeaderValue(headers.get(name) ?? "")}`)
        .join("\n");
    const canonicalRequest = [
        request.method,
        canonicalUri(url.pathname),
        canonicalQuery(url.searchParams),
        `${canonicalHeaders}\n`,
        signedHeaderNames.join(";"),
        payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${request.region}/${request.service}/aws4_request`;
    const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        sha256(canonicalRequest),
    ].join("\n");
    const signingKey = getSignatureKey(
        secretAccessKey,
        dateStamp,
        request.region,
        request.service,
    );
    const signature = hmac(signingKey, stringToSign).toString("hex");

    headers.set(
        "authorization",
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
    );

    return fetch(url, {
        method: request.method,
        headers,
        body:
            request.method === "GET" ||
            request.method === "HEAD" ||
            request.method === "DELETE"
                ? undefined
                : (payload as unknown as BodyInit),
        cache: "no-store",
    });
}

export function requiredEnv(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

function canonicalUri(pathname: string) {
    return pathname
        .split("/")
        .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
        .join("/") || "/";
}

function canonicalQuery(searchParams: URLSearchParams) {
    return [...searchParams.entries()]
        .map(([key, value]) => [encodeURIComponent(key), encodeURIComponent(value)] as const)
        .sort(([aKey, aValue], [bKey, bValue]) =>
            aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
        )
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
}

function normalizeHeaderValue(value: string) {
    return value.trim().replace(/\s+/g, " ");
}

function formatAmzDate(date: Date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256(value: string | Uint8Array) {
    return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string) {
    return createHmac("sha256", key).update(value).digest();
}

function getSignatureKey(
    secret: string,
    dateStamp: string,
    region: string,
    service: string,
) {
    const dateKey = hmac(`AWS4${secret}`, dateStamp);
    const regionKey = hmac(dateKey, region);
    const serviceKey = hmac(regionKey, service);
    return hmac(serviceKey, "aws4_request");
}
