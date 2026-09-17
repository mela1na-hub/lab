$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$port = 8766
$prefix = "http://127.0.0.1:$port/"
$dataDir = Join-Path $root "data"
$uploadDir = Join-Path $root "images\uploads"
$adminDataPath = Join-Path $root "admin-data.json"
$mediaPath = Join-Path $dataDir "site-media.json"
$overridesPath = Join-Path $dataDir "district-overrides.json"
$galleryPath = Join-Path $dataDir "gallery.json"
$contactPath = Join-Path $dataDir "contact.json"
$staffPath = Join-Path $dataDir "staff.json"
$districtsPath = Join-Path $dataDir "districts.json"
$dailyLogsPath = Join-Path $dataDir "daily-logs.json"
$galleryImgDir = Join-Path $root "images\gallery"
$galleryVidDir = Join-Path $root "media\gallery"
$reportsDir = Join-Path $root "files\reports"

@(
  $uploadDir,
  $galleryImgDir,
  $galleryVidDir,
  $reportsDir
) | ForEach-Object {
  if (-not (Test-Path -LiteralPath $_)) {
    New-Item -ItemType Directory -Path $_ -Force | Out-Null
  }
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$blockedNames = @(
  "admin-data.json",
  "serve.ps1",
  "serve.log",
  "OCHISH.bat",
  ".gitignore",
  "daily-logs.json"
)

$script:Sessions = @{}
$script:DefaultDirectorPassword = "director123"
$script:DefaultWorkerPassword = "ishchi123"
$script:DefaultAdminPassword = "admin123"
$script:AuthUsers = @{}

function Normalize-Password($value, $fallback) {
  $p = [string]$value
  if ([string]::IsNullOrWhiteSpace($p)) { return [string]$fallback }
  return $p
}

function Load-AuthUsers {
  $data = Get-AdminData
  $dirPass = Normalize-Password $data.directorPassword $script:DefaultDirectorPassword
  $workPass = Normalize-Password $data.workerPassword $script:DefaultWorkerPassword
  $adminPass = Normalize-Password $data.adminPassword $script:DefaultAdminPassword
  $script:AuthUsers = @{
    director = @{ password = $dirPass;   role = "director"; label = "Direktor"; workerId = "" }
    ishchi   = @{ password = $workPass;  role = "worker";   label = "Ishchi";   workerId = "" }
    admin    = @{ password = $adminPass; role = "admin";    label = "Sayt admin"; workerId = "" }
  }
  $reserved = @("director", "admin", "ishchi")
  foreach ($w in (As-Array $data.workers)) {
    $login = ([string]$w.login).Trim().ToLowerInvariant()
    $pass = [string]$w.password
    $wid = [string]$w.id
    if ([string]::IsNullOrWhiteSpace($login) -or [string]::IsNullOrWhiteSpace($pass) -or [string]::IsNullOrWhiteSpace($wid)) { continue }
    if ($reserved -contains $login) { continue }
    if ($script:AuthUsers.ContainsKey($login)) { continue }
    $script:AuthUsers[$login] = @{
      password = $pass
      role     = "worker"
      label    = [string]$w.name
      workerId = $wid
    }
  }
}

function Drop-Sessions($role) {
  $keys = @($script:Sessions.Keys)
  foreach ($k in $keys) {
    if ($role -and [string]$script:Sessions[$k].role -ne [string]$role) { continue }
    $script:Sessions.Remove($k)
  }
}

function Get-Auth($ctx) {
  $cookie = $ctx.Request.Cookies["ttati_sid"]
  if (-not $cookie -or [string]::IsNullOrWhiteSpace([string]$cookie.Value)) { return $null }
  $sid = [string]$cookie.Value
  if ($script:Sessions.ContainsKey($sid)) { return $script:Sessions[$sid] }
  return $null
}

function Set-AuthCookie($ctx, $sid, $clear) {
  if ($clear) {
    $ctx.Response.Headers.Add("Set-Cookie", "ttati_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
  } else {
    $ctx.Response.Headers.Add("Set-Cookie", "ttati_sid=$sid; Path=/; HttpOnly; SameSite=Lax")
  }
}

function Is-ProtectedData($local) {
  $n = ($local -replace '\\', '/').TrimStart('/').ToLowerInvariant()
  if ($n -eq "data/districts.json") { return $true }
  if ($n -eq "data/district-overrides.json") { return $true }
  if ($n.StartsWith("files/reports/")) { return $true }
  return $false
}

function As-Array($value) {
  if ($null -eq $value) { return @() }
  if ($value -is [System.Array]) { return @($value) }
  return @($value)
}

function New-WorkerId {
  return [guid]::NewGuid().ToString("N").Substring(0, 12)
}

function Normalize-Worker($w, $old) {
  $id = ([string]$w.id).Trim()
  if ([string]::IsNullOrWhiteSpace($id) -and $old) { $id = ([string]$old.id).Trim() }
  if ([string]::IsNullOrWhiteSpace($id)) { $id = New-WorkerId }
  $login = ([string]$w.login).Trim().ToLowerInvariant()
  $password = [string]$w.password
  if ([string]::IsNullOrWhiteSpace($password) -and $old) { $password = [string]$old.password }
  if ([string]::IsNullOrWhiteSpace($login) -and $old) { $login = ([string]$old.login).Trim().ToLowerInvariant() }
  return @{
    id       = $id
    name     = ([string]$w.name).Trim()
    lavozim  = ([string]$w.lavozim).Trim()
    telegram = ([string]$w.telegram).Trim()
    login    = $login
    password = $password
  }
}

function Today-Ymd {
  return (Get-Date).ToString("yyyy-MM-dd")
}

function Parse-Ymd($value) {
  try {
    return [datetime]::ParseExact(([string]$value).Trim(), "yyyy-MM-dd", [cultureinfo]::InvariantCulture)
  } catch {
    return $null
  }
}

function Is-RestDay($dt) {
  if ($null -eq $dt) { return $false }
  $d = $dt.DayOfWeek
  return ($d -eq [DayOfWeek]::Saturday -or $d -eq [DayOfWeek]::Sunday)
}

function Get-DailyLogs {
  $data = Read-JsonFile $dailyLogsPath ([pscustomobject]@{ logs = @() })
  if ($null -eq $data.logs) { $data | Add-Member -NotePropertyName logs -NotePropertyValue @() -Force }
  return $data
}

function Save-DailyLogs($data) {
  Write-JsonFile $dailyLogsPath @{ logs = @(As-Array $data.logs) }
}

function Find-WorkerById($id) {
  $want = ([string]$id).Trim()
  if ([string]::IsNullOrWhiteSpace($want)) { return $null }
  foreach ($w in (As-Array (Get-AdminData).workers)) {
    if ([string]$w.id -eq $want) { return $w }
  }
  return $null
}

function Worker-Brief($w) {
  if ($null -eq $w) { return $null }
  return @{
    id      = [string]$w.id
    name    = [string]$w.name
    lavozim = [string]$w.lavozim
  }
}

function To-JsonList($items) {
  $arr = @()
  foreach ($i in (As-Array $items)) {
    $arr += , $i
  }
  if ($arr.Count -eq 0) { return @() }
  if ($arr.Count -eq 1) { return @(, $arr[0]) }
  return $arr
}

function Find-WorkerByName($name) {
  $want = ([string]$name).Trim().ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($want)) { return $null }
  foreach ($w in (As-Array (Get-AdminData).workers)) {
    if (([string]$w.name).Trim().ToLowerInvariant() -eq $want) { return $w }
  }
  return $null
}

function Add-NamedWorker($name, $lavozim) {
  $name = ([string]$name).Trim()
  $lavozim = ([string]$lavozim).Trim()
  if ([string]::IsNullOrWhiteSpace($name)) { return $null }
  if ([string]::IsNullOrWhiteSpace($lavozim)) { $lavozim = "Ishchi" }
  $existing = Find-WorkerByName $name
  if ($existing) { return $existing }
  $data = Get-AdminData
  $nw = Normalize-Worker @{
    name     = $name
    lavozim  = $lavozim
    telegram = ""
    login    = ""
    password = ""
  } $null
  $workers = @()
  foreach ($w in (As-Array $data.workers)) {
    $workers += , $w
  }
  $workers += , $nw
  $data.workers = $workers
  Save-AdminData $data
  Sync-StaffWorkers $workers
  return $nw
}

function Delete-NamedWorker($id) {
  $want = ([string]$id).Trim()
  if ([string]::IsNullOrWhiteSpace($want)) { return $false }
  $data = Get-AdminData
  $kept = @()
  $found = $false
  foreach ($w in (As-Array $data.workers)) {
    if ([string]$w.id -eq $want) {
      $found = $true
      continue
    }
    $kept += , $w
  }
  if (-not $found) { return $false }
  $data.workers = $kept
  Save-AdminData $data
  Sync-StaffWorkers $kept
  return $true
}

function Update-NamedWorker($id, $name, $lavozim) {
  $want = ([string]$id).Trim()
  $name = ([string]$name).Trim()
  $lavozim = ([string]$lavozim).Trim()
  if ([string]::IsNullOrWhiteSpace($want) -or [string]::IsNullOrWhiteSpace($name)) { return $null }
  if ([string]::IsNullOrWhiteSpace($lavozim)) { $lavozim = "Ishchi" }
  $data = Get-AdminData
  $kept = @()
  $updated = $null
  foreach ($w in (As-Array $data.workers)) {
    if ([string]$w.id -eq $want) {
      $nw = Normalize-Worker $w $w
      $nw.name = $name
      $nw.lavozim = $lavozim
      $updated = $nw
      $kept += , $nw
    } else {
      $kept += , $w
    }
  }
  if ($null -eq $updated) { return $null }
  $data.workers = $kept
  Save-AdminData $data
  Sync-StaffWorkers $kept
  return $updated
}

function Normalize-Announcement($a) {
  $id = ([string]$a.id).Trim()
  if ([string]::IsNullOrWhiteSpace($id)) { $id = New-WorkerId }
  return @{
    id        = $id
    title     = [string]$a.title
    message   = [string]$a.message
    createdAt = [string]$a.createdAt
  }
}

function Read-JsonFile($path, $fallback) {
  if (-not (Test-Path -LiteralPath $path)) { return $fallback }
  try {
    $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return $fallback }
    return $raw | ConvertFrom-Json
  } catch {
    return $fallback
  }
}

function Write-JsonFile($path, $obj) {
  $json = $obj | ConvertTo-Json -Depth 20 -Compress
  $dir = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
}

function Get-AdminData {
  $data = Read-JsonFile $adminDataPath ([pscustomobject]@{
    botToken           = ""
    botUsername        = ""
    workers            = @()
    announcements      = @()
    telegramChats      = @()
    telegramOffset     = 0
    directorPassword   = $script:DefaultDirectorPassword
    workerPassword     = $script:DefaultWorkerPassword
    adminPassword      = $script:DefaultAdminPassword
  })
  if ($null -eq $data.botToken) { $data | Add-Member -NotePropertyName botToken -NotePropertyValue "" -Force }
  if ($null -eq $data.botUsername) { $data | Add-Member -NotePropertyName botUsername -NotePropertyValue "" -Force }
  if ($null -eq $data.workers) { $data | Add-Member -NotePropertyName workers -NotePropertyValue @() -Force }
  if ($null -eq $data.announcements) { $data | Add-Member -NotePropertyName announcements -NotePropertyValue @() -Force }
  if ($null -eq $data.telegramChats) { $data | Add-Member -NotePropertyName telegramChats -NotePropertyValue @() -Force }
  if ($null -eq $data.telegramOffset) { $data | Add-Member -NotePropertyName telegramOffset -NotePropertyValue 0 -Force }
  if ($null -eq $data.directorPassword) { $data | Add-Member -NotePropertyName directorPassword -NotePropertyValue $script:DefaultDirectorPassword -Force }
  if ($null -eq $data.workerPassword) { $data | Add-Member -NotePropertyName workerPassword -NotePropertyValue $script:DefaultWorkerPassword -Force }
  if ($null -eq $data.adminPassword) { $data | Add-Member -NotePropertyName adminPassword -NotePropertyValue $script:DefaultAdminPassword -Force }
  if ([string]::IsNullOrWhiteSpace([string]$data.directorPassword)) { $data.directorPassword = $script:DefaultDirectorPassword }
  if ([string]::IsNullOrWhiteSpace([string]$data.workerPassword)) { $data.workerPassword = $script:DefaultWorkerPassword }
  if ([string]::IsNullOrWhiteSpace([string]$data.adminPassword)) { $data.adminPassword = $script:DefaultAdminPassword }
  $normalized = @()
  $idsChanged = $false
  foreach ($w in (As-Array $data.workers)) {
    $nw = Normalize-Worker $w $null
    if ([string]::IsNullOrWhiteSpace([string]$w.id)) { $idsChanged = $true }
    $normalized += $nw
  }
  $data.workers = $normalized
  $annsNorm = @()
  $annChanged = $false
  foreach ($a in (As-Array $data.announcements)) {
    if ([string]::IsNullOrWhiteSpace([string]$a.id)) { $annChanged = $true }
    $annsNorm += , (Normalize-Announcement $a)
  }
  $data.announcements = $annsNorm
  if ($idsChanged -or $annChanged) { Save-AdminData $data }
  return $data
}

function Save-AdminData($data) {
  $payload = @{
    botToken         = [string]$data.botToken
    botUsername      = [string]$data.botUsername
    workers          = @(As-Array $data.workers)
    announcements    = @(As-Array $data.announcements)
    telegramChats    = @(As-Array $data.telegramChats)
    telegramOffset   = [int64]$data.telegramOffset
    directorPassword = Normalize-Password $data.directorPassword $script:DefaultDirectorPassword
    workerPassword   = Normalize-Password $data.workerPassword $script:DefaultWorkerPassword
    adminPassword    = Normalize-Password $data.adminPassword $script:DefaultAdminPassword
  }
  Write-JsonFile $adminDataPath $payload
}

function Get-Media {
  $media = Read-JsonFile $mediaPath ([pscustomobject]@{
    hero     = "images/bo-linma.png"
    building = "images/bo-linma.png"
    v        = 1
  })
  if ([string]::IsNullOrWhiteSpace([string]$media.hero)) { $media.hero = "images/bo-linma.png" }
  if ([string]::IsNullOrWhiteSpace([string]$media.building)) { $media.building = "images/bo-linma.png" }
  if (-not $media.v) { $media | Add-Member -NotePropertyName v -NotePropertyValue 1 -Force }
  return $media
}

function Save-Media($media) {
  Write-JsonFile $mediaPath @{
    hero     = [string]$media.hero
    building = [string]$media.building
    v        = [int]$media.v
  }
}

function Contact-Public {
  $c = Get-Contact
  return @{
    phone   = [string]$c.phone
    email   = [string]$c.email
    address = [string]$c.address
    title   = [string]$c.title
    lat     = [string]$c.lat
    lng     = [string]$c.lng
  }
}

function Get-Contact {
  $c = Read-JsonFile $contactPath ([pscustomobject]@{
    phone   = "+998 71 246-09-50"
    email   = "info@soil.uz"
    address = "Qarshi, Ravoq MFY, Islom Karimov ko‘chasi, 62-uy"
    title   = "Qarshi bo‘linmasi"
    lat     = "38.892663"
    lng     = "65.810101"
  })
  if ([string]::IsNullOrWhiteSpace([string]$c.phone)) { $c | Add-Member -NotePropertyName phone -NotePropertyValue "+998 71 246-09-50" -Force }
  if ([string]::IsNullOrWhiteSpace([string]$c.email)) { $c | Add-Member -NotePropertyName email -NotePropertyValue "info@soil.uz" -Force }
  if ([string]::IsNullOrWhiteSpace([string]$c.address)) { $c | Add-Member -NotePropertyName address -NotePropertyValue "Qarshi, Ravoq MFY, Islom Karimov ko‘chasi, 62-uy" -Force }
  if ([string]::IsNullOrWhiteSpace([string]$c.title)) { $c | Add-Member -NotePropertyName title -NotePropertyValue "Qarshi bo‘linmasi" -Force }
  if ([string]::IsNullOrWhiteSpace([string]$c.lat)) { $c | Add-Member -NotePropertyName lat -NotePropertyValue "38.892663" -Force }
  if ([string]::IsNullOrWhiteSpace([string]$c.lng)) { $c | Add-Member -NotePropertyName lng -NotePropertyValue "65.810101" -Force }
  return $c
}

function Save-Contact($c) {
  Write-JsonFile $contactPath @{
    phone   = [string]$c.phone
    email   = [string]$c.email
    address = [string]$c.address
    title   = [string]$c.title
    lat     = [string]$c.lat
    lng     = [string]$c.lng
  }
}

function Get-Staff {
  $s = Read-JsonFile $staffPath ([pscustomobject]@{
    director = [pscustomobject]@{
      name  = "Bo‘linma direktori"
      role  = "Direktor"
      bio   = "Qashqadaryo bo‘linmasi rahbariyati. Ma’lumotlar admin panel orqali yangilanadi."
      photo = ""
    }
    workers = @()
  })
  if ($null -eq $s.director) {
    $s | Add-Member -NotePropertyName director -NotePropertyValue ([pscustomobject]@{
      name = "Bo‘linma direktori"; role = "Direktor"; bio = ""; photo = ""
    }) -Force
  }
  $dir = $s.director
  if ([string]::IsNullOrWhiteSpace([string]$dir.name)) { $dir | Add-Member -NotePropertyName name -NotePropertyValue "Bo‘linma direktori" -Force }
  if ([string]::IsNullOrWhiteSpace([string]$dir.role)) { $dir | Add-Member -NotePropertyName role -NotePropertyValue "Direktor" -Force }
  if ($null -eq $dir.bio) { $dir | Add-Member -NotePropertyName bio -NotePropertyValue "" -Force }
  if ($null -eq $dir.photo) { $dir | Add-Member -NotePropertyName photo -NotePropertyValue "" -Force }
  if ($null -eq $s.workers) { $s | Add-Member -NotePropertyName workers -NotePropertyValue @() -Force }
  return $s
}

function Staff-Public {
  $s = Get-Staff
  $workers = @()
  foreach ($w in (As-Array $s.workers)) {
    $name = ([string]$w.name).Trim()
    $lavozim = ([string]$w.lavozim).Trim()
    if ($name) {
      $workers += @{
        name    = $name
        lavozim = $lavozim
        photo   = [string]$w.photo
      }
    }
  }
  return @{
    director = @{
      name  = [string]$s.director.name
      role  = [string]$s.director.role
      bio   = [string]$s.director.bio
      photo = [string]$s.director.photo
    }
    workers  = $workers
  }
}

function Save-Staff($director, $workers) {
  Write-JsonFile $staffPath (Staff-From $director $workers)
}

function Staff-From($director, $workers) {
  $wlist = @()
  foreach ($w in (As-Array $workers)) {
    $name = ([string]$w.name).Trim()
    $lavozim = ([string]$w.lavozim).Trim()
    if ($name) {
      $wlist += @{
        name    = $name
        lavozim = $lavozim
        photo   = [string]$w.photo
      }
    }
  }
  return @{
    director = @{
      name  = [string]$director.name
      role  = [string]$director.role
      bio   = [string]$director.bio
      photo = [string]$director.photo
    }
    workers  = $wlist
  }
}

function Sync-StaffWorkers($workers) {
  $s = Get-Staff
  Write-JsonFile $staffPath (Staff-From $s.director $workers)
}

function Get-OverrideList {
  $current = Read-JsonFile $overridesPath ([pscustomobject]@{ districts = @() })
  return @(As-Array $current.districts)
}

function Save-OverrideList($list) {
  Write-JsonFile $overridesPath @{ districts = @(As-Array $list) }
}

function Remove-ReportFile($rel) {
  if ([string]::IsNullOrWhiteSpace($rel)) { return }
  if ($rel -notmatch '^files/reports/') { return }
  $path = Join-Path $root ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
  $full = [IO.Path]::GetFullPath($path)
  $rootFull = [IO.Path]::GetFullPath($root)
  if ($full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full)) {
    Remove-Item -LiteralPath $full -Force
  }
}

function Base-DistrictIds {
  $base = Read-JsonFile $districtsPath ([pscustomobject]@{ districts = @() })
  $ids = @()
  foreach ($d in (As-Array $base.districts)) {
    $id = [string]$d.id
    if ($id) { $ids += $id }
  }
  return $ids
}

function Parse-Coord($raw, $min, $max, $label) {
  $s = ([string]$raw).Trim() -replace ',', '.'
  $n = 0.0
  if (-not [double]::TryParse($s, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$n)) {
    throw "$label noto'g'ri."
  }
  if ($n -lt $min -or $n -gt $max) {
    throw "$label oralig'i noto'g'ri."
  }
  return $n.ToString("0.######", [Globalization.CultureInfo]::InvariantCulture)
}

function Get-Gallery {
  $g = Read-JsonFile $galleryPath ([pscustomobject]@{ items = @(); v = 1 })
  if ($null -eq $g.items) { $g | Add-Member -NotePropertyName items -NotePropertyValue @() -Force }
  if (-not $g.v) { $g | Add-Member -NotePropertyName v -NotePropertyValue 1 -Force }
  return $g
}

function Save-Gallery($gallery) {
  Write-JsonFile $galleryPath @{
    v     = [int]$gallery.v
    items = @(As-Array $gallery.items)
  }
}

function Gallery-Items {
  $items = @()
  foreach ($it in (As-Array (Get-Gallery).items)) {
    $items += @{
      id        = [string]$it.id
      type      = [string]$it.type
      title     = [string]$it.title
      caption   = [string]$it.caption
      src       = [string]$it.src
      createdAt = [string]$it.createdAt
    }
  }
  return $items
}

function New-GalleryId {
  return ("g" + (Get-Date).ToString("yyyyMMddHHmmss") + (Get-Random -Minimum 1000 -Maximum 9999))
}

function Get-YouTubeId($url) {
  $u = [string]$url
  $u = $u.Trim()
  if ($u -match '(?:youtu\.be/|v=|embed/|shorts/)([A-Za-z0-9_-]{6,20})') {
    return $Matches[1]
  }
  if ($u -match '^[A-Za-z0-9_-]{6,20}$') { return $u }
  return $null
}

function Read-Bytes($req, $maxBytes) {
  $len = [int64]$req.ContentLength64
  if ($len -lt 1) { throw "Fayl bo'sh" }
  if ($len -gt $maxBytes) { throw "Fayl juda katta" }
  $ms = New-Object IO.MemoryStream
  $req.InputStream.CopyTo($ms)
  return $ms.ToArray()
}

function Remove-GalleryFile($rel) {
  if ([string]::IsNullOrWhiteSpace($rel)) { return }
  if ($rel -notmatch '^(images|media)/gallery/') { return }
  $path = Join-Path $root ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
  $full = [IO.Path]::GetFullPath($path)
  $rootFull = [IO.Path]::GetFullPath($root)
  if ($full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full)) {
    Remove-Item -LiteralPath $full -Force
  }
}

function Read-Body($req) {
  if ($req.ContentLength64 -gt 12MB) {
    throw "Body too large"
  }
  $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
  try {
    return $reader.ReadToEnd()
  } finally {
    $reader.Close()
  }
}

function Send-Json($ctx, $obj, $code = 200) {
  $json = $obj | ConvertTo-Json -Depth 12 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = "application/json; charset=utf-8"
  $ctx.Response.Headers.Add("Cache-Control", "no-store")
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

function Get-TelegramError($err) {
  $msg = [string]$err.Exception.Message
  try {
    if ($err.ErrorDetails -and $err.ErrorDetails.Message) {
      $parsed = $err.ErrorDetails.Message | ConvertFrom-Json
      if ($parsed.description) { return [string]$parsed.description }
      return [string]$err.ErrorDetails.Message
    }
  } catch {}
  return $msg
}

function Invoke-Telegram($token, $method, $query = $null, $bodyObj = $null) {
  $uri = "https://api.telegram.org/bot$token/$method"
  if ($query) { $uri = "$uri`?$query" }
  try {
    if ($null -eq $bodyObj) {
      return Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 25
    }
    $json = $bodyObj | ConvertTo-Json -Compress -Depth 8
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-RestMethod -Uri $uri -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 25
  } catch {
    throw (Get-TelegramError $_)
  }
}

function Resolve-ChatId($token, $raw) {
  $v = [string]$raw
  $v = $v.Trim()
  if ([string]::IsNullOrWhiteSpace($v)) { throw "Bo'sh Telegram manzili" }
  if ($v -match '^-?\d+$') { return $v }
  $user = $v.TrimStart('@')
  $resp = Invoke-Telegram $token "getChat" ("chat_id=" + [Uri]::EscapeDataString("@$user"))
  if ($resp.ok -and $resp.result.id) { return [string]$resp.result.id }
  throw "@$user uchun chat_id topilmadi. Ishchi botga /start yozishi kerak."
}

function Public-State {
  $data = Get-AdminData
  $media = Get-Media
  $chats = @()
  foreach ($c in (As-Array $data.telegramChats)) {
    $chats += @{
      id       = [string]$c.id
      name     = [string]$c.name
      username = [string]$c.username
      at       = [string]$c.at
    }
  }
  $workers = @()
  foreach ($w in (As-Array $data.workers)) {
    $workers += @{
      id          = [string]$w.id
      name        = [string]$w.name
      lavozim     = [string]$w.lavozim
      telegram    = [string]$w.telegram
      login       = [string]$w.login
      hasPassword = -not [string]::IsNullOrWhiteSpace([string]$w.password)
    }
  }
  $anns = @()
  foreach ($a in (As-Array $data.announcements)) {
    $anns += @{
      id        = [string]$a.id
      title     = [string]$a.title
      message   = [string]$a.message
      createdAt = [string]$a.createdAt
    }
  }
  $hasToken = -not [string]::IsNullOrWhiteSpace([string]$data.botToken)
  $overrides = Read-JsonFile $overridesPath ([pscustomobject]@{ districts = @() })
  return @{
    ok            = $true
    hasToken      = $hasToken
    botUsername   = [string]$data.botUsername
    workers       = $workers
    announcements = $anns
    chats         = $chats
    districts     = @(As-Array $overrides.districts)
    media         = @{
      hero     = [string]$media.hero
      building = [string]$media.building
      v        = [int]$media.v
    }
    gallery       = @(Gallery-Items)
    contact       = (Contact-Public)
    staff         = (Staff-Public)
  }
}

function Handle-Api($ctx) {
  $method = $ctx.Request.HttpMethod.ToUpperInvariant()
  $path = $ctx.Request.Url.AbsolutePath.TrimEnd('/')
  if ([string]::IsNullOrWhiteSpace($path)) { $path = "/" }
  if (-not $path.StartsWith("/api/")) { return $false }

  try {
    if ($method -eq "POST" -and $path -eq "/api/login") {
      Load-AuthUsers
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $username = ([string]$body.username).Trim().ToLowerInvariant()
      $password = [string]$body.password
      if (-not $script:AuthUsers.ContainsKey($username)) {
        Send-Json $ctx @{ ok = $false; error = "Login yoki parol noto'g'ri." } 401
        return $true
      }
      $user = $script:AuthUsers[$username]
      if ([string]$user.password -ne $password) {
        Send-Json $ctx @{ ok = $false; error = "Login yoki parol noto'g'ri." } 401
        return $true
      }
      $sid = [guid]::NewGuid().ToString("N")
      $script:Sessions[$sid] = @{
        username = $username
        role     = [string]$user.role
        label    = [string]$user.label
        workerId = [string]$user.workerId
      }
      Set-AuthCookie $ctx $sid $false
      Send-Json $ctx @{
        ok       = $true
        username = $username
        role     = [string]$user.role
        label    = [string]$user.label
        workerId = [string]$user.workerId
      }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/logout") {
      $cookie = $ctx.Request.Cookies["ttati_sid"]
      if ($cookie -and $script:Sessions.ContainsKey([string]$cookie.Value)) {
        $script:Sessions.Remove([string]$cookie.Value)
      }
      Set-AuthCookie $ctx "" $true
      Send-Json $ctx @{ ok = $true }
      return $true
    }

    if ($method -eq "GET" -and $path -eq "/api/me") {
      $auth = Get-Auth $ctx
      if (-not $auth) {
        Send-Json $ctx @{ ok = $false; error = "Kirish kerak." } 401
        return $true
      }
      Send-Json $ctx @{
        ok       = $true
        username = [string]$auth.username
        role     = [string]$auth.role
        label    = [string]$auth.label
        workerId = [string]$auth.workerId
      }
      return $true
    }

    $reportPosts = @(
      "/api/districts",
      "/api/districts/delete",
      "/api/districts/file"
    )
    $directorPosts = @(
      "/api/announce",
      "/api/announce/delete",
      "/api/daily/staff",
      "/api/daily/staff/delete"
    )
    $workerDailyPosts = @(
      "/api/daily/logs",
      "/api/daily/identity"
    )
    $auth = Get-Auth $ctx
    $role = if ($auth) { [string]$auth.role } else { "" }

    if ($path -eq "/api/state") {
      if (-not $auth -or ($role -ne "admin" -and $role -ne "director")) {
        Send-Json $ctx @{ ok = $false; error = "Ruxsat yo'q." } 403
        return $true
      }
    }
    if ($path -eq "/api/telegram/chats") {
      if (-not $auth -or $role -ne "admin") {
        Send-Json $ctx @{ ok = $false; error = "Ruxsat yo'q." } 403
        return $true
      }
    }
    if ($path -eq "/api/daily/workers" -or $path -eq "/api/daily/logs" -or $path -eq "/api/announcements") {
      if (-not $auth -or ($role -ne "director" -and $role -ne "worker")) {
        Send-Json $ctx @{ ok = $false; error = "Ruxsat yo'q." } 403
        return $true
      }
    }
    if ($method -eq "POST" -and ($reportPosts -contains $path)) {
      if (-not $auth) {
        Send-Json $ctx @{ ok = $false; error = "Kirish kerak." } 401
        return $true
      }
      if ($role -ne "director" -and $role -ne "worker") {
        Send-Json $ctx @{ ok = $false; error = "Ruxsat yo'q." } 403
        return $true
      }
    } elseif ($method -eq "POST" -and ($directorPosts -contains $path)) {
      if (-not $auth -or $role -ne "director") {
        Send-Json $ctx @{ ok = $false; error = "Ruxsat yo'q." } 403
        return $true
      }
    } elseif ($method -eq "POST" -and ($workerDailyPosts -contains $path)) {
      if (-not $auth -or $role -ne "worker") {
        Send-Json $ctx @{ ok = $false; error = "Ruxsat yo'q." } 403
        return $true
      }
    } elseif ($method -eq "POST") {
      if (-not $auth -or $role -ne "admin") {
        Send-Json $ctx @{ ok = $false; error = "Ruxsat yo'q." } 403
        return $true
      }
    }

    if ($method -eq "GET" -and $path -eq "/api/state") {
      Send-Json $ctx (Public-State)
      return $true
    }

    if ($method -eq "GET" -and $path -eq "/api/announcements") {
      $data = Get-AdminData
      $anns = @()
      foreach ($a in (As-Array $data.announcements)) {
        $anns += @{
          id        = [string]$a.id
          title     = [string]$a.title
          message   = [string]$a.message
          createdAt = [string]$a.createdAt
        }
      }
      Send-Json $ctx @{
        ok            = $true
        announcements = (To-JsonList $anns)
      }
      return $true
    }

    if ($method -eq "GET" -and $path -eq "/api/daily/workers") {
      $today = Today-Ymd
      $todayDt = Parse-Ymd $today
      $restToday = Is-RestDay $todayDt
      $logged = @{}
      foreach ($log in (As-Array (Get-DailyLogs).logs)) {
        if ([string]$log.date -eq $today) { $logged[[string]$log.workerId] = $true }
      }
      $list = @()
      foreach ($w in (As-Array (Get-AdminData).workers)) {
        $wid = [string]$w.id
        $status = "miss"
        if ($restToday) { $status = "rest" }
        elseif ($logged.ContainsKey($wid)) { $status = "ok" }
        $list += @{
          id           = $wid
          name         = [string]$w.name
          lavozim      = [string]$w.lavozim
          todayStatus  = $status
        }
      }
      Send-Json $ctx @{
        ok       = $true
        today    = $today
        workerId = [string]$auth.workerId
        workers  = (To-JsonList $list)
      }
      return $true
    }

    if ($method -eq "GET" -and $path -eq "/api/daily/logs") {
      $qs = $ctx.Request.QueryString
      $workerId = ([string]$qs["workerId"]).Trim()
      if ($role -eq "worker") {
        $own = ([string]$auth.workerId).Trim()
        if ([string]::IsNullOrWhiteSpace($own)) {
          Send-Json $ctx @{ ok = $false; error = "Avval ismingizni tanlang." } 403
          return $true
        }
        if ([string]::IsNullOrWhiteSpace($workerId)) { $workerId = $own }
        if ($workerId -ne $own) {
          Send-Json $ctx @{ ok = $false; error = "Ruxsat yo'q." } 403
          return $true
        }
      }
      if ([string]::IsNullOrWhiteSpace($workerId)) {
        Send-Json $ctx @{ ok = $false; error = "Ishchi tanlanmadi." } 400
        return $true
      }
      $worker = Find-WorkerById $workerId
      if ($null -eq $worker) {
        Send-Json $ctx @{ ok = $false; error = "Ishchi topilmadi." } 404
        return $true
      }
      $now = Get-Date
      $year = $now.Year
      $month = $now.Month
      $yRaw = [string]$qs["year"]
      $mRaw = [string]$qs["month"]
      if ($yRaw -match '^[0-9]{4}$') { $year = [int]$yRaw }
      if ($mRaw -match '^[0-9]{1,2}$') { $month = [int]$mRaw }
      if ($year -lt 2000 -or $year -gt 2100) { $year = $now.Year }
      if ($month -lt 1 -or $month -gt 12) { $month = $now.Month }
      $prefixDate = "{0:D4}-{1:D2}-" -f $year, $month
      $items = @()
      foreach ($log in (As-Array (Get-DailyLogs).logs)) {
        if ([string]$log.workerId -ne $workerId) { continue }
        $d = [string]$log.date
        if ($d.StartsWith($prefixDate)) {
          $items += @{
            date = $d
            text = [string]$log.text
          }
        }
      }
      Send-Json $ctx @{
        ok     = $true
        today  = Today-Ymd
        year   = $year
        month  = $month
        worker = (Worker-Brief $worker)
        logs   = (To-JsonList $items)
      }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/daily/identity") {
      if ([string]$auth.username -ne "ishchi" -and -not [string]::IsNullOrWhiteSpace([string]$auth.workerId)) {
        Send-Json $ctx @{
          ok       = $true
          workerId = [string]$auth.workerId
          label    = [string]$auth.label
        }
        return $true
      }
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $workerId = ([string]$body.workerId).Trim()
      $name = ([string]$body.name).Trim()
      $lavozim = ([string]$body.lavozim).Trim()
      $worker = $null
      if (-not [string]::IsNullOrWhiteSpace($workerId)) {
        $worker = Find-WorkerById $workerId
      }
      if ($null -eq $worker -and -not [string]::IsNullOrWhiteSpace($name)) {
        $worker = Add-NamedWorker $name $lavozim
      }
      if ($null -eq $worker) {
        Send-Json $ctx @{ ok = $false; error = "Ismingizni yozing yoki ro'yxatdan tanlang." } 400
        return $true
      }
      $auth.workerId = [string]$worker.id
      $auth.label = [string]$worker.name
      Send-Json $ctx @{
        ok       = $true
        workerId = [string]$worker.id
        label    = [string]$worker.name
      }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/daily/staff") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $name = ([string]$body.name).Trim()
      $lavozim = ([string]$body.lavozim).Trim()
      $id = ([string]$body.id).Trim()
      $worker = $null
      if (-not [string]::IsNullOrWhiteSpace($id)) {
        $worker = Update-NamedWorker $id $name $lavozim
        if ($null -eq $worker) {
          Send-Json $ctx @{ ok = $false; error = "Ishchi topilmadi." } 404
          return $true
        }
      } else {
        $worker = Add-NamedWorker $name $lavozim
        if ($null -eq $worker) {
          Send-Json $ctx @{ ok = $false; error = "Ishchi ismini yozing." } 400
          return $true
        }
      }
      Send-Json $ctx @{
        ok     = $true
        worker = (Worker-Brief $worker)
      }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/daily/staff/delete") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $id = ([string]$body.id).Trim()
      if (-not (Delete-NamedWorker $id)) {
        Send-Json $ctx @{ ok = $false; error = "Ishchi topilmadi." } 404
        return $true
      }
      Send-Json $ctx @{ ok = $true }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/daily/logs") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $workerId = ([string]$auth.workerId).Trim()
      if ([string]::IsNullOrWhiteSpace($workerId)) {
        $workerId = ([string]$body.workerId).Trim()
      }
      $worker = Find-WorkerById $workerId
      if ($null -eq $worker) {
        Send-Json $ctx @{ ok = $false; error = "Avval ismingizni tanlang." } 400
        return $true
      }
      if (-not [string]::IsNullOrWhiteSpace([string]$auth.workerId) -and [string]$auth.workerId -ne [string]$worker.id) {
        Send-Json $ctx @{ ok = $false; error = "Ruxsat yo'q." } 403
        return $true
      }
      $dateStr = ([string]$body.date).Trim()
      if ([string]::IsNullOrWhiteSpace($dateStr)) { $dateStr = Today-Ymd }
      $dt = Parse-Ymd $dateStr
      if ($null -eq $dt) {
        Send-Json $ctx @{ ok = $false; error = "Sana noto'g'ri." } 400
        return $true
      }
      $dateStr = $dt.ToString("yyyy-MM-dd")
      $todayDt = Parse-Ymd (Today-Ymd)
      if ($dt.Date -gt $todayDt.Date) {
        Send-Json $ctx @{ ok = $false; error = "Kelasi kun uchun yozib bo'lmaydi." } 400
        return $true
      }
      if (Is-RestDay $dt) {
        Send-Json $ctx @{ ok = $false; error = "Dam olish kunida hisobot yozilmaydi." } 400
        return $true
      }
      $text = ([string]$body.text).Trim()
      if ([string]::IsNullOrWhiteSpace($text)) {
        Send-Json $ctx @{ ok = $false; error = "Bugun nima qilganingizni yozing." } 400
        return $true
      }
      if ($text.Length -gt 4000) { $text = $text.Substring(0, 4000) }
      $store = Get-DailyLogs
      $kept = @()
      foreach ($log in (As-Array $store.logs)) {
        if ([string]$log.workerId -eq [string]$worker.id -and [string]$log.date -eq $dateStr) { continue }
        $kept += $log
      }
      $kept += @{
        id        = New-WorkerId
        workerId  = [string]$worker.id
        date      = $dateStr
        text      = $text
        updatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm")
      }
      $store.logs = $kept
      Save-DailyLogs $store
      if ([string]::IsNullOrWhiteSpace([string]$auth.workerId)) {
        $auth.workerId = [string]$worker.id
        $auth.label = [string]$worker.name
      }
      Send-Json $ctx @{
        ok       = $true
        date     = $dateStr
        text     = $text
        workerId = [string]$worker.id
      }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/token") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $token = [string]$body.token
      $token = $token.Trim()
      $data = Get-AdminData
      if ([string]::IsNullOrWhiteSpace($token)) {
        $data.botToken = ""
        $data.botUsername = ""
        Save-AdminData $data
        Send-Json $ctx @{ ok = $true; hasToken = $false; botUsername = "" }
        return $true
      }
      if ($token -notmatch '^\d+:[A-Za-z0-9_-]+$') {
        Send-Json $ctx @{ ok = $false; error = "Token formati noto'g'ri. BotFather'dan olingan to'liq tokenni yozing." } 400
        return $true
      }
      $me = Invoke-Telegram $token "getMe"
      if (-not $me.ok) {
        Send-Json $ctx @{ ok = $false; error = "Telegram tokenni qabul qilmadi." } 400
        return $true
      }
      try { Invoke-Telegram $token "deleteWebhook" | Out-Null } catch {}
      $uname = [string]$me.result.username
      $data.botToken = $token
      $data | Add-Member -NotePropertyName botUsername -NotePropertyValue $uname -Force
      Save-AdminData $data
      Send-Json $ctx @{ ok = $true; hasToken = $true; botUsername = $uname }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/workers") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $data = Get-AdminData
      $oldMap = @{}
      foreach ($ow in (As-Array $data.workers)) {
        if ($ow.id) { $oldMap[[string]$ow.id] = $ow }
        $keyName = (([string]$ow.name).Trim().ToLowerInvariant() + "|" + ([string]$ow.telegram).Trim())
        if (-not $oldMap.ContainsKey($keyName)) { $oldMap[$keyName] = $ow }
      }
      $list = @()
      $usedLogins = @{ director = $true; admin = $true; ishchi = $true }
      foreach ($w in (As-Array $body.workers)) {
        $name = ([string]$w.name).Trim()
        $lavozim = ([string]$w.lavozim).Trim()
        $telegram = ([string]$w.telegram).Trim()
        if (-not ($name -and $lavozim)) { continue }
        $old = $null
        $wid = ([string]$w.id).Trim()
        if ($wid -and $oldMap.ContainsKey($wid)) { $old = $oldMap[$wid] }
        else {
          $keyName = ($name.ToLowerInvariant() + "|" + $telegram)
          if ($oldMap.ContainsKey($keyName)) { $old = $oldMap[$keyName] }
        }
        $nw = Normalize-Worker $w $old
        $login = [string]$nw.login
        if (-not [string]::IsNullOrWhiteSpace($login)) {
          if ($usedLogins.ContainsKey($login)) {
            Send-Json $ctx @{ ok = $false; error = "Login band: $login" } 400
            return $true
          }
          $usedLogins[$login] = $true
        }
        $list += $nw
      }
      $data.workers = $list
      Save-AdminData $data
      Load-AuthUsers
      $public = @()
      foreach ($w in $list) {
        $public += @{
          id          = [string]$w.id
          name        = [string]$w.name
          lavozim     = [string]$w.lavozim
          telegram    = [string]$w.telegram
          login       = [string]$w.login
          hasPassword = -not [string]::IsNullOrWhiteSpace([string]$w.password)
        }
      }
      Sync-StaffWorkers $list
      Send-Json $ctx @{ ok = $true; workers = (To-JsonList $public) }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/staff") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $s = Get-Staff
      $name = ([string]$body.name).Trim()
      $role = ([string]$body.role).Trim()
      $bio = ([string]$body.bio).Trim()
      if (-not $name) {
        Send-Json $ctx @{ ok = $false; error = "Direktor ismi kerak." } 400
        return $true
      }
      if (-not $role) { $role = "Direktor" }
      $director = @{
        name  = $name
        role  = $role
        bio   = $bio
        photo = [string]$s.director.photo
      }
      Save-Staff $director (As-Array $s.workers)
      Send-Json $ctx @{ ok = $true; staff = (Staff-Public) }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/passwords") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      Load-AuthUsers
      $current = [string]$body.currentPassword
      $newAdmin = ([string]$body.adminPassword).Trim()
      $newDirector = ([string]$body.directorPassword).Trim()
      $newWorker = ([string]$body.workerPassword).Trim()
      if ([string]::IsNullOrWhiteSpace($current) -or [string]$current -ne [string]$script:AuthUsers.admin.password) {
        Send-Json $ctx @{ ok = $false; error = "Hozirgi sayt admin paroli noto'g'ri." } 403
        return $true
      }
      if ([string]::IsNullOrWhiteSpace($newAdmin) -and [string]::IsNullOrWhiteSpace($newDirector) -and [string]::IsNullOrWhiteSpace($newWorker)) {
        Send-Json $ctx @{ ok = $false; error = "Yangi parol yozing." } 400
        return $true
      }
      if (-not [string]::IsNullOrWhiteSpace($newAdmin) -and $newAdmin.Length -lt 6) {
        Send-Json $ctx @{ ok = $false; error = "Sayt admin paroli kamida 6 belgi bo'lsin." } 400
        return $true
      }
      if (-not [string]::IsNullOrWhiteSpace($newDirector) -and $newDirector.Length -lt 6) {
        Send-Json $ctx @{ ok = $false; error = "Direktor paroli kamida 6 belgi bo'lsin." } 400
        return $true
      }
      if (-not [string]::IsNullOrWhiteSpace($newWorker) -and $newWorker.Length -lt 6) {
        Send-Json $ctx @{ ok = $false; error = "Ishchi paroli kamida 6 belgi bo'lsin." } 400
        return $true
      }
      $data = Get-AdminData
      $changed = @()
      if (-not [string]::IsNullOrWhiteSpace($newAdmin)) {
        $data.adminPassword = $newAdmin
        $changed += "admin"
      }
      if (-not [string]::IsNullOrWhiteSpace($newDirector)) {
        $data.directorPassword = $newDirector
        $changed += "director"
      }
      if (-not [string]::IsNullOrWhiteSpace($newWorker)) {
        $data.workerPassword = $newWorker
        $changed += "worker"
      }
      Save-AdminData $data
      Load-AuthUsers
      if ($changed -contains "admin") { Drop-Sessions "admin" }
      if ($changed -contains "director") { Drop-Sessions "director" }
      if ($changed -contains "worker") { Drop-Sessions "worker" }
      Send-Json $ctx @{ ok = $true; changed = $changed }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/districts") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $incoming = @()
      if ($body.districts) { $incoming = As-Array $body.districts }
      elseif ($body.id) { $incoming = @($body) }
      $current = Read-JsonFile $overridesPath ([pscustomobject]@{ districts = @() })
      $map = @{}
      foreach ($d in (As-Array $current.districts)) {
        if ($d.id) { $map[[string]$d.id] = $d }
      }
      foreach ($d in $incoming) {
        $id = [string]$d.id
        if (-not [string]::IsNullOrWhiteSpace($id)) { $map[$id] = $d }
      }
      $list = @($map.Values)
      Save-OverrideList $list
      Send-Json $ctx @{ ok = $true; count = $list.Count; districts = $list }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/districts/delete") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $id = ([string]$body.id).Trim().ToLowerInvariant()
      if ([string]::IsNullOrWhiteSpace($id)) {
        Send-Json $ctx @{ ok = $false; error = "Hisobot id kerak." } 400
        return $true
      }
      $baseIds = Base-DistrictIds
      $isBase = $baseIds -contains $id
      $kept = @()
      $found = $false
      foreach ($d in (Get-OverrideList)) {
        if ([string]$d.id -eq $id) {
          $found = $true
          Remove-ReportFile ([string]$d.file)
          if ($isBase) {
            $kept += @{ id = $id; deleted = $true }
          }
        } else {
          $kept += $d
        }
      }
      if ($isBase -and -not $found) {
        $kept += @{ id = $id; deleted = $true }
      }
      Save-OverrideList $kept
      Send-Json $ctx @{ ok = $true; districts = $kept }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/districts/file") {
      $qs = $ctx.Request.QueryString
      $id = ([string]$qs["id"]).Trim().ToLowerInvariant() -replace '\s+', '-'
      $filename = ([string]$qs["filename"]).Trim()
      if ($id -notmatch '^[a-z0-9-]+$') {
        Send-Json $ctx @{ ok = $false; error = "Hisobot id noto'g'ri." } 400
        return $true
      }
      $ext = [IO.Path]::GetExtension($filename).ToLowerInvariant()
      $ctype = ([string]$ctx.Request.ContentType).ToLowerInvariant()
      if ($ext -notin @(".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif")) {
        if ($ctype -like "application/pdf*") { $ext = ".pdf" }
        elseif ($ctype -like "image/png*") { $ext = ".png" }
        elseif ($ctype -like "image/jpeg*") { $ext = ".jpg" }
        elseif ($ctype -like "image/webp*") { $ext = ".webp" }
        elseif ($ctype -like "image/gif*") { $ext = ".gif" }
        else {
          Send-Json $ctx @{ ok = $false; error = "Faqat PDF, PNG, JPG, WEBP yoki GIF." } 400
          return $true
        }
      }
      $bytes = Read-Bytes $ctx.Request 20MB
      if ($bytes.Length -lt 32) {
        Send-Json $ctx @{ ok = $false; error = "Fayl juda kichik." } 400
        return $true
      }
      $rel = "files/reports/$id$ext"
      $dest = Join-Path $root ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
      foreach ($oldExt in @(".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif")) {
        $oldRel = "files/reports/$id$oldExt"
        if ($oldRel -ne $rel) { Remove-ReportFile $oldRel }
      }
      [IO.File]::WriteAllBytes($dest, $bytes)
      $list = @()
      $found = $false
      foreach ($d in (Get-OverrideList)) {
        if ([string]$d.id -eq $id) {
          $d | Add-Member -NotePropertyName file -NotePropertyValue $rel -Force
          $d | Add-Member -NotePropertyName deleted -NotePropertyValue $false -Force
          $found = $true
        }
        $list += $d
      }
      if (-not $found) {
        $list += @{ id = $id; file = $rel }
      }
      Save-OverrideList $list
      Send-Json $ctx @{ ok = $true; path = $rel; id = $id; districts = $list }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/contact") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $phone = ([string]$body.phone).Trim()
      $email = ([string]$body.email).Trim()
      $address = ([string]$body.address).Trim()
      $title = ([string]$body.title).Trim()
      if ([string]::IsNullOrWhiteSpace($title)) { $title = "Qarshi bo‘linmasi" }
      if (-not $phone -or -not $email -or -not $address) {
        Send-Json $ctx @{ ok = $false; error = "Telefon, email va manzil kerak." } 400
        return $true
      }
      $lat = Parse-Coord $body.lat -90 90 "Kenglik (lat)"
      $lng = Parse-Coord $body.lng -180 180 "Uzunlik (lng)"
      $contact = @{
        phone   = $phone
        email   = $email
        address = $address
        title   = $title
        lat     = $lat
        lng     = $lng
      }
      Save-Contact $contact
      Send-Json $ctx @{ ok = $true; contact = (Contact-Public) }
      return $true
    }

    if ($method -eq "GET" -and $path -eq "/api/telegram/chats") {
      $data = Get-AdminData
      $token = [string]$data.botToken
      if ([string]::IsNullOrWhiteSpace($token)) {
        Send-Json $ctx @{ ok = $false; error = "Avval bot tokenini saqlang." } 400
        return $true
      }
      $offset = 0
      try { $offset = [int64]$data.telegramOffset } catch { $offset = 0 }
      $query = "timeout=0"
      if ($offset -gt 0) { $query = "timeout=0&offset=$offset" }
      $resp = Invoke-Telegram $token "getUpdates" $query
      $chats = @{}
      foreach ($c in (As-Array $data.telegramChats)) {
        if ($c.id) { $chats[[string]$c.id] = $c }
      }
      $maxId = $offset
      foreach ($u in (As-Array $resp.result)) {
        if ($u.update_id -gt $maxId) { $maxId = [int64]$u.update_id }
        $msg = $u.message
        if (-not $msg) { $msg = $u.edited_message }
        if (-not $msg) { continue }
        $chat = $msg.chat
        if (-not $chat) { continue }
        $id = [string]$chat.id
        $name = (([string]$chat.first_name + " " + [string]$chat.last_name).Trim())
        if ([string]::IsNullOrWhiteSpace($name)) { $name = [string]$chat.title }
        if ([string]::IsNullOrWhiteSpace($name)) { $name = $id }
        $chats[$id] = @{
          id       = $id
          name     = $name
          username = [string]$chat.username
          at       = [string]$msg.date
        }
      }
      if ($maxId -ge $offset) {
        $data.telegramOffset = $maxId + 1
      }
      $saved = @($chats.Values)
      $data.telegramChats = $saved
      Save-AdminData $data
      Send-Json $ctx @{ ok = $true; chats = $saved }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/telegram/test") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $data = Get-AdminData
      $token = [string]$data.botToken
      if ([string]::IsNullOrWhiteSpace($token)) {
        Send-Json $ctx @{ ok = $false; error = "Avval bot tokenini saqlang." } 400
        return $true
      }
      $chatId = Resolve-ChatId $token ([string]$body.chat_id)
      $resp = Invoke-Telegram $token "sendMessage" $null @{
        chat_id = $chatId
        text    = "Qashqadaryo Tuproq Lab: test xabar. Bot ishlayapti."
      }
      Send-Json $ctx @{ ok = [bool]$resp.ok; chat_id = $chatId }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/announce") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $title = ([string]$body.title).Trim()
      $message = ([string]$body.message).Trim()
      $editId = ([string]$body.id).Trim()
      if (-not $title -or -not $message) {
        Send-Json $ctx @{ ok = $false; error = "Sarlavha va xabar kerak." } 400
        return $true
      }
      $data = Get-AdminData
      $anns = @()
      $editing = -not [string]::IsNullOrWhiteSpace($editId)
      if ($editing) {
        $found = $false
        foreach ($a in (As-Array $data.announcements)) {
          $na = Normalize-Announcement $a
          if ([string]$na.id -eq $editId) {
            $found = $true
            $na.title = $title
            $na.message = $message
          }
          $anns += , $na
        }
        if (-not $found) {
          Send-Json $ctx @{ ok = $false; error = "E'lon topilmadi." } 404
          return $true
        }
        $data.announcements = $anns
        Save-AdminData $data
        Send-Json $ctx @{
          ok            = $true
          sent          = 0
          failed        = @()
          announcements = (To-JsonList $anns)
        }
        return $true
      }
      $item = Normalize-Announcement @{
        title     = $title
        message   = $message
        createdAt = (Get-Date).ToString("yyyy-MM-dd HH:mm")
      }
      $anns = @(, $item) + @(As-Array $data.announcements)
      if ($anns.Count -gt 50) { $anns = $anns[0..49] }
      $data.announcements = $anns
      Save-AdminData $data

      $token = [string]$data.botToken
      $text = "$title`n`n$message"
      $sent = 0
      $failed = @()
      foreach ($w in (As-Array $data.workers)) {
        $label = [string]$w.name
        $chat = ([string]$w.telegram).Trim()
        if ([string]::IsNullOrWhiteSpace($chat)) { continue }
        try {
          if ([string]::IsNullOrWhiteSpace($token)) { throw "Token yo'q" }
          $chatId = Resolve-ChatId $token ([string]$w.telegram)
          $resp = Invoke-Telegram $token "sendMessage" $null @{
            chat_id = $chatId
            text    = $text
          }
          if ($resp.ok) { $sent += 1 }
          else { $failed += "$label : Telegram rad etdi" }
        } catch {
          $failed += "$label : $($_.Exception.Message)"
        }
      }
      Send-Json $ctx @{
        ok            = $true
        sent          = $sent
        failed        = $failed
        announcements = (To-JsonList $anns)
      }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/announce/delete") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $id = ([string]$body.id).Trim()
      if ([string]::IsNullOrWhiteSpace($id)) {
        Send-Json $ctx @{ ok = $false; error = "E'lon id kerak." } 400
        return $true
      }
      $data = Get-AdminData
      $kept = @()
      $found = $false
      foreach ($a in (As-Array $data.announcements)) {
        $na = Normalize-Announcement $a
        if ([string]$na.id -eq $id) {
          $found = $true
          continue
        }
        $kept += , $na
      }
      if (-not $found) {
        Send-Json $ctx @{ ok = $false; error = "E'lon topilmadi." } 404
        return $true
      }
      $data.announcements = $kept
      Save-AdminData $data
      Send-Json $ctx @{
        ok            = $true
        announcements = (To-JsonList $kept)
      }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/upload") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $slot = ([string]$body.slot).Trim().ToLowerInvariant()
      if ($slot -notin @("hero", "building", "director")) {
        Send-Json $ctx @{ ok = $false; error = "slot hero, building yoki director bo'lishi kerak." } 400
        return $true
      }
      $name = ([string]$body.filename).Trim()
      $ext = [IO.Path]::GetExtension($name).ToLowerInvariant()
      if ($ext -notin @(".png", ".jpg", ".jpeg", ".webp", ".gif")) {
        $ctype = ([string]$body.type).ToLowerInvariant()
        if ($ctype -eq "image/png") { $ext = ".png" }
        elseif ($ctype -eq "image/jpeg") { $ext = ".jpg" }
        elseif ($ctype -eq "image/webp") { $ext = ".webp" }
        elseif ($ctype -eq "image/gif") { $ext = ".gif" }
        else {
          Send-Json $ctx @{ ok = $false; error = "Faqat PNG, JPG, WEBP yoki GIF." } 400
          return $true
        }
      }
      $b64 = [string]$body.data
      $b64 = $b64 -replace '^data:image/[^;]+;base64,', ''
      $bytes = [Convert]::FromBase64String($b64)
      if ($bytes.Length -lt 32 -or $bytes.Length -gt 8MB) {
        Send-Json $ctx @{ ok = $false; error = "Rasm hajmi noto'g'ri (maks. 8 MB)." } 400
        return $true
      }
      $rel = "images/uploads/$slot$ext"
      $dest = Join-Path $root ($rel -replace '/', '\')
      [IO.File]::WriteAllBytes($dest, $bytes)
      if ($slot -eq "director") {
        $s = Get-Staff
        $director = @{
          name  = [string]$s.director.name
          role  = [string]$s.director.role
          bio   = [string]$s.director.bio
          photo = $rel
        }
        Save-Staff $director (As-Array $s.workers)
        Send-Json $ctx @{ ok = $true; path = $rel; staff = (Staff-Public) }
        return $true
      }
      $media = Get-Media
      $media | Add-Member -NotePropertyName $slot -NotePropertyValue $rel -Force
      $media.v = [int]$media.v + 1
      Save-Media $media
      Send-Json $ctx @{ ok = $true; path = $rel; v = [int]$media.v; media = @{ hero = [string]$media.hero; building = [string]$media.building; v = [int]$media.v } }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/gallery") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $title = ([string]$body.title).Trim()
      $caption = ([string]$body.caption).Trim()
      $url = ([string]$body.url).Trim()
      if ([string]::IsNullOrWhiteSpace($title)) {
        Send-Json $ctx @{ ok = $false; error = "Sarlavha kerak." } 400
        return $true
      }
      $yt = Get-YouTubeId $url
      if (-not $yt) {
        Send-Json $ctx @{ ok = $false; error = "YouTube havolasi noto'g'ri." } 400
        return $true
      }
      $gallery = Get-Gallery
      $item = @{
        id        = New-GalleryId
        type      = "youtube"
        title     = $title
        caption   = $caption
        src       = $yt
        createdAt = (Get-Date).ToString("yyyy-MM-dd HH:mm")
      }
      $gallery.items = @(, $item) + @(As-Array $gallery.items)
      $gallery.v = [int]$gallery.v + 1
      Save-Gallery $gallery
      Send-Json $ctx @{ ok = $true; item = $item; gallery = @(Gallery-Items) }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/gallery/upload") {
      $qs = $ctx.Request.QueryString
      $kind = ([string]$qs["kind"]).Trim().ToLowerInvariant()
      $title = ([string]$qs["title"]).Trim()
      $caption = ([string]$qs["caption"]).Trim()
      $filename = ([string]$qs["filename"]).Trim()
      if ($kind -notin @("photo", "video")) {
        Send-Json $ctx @{ ok = $false; error = "Tur photo yoki video bo'lishi kerak." } 400
        return $true
      }
      if ([string]::IsNullOrWhiteSpace($title)) {
        Send-Json $ctx @{ ok = $false; error = "Sarlavha kerak." } 400
        return $true
      }
      $ext = [IO.Path]::GetExtension($filename).ToLowerInvariant()
      $ctype = ([string]$ctx.Request.ContentType).ToLowerInvariant()
      if ($kind -eq "photo") {
        if ($ext -notin @(".png", ".jpg", ".jpeg", ".webp", ".gif")) {
          if ($ctype -like "image/png*") { $ext = ".png" }
          elseif ($ctype -like "image/jpeg*") { $ext = ".jpg" }
          elseif ($ctype -like "image/webp*") { $ext = ".webp" }
          elseif ($ctype -like "image/gif*") { $ext = ".gif" }
          else {
            Send-Json $ctx @{ ok = $false; error = "Faqat PNG, JPG, WEBP yoki GIF." } 400
            return $true
          }
        }
        $maxBytes = 12MB
        $folder = "images/gallery"
      } else {
        if ($ext -notin @(".mp4", ".webm")) {
          if ($ctype -like "video/mp4*") { $ext = ".mp4" }
          elseif ($ctype -like "video/webm*") { $ext = ".webm" }
          else {
            Send-Json $ctx @{ ok = $false; error = "Faqat MP4 yoki WEBM video." } 400
            return $true
          }
        }
        $maxBytes = 80MB
        $folder = "media/gallery"
      }
      $bytes = Read-Bytes $ctx.Request $maxBytes
      if ($bytes.Length -lt 32) {
        Send-Json $ctx @{ ok = $false; error = "Fayl juda kichik." } 400
        return $true
      }
      $id = New-GalleryId
      $rel = "$folder/$id$ext"
      $dest = Join-Path $root ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
      [IO.File]::WriteAllBytes($dest, $bytes)
      $gallery = Get-Gallery
      $item = @{
        id        = $id
        type      = $kind
        title     = $title
        caption   = $caption
        src       = $rel
        createdAt = (Get-Date).ToString("yyyy-MM-dd HH:mm")
      }
      $gallery.items = @(, $item) + @(As-Array $gallery.items)
      $gallery.v = [int]$gallery.v + 1
      Save-Gallery $gallery
      Send-Json $ctx @{ ok = $true; item = $item; gallery = @(Gallery-Items) }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/gallery/delete") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $id = ([string]$body.id).Trim()
      if ($id -notmatch '^g[A-Za-z0-9]+$') {
        Send-Json $ctx @{ ok = $false; error = "Noto'g'ri id." } 400
        return $true
      }
      $gallery = Get-Gallery
      $kept = @()
      foreach ($it in (As-Array $gallery.items)) {
        if ([string]$it.id -eq $id) {
          if ([string]$it.type -ne "youtube") {
            Remove-GalleryFile ([string]$it.src)
          }
        } else {
          $kept += $it
        }
      }
      $gallery.items = $kept
      $gallery.v = [int]$gallery.v + 1
      Save-Gallery $gallery
      Send-Json $ctx @{ ok = $true; gallery = @(Gallery-Items) }
      return $true
    }

    Send-Json $ctx @{ ok = $false; error = "Not found" } 404
    return $true
  } catch {
    Send-Json $ctx @{ ok = $false; error = $_.Exception.Message } 500
    return $true
  }
}

function Send-File($ctx, $path) {
  $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
  $types = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.webp' = 'image/webp'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.mp4'  = 'video/mp4'
    '.webm' = 'video/webm'
    '.pdf'  = 'application/pdf'
  }
  if ($types.ContainsKey($ext)) { $ctx.Response.ContentType = $types[$ext] }
  else { $ctx.Response.ContentType = 'application/octet-stream' }
  $bytes = [IO.File]::ReadAllBytes($path)
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.Headers.Add("Cache-Control", "no-cache")
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

$h = New-Object System.Net.HttpListener
$h.Prefixes.Add($prefix)
try {
  $h.Start()
} catch {
  Write-Host "Port $port band. Eski serverni yoping yoki OCHISH.bat ni qayta ishga tushiring."
  Write-Host $_.Exception.Message
  exit 1
}

Write-Host "Serving $root at $prefix"
Write-Host "Direktor / ishchi: ${prefix}admin.html"
Write-Host "Sayt sozlamalari: ${prefix}sozlamalar.html"
Load-AuthUsers

while ($h.IsListening) {
  $ctx = $null
  try {
    $ctx = $h.GetContext()
    if (Handle-Api $ctx) { continue }

    $local = $ctx.Request.Url.LocalPath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($local)) { $local = 'index.html' }
    $local = [Uri]::UnescapeDataString($local)
    $name = [IO.Path]::GetFileName($local)
    if ($blockedNames -contains $name) {
      $ctx.Response.StatusCode = 404
      $ctx.Response.Close()
      continue
    }
    $path = [IO.Path]::GetFullPath((Join-Path $root ($local -replace '/', [IO.Path]::DirectorySeparatorChar)))
    $rootFull = [IO.Path]::GetFullPath($root)
    if (-not $path.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
      $ctx.Response.StatusCode = 403
      $ctx.Response.Close()
      continue
    }
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      if (Is-ProtectedData $local) {
        $auth = Get-Auth $ctx
        if (-not $auth) {
          $ctx.Response.StatusCode = 401
          $ctx.Response.ContentType = "application/json; charset=utf-8"
          $msg = [Text.Encoding]::UTF8.GetBytes('{"ok":false,"error":"Kirish kerak."}')
          $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
          $ctx.Response.Close()
          continue
        }
      }
      Send-File $ctx $path
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [Text.Encoding]::UTF8.GetBytes('Not found')
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
      $ctx.Response.Close()
    }
  } catch {
    Write-Host $_.Exception.Message
    if ($ctx -and $ctx.Response -and $ctx.Response.OutputStream.CanWrite) {
      try {
        $ctx.Response.StatusCode = 500
        $ctx.Response.Close()
      } catch {}
    }
  }
}
