param(
    [string]$DataPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'shunt_data'),
    [ValidateRange(1, 10)][int]$CasesPerLevel = 2,
    [ValidateRange(10, 500)][int]$MaxMiB = 250,
    [switch]$DryRun
)

# Run in a fresh clone. Reads Desktop data; copies only complete, matching cases.
$ErrorActionPreference = 'Stop'
function Invoke-ShuntGit {
    & git @args
    if ($LASTEXITCODE -ne 0) { throw 'Git failed. See the message above.' }
}
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!(Test-Path -LiteralPath $DataPath -PathType Container)) {
    throw "Data folder not found: $DataPath"
}
$source = (Get-Item -LiteralPath $DataPath).FullName
$parts = @('anterior\images', 'anterior\images_patch', 'lateral\images', 'lateral\images_patch')
$groups = @{}
$levelPattern = '(?<![\d.])(0\.5|1\.0|1\.5|2\.0|2\.5)$'
$rolePattern = '(^|[_\s-])(anterior|lateral|ap|lat|images_patch|patch|crop)(?=$|[_\s-])'
$strataViewPattern = '(^|/)(strata_\d+_\d{8}_\d+)(?:0000_A|0001_L)_?$'

foreach ($part in $parts) {
    $folder = Join-Path $source $part
    if (!(Test-Path -LiteralPath $folder -PathType Container)) {
        throw "Required folder missing: $folder"
    }
    foreach ($file in (Get-ChildItem -LiteralPath $folder -File -Recurse)) {
        if ($file.Extension -notmatch '^\.(png|jpe?g|webp|bmp)$') { continue }
        $relative = $file.FullName.Substring($folder.Length + 1)
        $stem = ($relative -replace '\\', '/') -replace '\.[^.]+$', ''
        $stem = ($stem -replace $levelPattern, '') -replace $strataViewPattern, '$1$2'
        $key = $stem -replace $rolePattern, '_'
        $key = (($key -replace '^[_\s-]+|[_\s-]+$', '') -replace '[_\s-]+', '_').ToLowerInvariant()
        if (!$key) { continue }
        if (!$groups.ContainsKey($key)) {
            $groups[$key] = @{ Key = $key; Files = @{}; Levels = @{}; Bytes = [long]0; Invalid = $false }
        }
        $group = $groups[$key]
        if ($group.Files.ContainsKey($part) -or $file.Length -ge 90MB -or $file.Length -eq 0) {
            $group.Invalid = $true
            continue
        }
        $group.Files[$part] = @{ Source = $file.FullName; Relative = (Join-Path $part $relative) }
        $group.Bytes += $file.Length
        $label = [regex]::Match($file.BaseName, $levelPattern)
        if ($label.Success) { $group.Levels[$label.Value] = $true }
    }
}

$eligible = @($groups.Values | Where-Object {
    !$_.Invalid -and $_.Files.Count -eq 4 -and $_.Levels.Count -eq 1
})
$selected = @()
$total = [long]0
foreach ($level in @('0.5', '1.0', '1.5', '2.0', '2.5')) {
    $count = 0
    $candidates = @($eligible | Where-Object { $_.Levels.ContainsKey($level) } |
        Sort-Object @{Expression = { $_.Bytes }}, @{Expression = { $_.Key }})
    foreach ($case in $candidates) {
        if ($count -ge $CasesPerLevel) { break }
        if ($total + $case.Bytes -gt $MaxMiB * 1MB) { continue }
        $selected += $case
        $total += $case.Bytes
        $count++
    }
    Write-Host "PL ${level}: $count case(s) selected"
}
if ($selected.Count -eq 0) {
    throw 'No complete matching cases fit the limit. Check matching AP/LAT/patch filenames and stage suffixes; do not pair files by list order.'
}
Write-Host ('Total: {0} cases / {1} files / {2:N1} MiB' -f $selected.Count, ($selected.Count * 4), ($total / 1MB))
if ($DryRun) { return }

$remote = Invoke-ShuntGit -C $repo remote get-url origin
if ($remote.Trim() -notmatch '^https://github\.com/shxyzn/shunt-viewer(?:\.git)?/?$') {
    throw 'This script must run in a clone of shxyzn/shunt-viewer.'
}
$branch = Invoke-ShuntGit -C $repo branch --show-current
if ($branch.Trim() -ne 'main') { throw 'Use the main branch in a fresh clone.' }
$changes = @(Invoke-ShuntGit -C $repo status --porcelain)
if ($changes.Count -ne 0) { throw 'Use a fresh clone with no local changes.' }
$ahead = Invoke-ShuntGit -C $repo rev-list --count origin/main..HEAD
if ([int]$ahead -ne 0) { throw 'Use a fresh clone without the failed large commit.' }

$caseNumber = 0
foreach ($case in $selected) {
    $caseNumber++
    $level = @($case.Levels.Keys)[0]
    foreach ($part in $parts) {
        $entry = $case.Files[$part]
        # Keep original files untouched; omit source identifiers from public filenames.
        $demoName = 'case{0:D3}_{1}{2}' -f $caseNumber, $level, ([IO.Path]::GetExtension($entry.Source).ToLowerInvariant())
        $destination = Join-Path (Join-Path (Join-Path $repo 'shunt_data') $part) $demoName
        New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
        Copy-Item -LiteralPath $entry.Source -Destination $destination -Force
    }
}
$allData = @(Get-ChildItem -LiteralPath (Join-Path $repo 'shunt_data') -File -Recurse)
$allBytes = ($allData | Measure-Object -Property Length -Sum).Sum
if ($allBytes -gt 500MB -or @($allData | Where-Object { $_.Length -ge 90MB }).Count -gt 0) {
    throw 'Repository data exceeds the demo budget. Nothing has been committed or pushed.'
}
Invoke-ShuntGit -C $repo add -- shunt_data
& git -C $repo diff --cached --quiet -- shunt_data
if ($LASTEXITCODE -eq 0) {
    Write-Host 'These selected files are already in the repository. Nothing to upload.'
    return
}
if ($LASTEXITCODE -ne 1) { throw 'Could not inspect staged changes.' }
Invoke-ShuntGit -C $repo -c user.name=shxyzn -c user.email=123629921+shxyzn@users.noreply.github.com commit -m 'Add small, paired shunt demo dataset'
Invoke-ShuntGit -C $repo push origin main
Write-Host 'Upload complete. Desktop originals were not changed.'
