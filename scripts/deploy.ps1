[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$CommitMessage
)

$ErrorActionPreference = "Stop"
$message = ($CommitMessage -join " ").Trim()

if ([string]::IsNullOrWhiteSpace($message)) {
    Write-Host "Usage: npm run deploy -- <commit message>" -ForegroundColor Yellow
    exit 1
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$mergeConflict = $false
$completed = $false

function Invoke-Git {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    Write-Host "> git $($Arguments -join ' ')" -ForegroundColor Cyan
    & git @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')"
    }
}

Push-Location $repoRoot

try {
    $currentBranch = (& git branch --show-current).Trim()

    if ($LASTEXITCODE -ne 0) {
        throw "Could not determine the current Git branch."
    }

    if ($currentBranch -ne "preview") {
        throw "Run this command from the preview branch. Current branch: $currentBranch"
    }

    Invoke-Git add .

    & git diff --cached --quiet
    $diffExitCode = $LASTEXITCODE

    if ($diffExitCode -eq 0) {
        throw "There is nothing to commit."
    }

    if ($diffExitCode -ne 1) {
        throw "Could not inspect the staged changes."
    }

    Invoke-Git commit -m $message
    Invoke-Git push
    Invoke-Git checkout main
    Invoke-Git pull

    try {
        Invoke-Git merge preview
    }
    catch {
        $conflictedFiles = @(& git diff --name-only --diff-filter=U)

        if ($conflictedFiles.Count -gt 0) {
            $mergeConflict = $true
        }

        throw
    }

    Invoke-Git push
    Invoke-Git checkout preview

    $completed = $true
    Write-Host "Done. preview was merged into main and you are back on preview." -ForegroundColor Green
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red

    if ($mergeConflict) {
        Write-Host "Merge conflicts were found. You are still on main so you can resolve them." -ForegroundColor Yellow
    }
    elseif (-not $completed) {
        $currentBranch = (& git branch --show-current).Trim()

        if ($LASTEXITCODE -eq 0 -and $currentBranch -ne "preview") {
            Write-Host "Returning to preview..." -ForegroundColor Yellow
            & git checkout preview
        }
    }

    exit 1
}
finally {
    Pop-Location
}
