<#
.SYNOPSIS
    Sauvegarde quotidienne de Cyberjet Compliance.

.DESCRIPTION
    Deux choses à sauvegarder, et l'une sans l'autre ne permet pas de
    restaurer :

      * la base SQL Server « CyberjetCompliance » — clients, questionnaires,
        comptes, journal d'audit ;
      * le dossier App_Data — les fichiers reçus et les exports produits, qui
        ne sont pas en base mais référencés par chemin.

    Rétention en grand-père / père / fils : 30 sauvegardes quotidiennes, plus
    une par mois gardée un an. On peut ainsi remonter à n'importe quel jour du
    mois écoulé, et à la fin de chaque mois sur l'année passée, sans conserver
    365 copies.

.NOTES
    BACKUP DATABASE s'exécute sous le compte du service SQL Server
    (« NT Service\MSSQL$SQLEXPRESS »), pas sous celui qui lance ce script : le
    dossier de destination doit donc lui être ouvert en écriture. Le script s'en
    charge à la première exécution, une fois pour toutes.

    L'inverse — écrire dans le dossier de l'instance puis déplacer — ne marche
    pas : ce dossier n'est lisible que par le service, et le déplacement échoue
    sur un « accès refusé » alors même que la sauvegarde a réussi.
#>

[CmdletBinding()]
param(
    # Où déposer les sauvegardes. À placer de préférence sur un autre disque
    # que celui de l'application : une panne matérielle emporterait sinon les
    # deux d'un coup.
    [string] $Destination = 'C:\Sauvegardes\Cyberjet',

    [string] $Instance = '.\SQLEXPRESS',
    [string] $Database = 'CyberjetCompliance',

    # Dossier des fichiers reçus et produits, tel que Storage:DataDirectory le
    # désigne dans appsettings.json. Vide = déduit de l'emplacement du script :
    # $PSScriptRoot n'est pas encore renseigné ici, il ne l'est qu'une fois le
    # corps du script atteint.
    [string] $DataDirectory = '',

    [int] $DailyRetention = 30,
    [int] $MonthlyRetention = 12
)

$ErrorActionPreference = 'Stop'

if (-not $DataDirectory) {
    $DataDirectory = Join-Path $PSScriptRoot '..\server\Cyberjet.Api\App_Data'
}

function Write-Step { param([string] $Message) Write-Host "  $Message" }

# Un échec doit laisser une trace ET remonter au planificateur : sans code de
# sortie non nul, la tâche s'affiche « réussie » alors que rien n'a été
# sauvegardé.
trap {
    $message = "{0}  ECHEC  {1}" -f (Get-Date -Format 's'), $_.Exception.Message
    try {
        if (-not (Test-Path $Destination)) {
            New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        }
        Add-Content -Path (Join-Path $Destination 'journal.log') -Value $message -Encoding utf8
    } catch { }
    Write-Error $_
    exit 1
}

# --------------------------------------------------------------------------
# Préparation
# --------------------------------------------------------------------------

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$today = Get-Date

# Une sauvegarde mensuelle est simplement la première du mois : inutile de
# dupliquer le travail, on range la même archive dans « mensuelles ».
$isMonthly = $today.Day -eq 1

$dailyDir   = Join-Path $Destination 'quotidiennes'
$monthlyDir = Join-Path $Destination 'mensuelles'

foreach ($dir in @($Destination, $dailyDir, $monthlyDir)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

$sqlcmd = Get-ChildItem 'C:\Program Files\Microsoft SQL Server' -Recurse -Filter 'SQLCMD.EXE' `
              -ErrorAction SilentlyContinue |
          Select-Object -First 1 -ExpandProperty FullName
if (-not $sqlcmd) { throw "SQLCMD.EXE introuvable : SQL Server est-il bien installé ?" }

# Le service SQL écrit lui-même la sauvegarde : sans ce droit, BACKUP DATABASE
# échoue sur « accès refusé ». Accordé une fois, il persiste — la vérification
# ne coûte rien et rend le script autonome sur un poste neuf.
$serviceAccount = (Get-CimInstance Win32_Service -Filter "Name='MSSQL`$SQLEXPRESS'").StartName
if ($serviceAccount) {
    $acl = Get-Acl $dailyDir
    $alreadyGranted = $acl.Access | Where-Object {
        $_.IdentityReference -like "*$($serviceAccount -replace '^NT Service\\', '')*"
    }
    if (-not $alreadyGranted) {
        foreach ($dir in @($dailyDir, $monthlyDir)) {
            $rules = Get-Acl $dir
            $rules.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
                $serviceAccount, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
            Set-Acl -Path $dir -AclObject $rules
        }
        Write-Step "Droits d'écriture accordés à $serviceAccount."
    }
}

Write-Host "Sauvegarde Cyberjet Compliance — $stamp"

# --------------------------------------------------------------------------
# 1. Base de données
# --------------------------------------------------------------------------

Write-Step 'Base de données…'

# WITH COMPRESSION est absent d'Express : ne pas le demander, l'ordre échouerait.
# CHECKSUM fait vérifier les pages à l'écriture — une sauvegarde qu'on ne peut
# pas relire ne vaut rien, autant le découvrir maintenant.
$dbTarget = Join-Path $dailyDir "${Database}_$stamp.bak"

$backupSql = "BACKUP DATABASE [$Database] TO DISK = N'$dbTarget' " +
             "WITH FORMAT, INIT, CHECKSUM, NAME = N'Cyberjet Compliance $stamp';"
& $sqlcmd -S $Instance -E -C -b -Q $backupSql | Out-Null
if ($LASTEXITCODE -ne 0) { throw "BACKUP DATABASE a échoué (code $LASTEXITCODE)." }

# Relecture immédiate : confirme que l'archive est lisible et non tronquée.
& $sqlcmd -S $Instance -E -C -b -Q "RESTORE VERIFYONLY FROM DISK = N'$dbTarget' WITH CHECKSUM;" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "La sauvegarde produite est illisible (RESTORE VERIFYONLY)." }

$dbSizeMo = [math]::Round((Get-Item $dbTarget).Length / 1MB, 1)
Write-Step "  -> $dbTarget ($dbSizeMo Mo)"

# --------------------------------------------------------------------------
# 2. Fichiers reçus et produits
# --------------------------------------------------------------------------

Write-Step 'Fichiers (App_Data)…'

$filesTarget = Join-Path $dailyDir "App_Data_$stamp.zip"
if (Test-Path $DataDirectory) {
    $resolved = (Resolve-Path $DataDirectory).Path
    # -Force pour embarquer d'éventuels fichiers cachés ; sans lui, une archive
    # paraîtrait complète en l'étant pas.
    Compress-Archive -Path (Join-Path $resolved '*') -DestinationPath $filesTarget `
                     -CompressionLevel Optimal -Force
    $filesSizeKo = [math]::Round((Get-Item $filesTarget).Length / 1KB, 0)
    Write-Step "  -> $filesTarget ($filesSizeKo Ko)"
} else {
    Write-Warning "Dossier introuvable : $DataDirectory — aucun fichier sauvegardé."
}

# --------------------------------------------------------------------------
# 3. Copie mensuelle
# --------------------------------------------------------------------------

if ($isMonthly) {
    Write-Step 'Copie mensuelle (premier jour du mois)…'
    Copy-Item $dbTarget -Destination $monthlyDir -Force
    if (Test-Path $filesTarget) { Copy-Item $filesTarget -Destination $monthlyDir -Force }
}

# --------------------------------------------------------------------------
# 4. Rétention
# --------------------------------------------------------------------------

function Remove-Older {
    param([string] $Directory, [int] $Keep, [string] $Pattern)

    # On compte par jeu (base + fichiers d'une même date), pas par fichier :
    # sinon 30 fichiers correspondraient à seulement 15 jours conservés.
    $sets = Get-ChildItem $Directory -Filter $Pattern -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending
    if ($sets.Count -le $Keep) { return 0 }

    $doomed = $sets | Select-Object -Skip $Keep
    foreach ($file in $doomed) {
        # Le jeu du même horodatage part avec : une base sans ses fichiers ne
        # restaure qu'à moitié, la garder ne rendrait service à personne.
        $suffix = $file.Name -replace '^.*?_(\d{4}-\d{2}-\d{2}_\d{4})\..*$', '$1'
        Get-ChildItem $Directory -Filter "*_$suffix.*" -ErrorAction SilentlyContinue |
            Remove-Item -Force
    }
    return $doomed.Count
}

$removedDaily   = Remove-Older -Directory $dailyDir   -Keep $DailyRetention   -Pattern "$Database`_*.bak"
$removedMonthly = Remove-Older -Directory $monthlyDir -Keep $MonthlyRetention -Pattern "$Database`_*.bak"

if ($removedDaily -or $removedMonthly) {
    Write-Step "Rétention : $removedDaily quotidienne(s), $removedMonthly mensuelle(s) supprimée(s)."
}

# --------------------------------------------------------------------------
# Bilan
# --------------------------------------------------------------------------

$dailyCount   = (Get-ChildItem $dailyDir   -Filter "$Database`_*.bak" -EA SilentlyContinue).Count
$monthlyCount = (Get-ChildItem $monthlyDir -Filter "$Database`_*.bak" -EA SilentlyContinue).Count
$total        = (Get-ChildItem $Destination -Recurse -File -EA SilentlyContinue |
                 Measure-Object Length -Sum).Sum
$totalMo      = [math]::Round($total / 1MB, 1)

Write-Host "Termine - $dailyCount quotidienne(s), $monthlyCount mensuelle(s), $totalMo Mo au total."

# Journal : lancée par le planificateur, la sortie console ne va nulle part.
# Une sauvegarde qui échoue en silence pendant des semaines est pire que pas de
# sauvegarde du tout — on croit être protégé.
$logLine = "{0}  OK  {1} quotidienne(s), {2} mensuelle(s), {3} Mo" -f `
           (Get-Date -Format 's'), $dailyCount, $monthlyCount, $totalMo
Add-Content -Path (Join-Path $Destination 'journal.log') -Value $logLine -Encoding utf8
