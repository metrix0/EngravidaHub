$ErrorActionPreference = "Stop"

$ZipRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ProjectRoot = Resolve-Path (Get-Location)

function Copy-ProjectFile($RelativePath) {
    $source = Join-Path $ZipRoot $RelativePath
    $target = Join-Path $ProjectRoot $RelativePath
    $targetDir = Split-Path $target -Parent

    if (!(Test-Path $source)) {
        throw "Missing source file in ZIP: $RelativePath"
    }

    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    Copy-Item -Force $source $target
    Write-Host "Updated $RelativePath"
}

Copy-ProjectFile "components/conversations/ChatMessageBubble.tsx"
Copy-ProjectFile "components/conversations/ChatMessageList.tsx"
Copy-ProjectFile "components/conversations/FloatingConversationPanel.tsx"
Copy-ProjectFile "app/inbox/page.tsx"

$clientesPath = Join-Path $ProjectRoot "app/clientes/page.tsx"

if (!(Test-Path $clientesPath)) {
    throw "Could not find app/clientes/page.tsx. Run this script from the project root."
}

$content = Get-Content $clientesPath -Raw

$content = $content -replace '(?m)^import ThreadConversationPanel from "@/components/clientes/ThreadConversationPanel";\r?\n', ''
$content = $content -replace '(?m)^\s*const \[selectedThreadId, setSelectedThreadId\] = useState<string \| null>\(null\);\r?\n', ''
$content = $content -replace '(?m)^\s*onOpenThread=\{setSelectedThreadId\}\r?\n', ''
$content = $content -replace '(?s)\r?\n\s*<ThreadConversationPanel\s*\r?\n\s*threadId=\{selectedThreadId\}\s*\r?\n\s*onClose=\{\(\) => setSelectedThreadId\(null\)\}\s*\r?\n\s*/>\s*', "`r`n"

Set-Content -Path $clientesPath -Value $content -NoNewline
Write-Host "Patched app/clientes/page.tsx"

$threadPanelPath = Join-Path $ProjectRoot "components/clientes/ThreadConversationPanel.tsx"
if (Test-Path $threadPanelPath) {
    Remove-Item -Force $threadPanelPath
    Write-Host "Deleted components/clientes/ThreadConversationPanel.tsx"
}

Write-Host "Done. Now run: pnpm build"
