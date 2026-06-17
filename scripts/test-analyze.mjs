// scripts/test-analyze.mjs

const params = new URLSearchParams({
    inactivity_hours: "3",
    limit: "9999",
});

const response = await fetch(`http://localhost:3000/api/analyze?${params.toString()}`, {
    method: "GET",
});

const json = await response.json();

console.log(JSON.stringify(json, null, 2));

if (!response.ok) {
    process.exit(1);
}