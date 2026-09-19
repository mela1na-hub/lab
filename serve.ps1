$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
Write-Host "DEPRECATED: Production uses Node.js. Run OCHISH.bat or npm start. This PowerShell server is not for the public internet."
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
$script:TelegramOffsetPath = Join-Path $dataDir "telegram-offset.txt"

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
$script:DefaultDirectorPassword = ""
$script:DefaultWorkerPassword = ""
$script:DefaultAdminPassword = ""
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
  $telegram = ([string]$w.telegram).Trim()
  $lavozim = ([string]$w.lavozim).Trim()
  if ([string]::IsNullOrWhiteSpace($password) -and $old) { $password = [string]$old.password }
  if ([string]::IsNullOrWhiteSpace($login) -and $old) { $login = ([string]$old.login).Trim().ToLowerInvariant() }
  if ([string]::IsNullOrWhiteSpace($telegram) -and $old) { $telegram = ([string]$old.telegram).Trim() }
  if ([string]::IsNullOrWhiteSpace($lavozim) -and $old) { $lavozim = ([string]$old.lavozim).Trim() }
  if ([string]::IsNullOrWhiteSpace($lavozim)) { $lavozim = "Ishchi" }
  return @{
    id       = $id
    name     = ([string]$w.name).Trim()
    lavozim  = $lavozim
    telegram = $telegram
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
  $json = ConvertTo-JsonSafe $obj
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
    if ($null -eq $w -or $w -is [string]) { continue }
    $name = ""
    try { $name = ([string]$w.name).Trim() } catch { continue }
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    $nw = Normalize-Worker $w $w
    if ([string]::IsNullOrWhiteSpace([string]$w.id)) { $idsChanged = $true }
    $normalized += , $nw
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
    hero     = "images/bo-linma.jpg"
    building = "images/bo-linma.jpg"
    v        = 1
  })
  if ([string]::IsNullOrWhiteSpace([string]$media.hero)) { $media.hero = "images/bo-linma.jpg" }
  if ([string]::IsNullOrWhiteSpace([string]$media.building)) { $media.building = "images/bo-linma.jpg" }
  if (-not $media.v) { $media | Add-Member -NotePropertyName v -NotePropertyValue 1 -Force }
  return $media
}

function To-RelPath([string]$full) {
  $rootFull = [IO.Path]::GetFullPath($root)
  $fullPath = [IO.Path]::GetFullPath($full)
  if ($fullPath.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    return ($fullPath.Substring($rootFull.Length) -replace '\\', '/').TrimStart('/')
  }
  return ($fullPath -replace '\\', '/')
}

function Compress-SiteJpeg([string]$srcPath, [long]$quality = 62) {
  $ext = [IO.Path]::GetExtension($srcPath).ToLowerInvariant()
  if ($ext -notin @(".png", ".jpg", ".jpeg", ".bmp")) { return $srcPath }
  try {
    Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue | Out-Null
    $srcLen = (Get-Item -LiteralPath $srcPath).Length
    $img = [System.Drawing.Image]::FromFile($srcPath)
    $w = $img.Width
    $h = $img.Height
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::White)
    $g.DrawImage($img, 0, 0, $w, $h)
    $img.Dispose()
    $g.Dispose()
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, $quality)
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString("N") + ".jpg")
    $bmp.Save($tmp, $codec, $ep)
    $bmp.Dispose()
    $newLen = (Get-Item -LiteralPath $tmp).Length
    if ($newLen -ge $srcLen -and $ext -in @(".jpg", ".jpeg")) {
      Remove-Item -LiteralPath $tmp -Force
      return $srcPath
    }
    $dest = [IO.Path]::ChangeExtension($srcPath, ".jpg")
    if (Test-Path -LiteralPath $srcPath) { Remove-Item -LiteralPath $srcPath -Force }
    Move-Item -LiteralPath $tmp -Destination $dest -Force
    return $dest
  } catch {
    return $srcPath
  }
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

function New-PublicWorkerId {
  return "p" + [guid]::NewGuid().ToString("N").Substring(0, 12)
}

function Staff-Public {
  $s = Get-Staff
  $workers = @()
  foreach ($w in (As-Array $s.workers)) {
    $name = ([string]$w.name).Trim()
    $lavozim = ([string]$w.lavozim).Trim()
    if ($name) {
      $id = ([string]$w.id).Trim()
      if ([string]::IsNullOrWhiteSpace($id)) { $id = New-PublicWorkerId }
      $workers += , @{
        id      = $id
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
      $id = ([string]$w.id).Trim()
      if ([string]::IsNullOrWhiteSpace($id)) { $id = New-PublicWorkerId }
      $wlist += , @{
        id      = $id
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

function Convert-ToNetJsonObject($obj) {
  if ($null -eq $obj) { return $null }
  if ($obj -is [string]) { return $obj }
  if ($obj -is [bool]) { return [bool]$obj }
  if ($obj -is [byte] -or $obj -is [int16] -or $obj -is [int] -or $obj -is [long] -or $obj -is [int64] -or $obj -is [uint32] -or $obj -is [uint64] -or $obj -is [double] -or $obj -is [decimal] -or $obj -is [float]) {
    return $obj
  }
  if ($obj -is [datetime]) { return $obj.ToString("o") }
  if ($obj -is [System.Collections.IDictionary]) {
    $map = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    foreach ($k in @($obj.Keys)) {
      $map[[string]$k] = Convert-ToNetJsonObject $obj[$k]
    }
    return $map
  }
  if ($obj -is [pscustomobject]) {
    $map = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    foreach ($p in $obj.PSObject.Properties) {
      $map[$p.Name] = Convert-ToNetJsonObject $p.Value
    }
    return $map
  }
  if ($obj -is [System.Collections.IEnumerable] -and -not ($obj -is [string])) {
    $list = New-Object System.Collections.ArrayList
    foreach ($i in $obj) { [void]$list.Add((Convert-ToNetJsonObject $i)) }
    return $list
  }
  return [string]$obj
}

function ConvertTo-JsonSafe($obj) {
  try {
    Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = [int]::MaxValue
    $ser.RecursionLimit = 100
    return $ser.Serialize((Convert-ToNetJsonObject $obj))
  } catch {
    return ($obj | ConvertTo-Json -Depth 20 -Compress)
  }
}

function Send-Json($ctx, $obj, $code = 200) {
  $json = ConvertTo-JsonSafe $obj
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = "application/json; charset=utf-8"
  $ctx.Response.Headers.Add("Cache-Control", "no-store")
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

function Redact-TelegramSecret([string]$text) {
  return ([string]$text) -replace 'bot\d+:[A-Za-z0-9_-]+', 'bot<redacted>'
}

function Get-TelegramError($err) {
  $msg = [string]$err.Exception.Message
  try {
    if ($err.ErrorDetails -and $err.ErrorDetails.Message) {
      $parsed = $err.ErrorDetails.Message | ConvertFrom-Json
      if ($parsed.description) { $msg = [string]$parsed.description }
      else { $msg = [string]$err.ErrorDetails.Message }
    }
  } catch {}
  return (Redact-TelegramSecret $msg)
}

function Get-ChatFromTelegramUpdate($u) {
  $msg = $u.message
  if (-not $msg) { $msg = $u.edited_message }
  if (-not $msg) { $msg = $u.channel_post }
  $chat = $null
  $at = ""
  if ($msg) {
    $chat = $msg.chat
    $at = [string]$msg.date
  }
  if (-not $chat -and $u.my_chat_member -and $u.my_chat_member.chat) {
    $chat = $u.my_chat_member.chat
    $at = [string]$u.my_chat_member.date
  }
  if (-not $chat -and $u.callback_query -and $u.callback_query.message) {
    $chat = $u.callback_query.message.chat
    $at = [string]$u.callback_query.message.date
  }
  if (-not $chat) { return $null }
  $id = [string]$chat.id
  if ([string]::IsNullOrWhiteSpace($id)) { return $null }
  $name = (([string]$chat.first_name + " " + [string]$chat.last_name).Trim())
  if ([string]::IsNullOrWhiteSpace($name)) { $name = [string]$chat.title }
  if ([string]::IsNullOrWhiteSpace($name)) { $name = $id }
  return @{
    id       = $id
    name     = $name
    username = [string]$chat.username
    at       = $at
  }
}

function Fetch-TelegramChats($token, $data) {
  if ($script:TelegramBotPolling) {
    return To-JsonList @(As-Array $data.telegramChats)
  }
  try { Invoke-Telegram $token "deleteWebhook" | Out-Null } catch {}
  $chats = @{}
  foreach ($c in (As-Array $data.telegramChats)) {
    $cid = [string]$c.id
    if ([string]::IsNullOrWhiteSpace($cid)) { $cid = [string]$c.chat_id }
    if ([string]::IsNullOrWhiteSpace($cid)) { continue }
    $chats[$cid] = @{
      id       = $cid
      name     = [string]$c.name
      username = [string]$c.username
      at       = [string]$c.at
    }
  }
  $offset = 0
  try { $offset = [int64]$data.telegramOffset } catch { $offset = 0 }
  $retriedOffset = $false
  $pages = 0
  $allowed = "allowed_updates=%5B%22message%22%2C%22edited_message%22%2C%22my_chat_member%22%2C%22callback_query%22%5D"
  while ($pages -lt 15) {
    $pages++
    $query = "timeout=0&limit=100&$allowed"
    if ($offset -gt 0) { $query = "timeout=0&limit=100&offset=$offset&$allowed" }
    $resp = Invoke-Telegram $token "getUpdates" $query
    $raw = $null
    if ($null -ne $resp) {
      if ($resp.PSObject.Properties.Name -contains "result") { $raw = $resp.result }
      elseif ($resp.update_id) { $raw = $resp }
    }
    $batch = @(As-Array $raw)
    if ($batch.Count -eq 1 -and $null -eq $batch[0]) { $batch = @() }
    if ($batch.Count -eq 0) {
      if (-not $retriedOffset -and $offset -gt 0) {
        $retriedOffset = $true
        $offset = 0
        continue
      }
      break
    }
    foreach ($u in $batch) {
      if ($null -eq $u) { continue }
      try {
        $uid = [int64]$u.update_id
        if ($uid + 1 -gt $offset) { $offset = $uid + 1 }
      } catch {}
      $row = Get-ChatFromTelegramUpdate $u
      if ($row) { $chats[[string]$row.id] = $row }
    }
    if ($batch.Count -lt 100) { break }
  }
  $data.telegramOffset = $offset
  $list = To-JsonList @($chats.Values)
  $data.telegramChats = $list
  Save-AdminData $data
  return $list
}

function Invoke-Telegram($token, $method, $query = $null, $bodyObj = $null, $timeoutSec = 25) {
  if ([int]$timeoutSec -lt 5) { $timeoutSec = 25 }
  $uri = "https://api.telegram.org/bot$token/$method"
  if ($query) { $uri = "$uri`?$query" }
  try {
    if ($null -eq $bodyObj) {
      return Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec $timeoutSec
    }
    $json = ConvertTo-JsonSafe $bodyObj
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-RestMethod -Uri $uri -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec $timeoutSec
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
  $id = ""
  if ($resp.result -and $resp.result.id) { $id = [string]$resp.result.id }
  elseif ($resp.id) { $id = [string]$resp.id }
  if (-not [string]::IsNullOrWhiteSpace($id)) { return $id }
  throw "@$user uchun chat_id topilmadi. Ishchi botga /start yozishi kerak."
}

function Test-TelegramSendOk($resp) {
  if ($null -eq $resp) { return $false }
  if ($resp.ok -eq $true) { return $true }
  if ($resp.result -and $resp.result.message_id) { return $true }
  if ($resp.message_id) { return $true }
  return $false
}

. (Join-Path $root "telegram-bot.ps1")
Load-DotEnvFile (Join-Path $root ".env")

function Resolve-WorkerChatId($data, $w) {
  $raw = ([string]$w.telegram).Trim()
  if ($raw -match '^-?\d+$') { return $raw }
  if (-not [string]::IsNullOrWhiteSpace($raw)) {
    $uname = $raw.TrimStart('@').ToLowerInvariant()
    foreach ($c in (As-Array $data.telegramChats)) {
      if (([string]$c.username).Trim().ToLowerInvariant() -eq $uname -and $c.id) {
        return [string]$c.id
      }
    }
  }
  $want = ([string]$w.name).Trim().ToLowerInvariant()
  if (-not [string]::IsNullOrWhiteSpace($want)) {
    foreach ($c in (As-Array $data.telegramChats)) {
      $nm = ([string]$c.name).Trim().ToLowerInvariant()
      if ($nm -and $nm -eq $want -and $c.id) { return [string]$c.id }
    }
  }
  return ""
}

function Get-AnnouncementTargets($data, $workerIds) {
  $map = @{}
  $missing = @()
  $selected = @()
  foreach ($id in (As-Array $workerIds)) {
    $s = ([string]$id).Trim()
    if ($s) { $selected += $s }
  }
  if ($selected.Count -gt 0) {
    foreach ($sid in $selected) {
      $w = $null
      foreach ($x in (As-Array $data.workers)) {
        if ([string]$x.id -eq $sid) { $w = $x; break }
      }
      if (-not $w) {
        $missing += "Ishchi topilmadi."
        continue
      }
      $label = [string]$w.name
      $cid = Resolve-WorkerChatId $data $w
      if ([string]::IsNullOrWhiteSpace($cid)) {
        $missing += "$label : Telegram chat_id yo'q. Sozlamalarda yozing yoki botga /start."
        continue
      }
      $map[$cid] = $label
    }
    return @{ map = $map; missing = $missing }
  }
  foreach ($w in (As-Array $data.workers)) {
    $cid = Resolve-WorkerChatId $data $w
    if (-not [string]::IsNullOrWhiteSpace($cid)) { $map[$cid] = [string]$w.name }
  }
  foreach ($c in (As-Array $data.telegramChats)) {
    $id = [string]$c.id
    if ([string]::IsNullOrWhiteSpace($id)) { $id = [string]$c.chat_id }
    if ([string]::IsNullOrWhiteSpace($id)) { continue }
    if (-not $map.ContainsKey($id)) {
      $label = [string]$c.name
      if ([string]::IsNullOrWhiteSpace($label)) { $label = $id }
      $map[$id] = $label
    }
  }
  return @{ map = $map; missing = $missing }
}

function Public-State {
  $data = Get-AdminData
  $media = Get-Media
  $chats = @()
  foreach ($c in (As-Array $data.telegramChats)) {
    $chats += , @{
      id       = [string]$c.id
      name     = [string]$c.name
      username = [string]$c.username
      at       = [string]$c.at
    }
  }
  $workers = @()
  foreach ($w in (As-Array $data.workers)) {
    if ($null -eq $w -or $w -is [string]) { continue }
    if ([string]::IsNullOrWhiteSpace([string]$w.name)) { continue }
    $workers += , @{
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
    $anns += , @{
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
    workers       = (To-JsonList $workers)
    announcements = (To-JsonList $anns)
    chats         = (To-JsonList $chats)
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
    if ($method -eq "GET" -and $path -eq "/api/site-link") {
      $ips = @(Get-LanIPs)
      $url = "http://127.0.0.1:$port/"
      if ($ips.Count -gt 0) { $url = "http://$($ips[0]):$port/" }
      Send-Json $ctx @{ ok = $true; url = $url }
      return $true
    }

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
    if ($path -eq "/api/telegram/chats" -or $path -eq "/api/telegram/chats/delete") {
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
      $okMe = $false
      if ($me.ok -eq $true) { $okMe = $true }
      elseif ($me.result) { $okMe = $true }
      elseif ($me.username -or $me.id) { $okMe = $true }
      if (-not $okMe) {
        Send-Json $ctx @{ ok = $false; error = "Telegram tokenni qabul qilmadi." } 400
        return $true
      }
      try { Invoke-Telegram $token "deleteWebhook" | Out-Null } catch {}
      $uname = ""
      if ($me.result -and $me.result.username) { $uname = [string]$me.result.username }
      elseif ($me.username) { $uname = [string]$me.username }
      $data.botToken = $token
      $data | Add-Member -NotePropertyName botUsername -NotePropertyValue $uname -Force
      $data.telegramOffset = 0
      Save-AdminData $data
      Set-TelegramPollOffset 0
      $script:TelegramWebhookCleared = $false
      $chats = @()
      try { $chats = Fetch-TelegramChats $token (Get-AdminData) } catch {}
      Send-Json $ctx @{ ok = $true; hasToken = $true; botUsername = $uname; chats = (To-JsonList $chats) }
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
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        if ([string]::IsNullOrWhiteSpace($lavozim)) { $lavozim = "Ishchi"; $w | Add-Member -NotePropertyName lavozim -NotePropertyValue $lavozim -Force }
        $old = $null
        $wid = ([string]$w.id).Trim()
        if ($wid -and $oldMap.ContainsKey($wid)) { $old = $oldMap[$wid] }
        else {
          $keyName = ($name.ToLowerInvariant() + "|" + $telegram)
          if ($oldMap.ContainsKey($keyName)) { $old = $oldMap[$keyName] }
        }
        $nw = Normalize-Worker $w $old
        if (-not [string]::IsNullOrWhiteSpace([string]$nw.telegram) -and ([string]$nw.telegram) -notmatch '^-?\d+$') {
          $tok = [string]$data.botToken
          $unameWant = ([string]$nw.telegram).TrimStart('@').ToLowerInvariant()
          foreach ($c in (As-Array $data.telegramChats)) {
            if (([string]$c.username).Trim().ToLowerInvariant() -eq $unameWant -and $c.id) {
              $nw.telegram = [string]$c.id
              break
            }
          }
          if (([string]$nw.telegram) -notmatch '^-?\d+$' -and -not [string]::IsNullOrWhiteSpace($tok)) {
            try { $nw.telegram = Resolve-ChatId $tok $nw.telegram } catch {}
          }
        }
        $login = [string]$nw.login
        if (-not [string]::IsNullOrWhiteSpace($login)) {
          if ($usedLogins.ContainsKey($login)) {
            Send-Json $ctx @{ ok = $false; error = "Login band: $login" } 400
            return $true
          }
          $usedLogins[$login] = $true
        }
        $list += , $nw
      }
      $data.workers = $list
      Save-AdminData $data
      Load-AuthUsers
      $public = @()
      foreach ($w in $list) {
        $public += , @{
          id          = [string]$w.id
          name        = [string]$w.name
          lavozim     = [string]$w.lavozim
          telegram    = [string]$w.telegram
          login       = [string]$w.login
          hasPassword = -not [string]::IsNullOrWhiteSpace([string]$w.password)
        }
      }
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

    if ($method -eq "POST" -and $path -eq "/api/staff/workers") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $s = Get-Staff
      $list = @()
      foreach ($w in (As-Array $body.workers)) {
        $name = ([string]$w.name).Trim()
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $lavozim = ([string]$w.lavozim).Trim()
        if ([string]::IsNullOrWhiteSpace($lavozim)) { $lavozim = "Ishchi" }
        $id = ([string]$w.id).Trim()
        if ([string]::IsNullOrWhiteSpace($id)) { $id = New-PublicWorkerId }
        $list += , @{
          id      = $id
          name    = $name
          lavozim = $lavozim
          photo   = [string]$w.photo
        }
      }
      Save-Staff $s.director $list
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
      try {
        $list = Fetch-TelegramChats $token $data
        Send-Json $ctx @{ ok = $true; chats = (To-JsonList $list) }
      } catch {
        Send-Json $ctx @{ ok = $false; error = [string]$_.Exception.Message } 400
      }
      return $true
    }

    if ($method -eq "POST" -and $path -eq "/api/telegram/chats/delete") {
      $body = Read-Body $ctx.Request | ConvertFrom-Json
      $want = ([string]$body.chat_id).Trim()
      if ([string]::IsNullOrWhiteSpace($want)) {
        Send-Json $ctx @{ ok = $false; error = "chat_id kerak." } 400
        return $true
      }
      $data = Get-AdminData
      $kept = @()
      $found = $false
      foreach ($c in (As-Array $data.telegramChats)) {
        $cid = [string]$c.id
        if ([string]::IsNullOrWhiteSpace($cid)) { $cid = [string]$c.chat_id }
        if ($cid -eq $want) {
          $found = $true
          continue
        }
        $kept += , $c
      }
      if (-not $found) {
        Send-Json $ctx @{ ok = $false; error = "Chat topilmadi." } 404
        return $true
      }
      $data.telegramChats = (To-JsonList $kept)
      Save-AdminData $data
      $out = @()
      foreach ($c in (As-Array $data.telegramChats)) {
        $out += , @{
          id       = [string]$c.id
          name     = [string]$c.name
          username = [string]$c.username
          at       = [string]$c.at
        }
      }
      Send-Json $ctx @{ ok = $true; chats = (To-JsonList $out) }
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
      Send-Json $ctx @{ ok = (Test-TelegramSendOk $resp); chat_id = $chatId }
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
      $scope = ([string]$body.scope).Trim().ToLowerInvariant()
      $workerIds = @()
      foreach ($wid in (As-Array $body.workerIds)) {
        $s = ([string]$wid).Trim()
        if ($s) { $workerIds += $s }
      }
      if ($scope -eq "selected" -and $workerIds.Count -eq 0) {
        Send-Json $ctx @{ ok = $false; error = "Tanlangan ishchilarga yuborish uchun kamida bittasini belgilang." } 400
        return $true
      }
      if ($scope -ne "selected") { $workerIds = @() }
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
      $picked = Get-AnnouncementTargets $data $workerIds
      $targets = $picked["map"]
      foreach ($m in (As-Array $picked["missing"])) {
        if ($m) { $failed += [string]$m }
      }
      if ([string]::IsNullOrWhiteSpace($token)) {
        $failed += "Bot token yo'q. Avval Sozlamalarda tokenni saqlang."
      } elseif ($targets.Count -eq 0) {
        if ($failed.Count -eq 0) {
          $failed += "Telegramga yuborilmadi: qabul qiluvchi topilmadi. Ishchi botga /start yozsin yoki chat_id ni Sozlamalarda yozing."
        }
      } else {
        foreach ($id in @($targets.Keys)) {
          $label = [string]$targets[$id]
          try {
            $resp = Invoke-Telegram $token "sendMessage" $null @{
              chat_id = [string]$id
              text    = $text
            }
            if (Test-TelegramSendOk $resp) { $sent += 1 }
            else { $failed += "$label : Telegram rad etdi" }
          } catch {
            $failed += "$label : $($_.Exception.Message)"
          }
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
      $dest = Compress-SiteJpeg $dest 62
      $rel = To-RelPath $dest
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
      if ($kind -eq "photo") {
        $dest = Compress-SiteJpeg $dest 62
        $rel = To-RelPath $dest
      }
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
  if ($ext -in @(".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".mp4", ".webm")) {
    $ctx.Response.Headers.Add("Cache-Control", "public, max-age=604800")
  } else {
    $ctx.Response.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
    $ctx.Response.Headers.Add("Pragma", "no-cache")
    $ctx.Response.Headers.Add("Expires", "0")
  }
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

function Get-LanIPs {
  $found = @()
  try {
    $text = ipconfig | Out-String
    $rx = [regex]::Matches($text, '(?im)IPv4[^\r\n:]*:\s*(\d+\.\d+\.\d+\.\d+)')
    foreach ($m in $rx) {
      $ip = [string]$m.Groups[1].Value
      if ($ip -notmatch '^(127\.|169\.254\.)') { $found += $ip }
    }
  } catch {}
  if ($found.Count -eq 0) {
    try {
      Get-WmiObject Win32_NetworkAdapterConfiguration -ErrorAction Stop |
        Where-Object { $_.IPEnabled } |
        ForEach-Object {
          foreach ($ip in @($_.IPAddress)) {
            if ($ip -match '^\d+\.\d+\.\d+\.\d+$' -and $ip -notmatch '^(127\.|169\.254\.)') {
              $found += [string]$ip
            }
          }
        }
    } catch {}
  }
  return @($found | Select-Object -Unique)
}

$proxyCode = @"
using System;
using System.Net;
using System.Net.Sockets;
using System.Threading;

public static class LanProxy {
  public static void Start(int listenPort, string destHost, int destPort) {
    TcpListener l = new TcpListener(IPAddress.Any, listenPort);
    l.Start();
    Thread t = new Thread(delegate() { AcceptLoop(l, destHost, destPort); });
    t.IsBackground = true;
    t.Start();
  }

  static void AcceptLoop(TcpListener l, string destHost, int destPort) {
    while (true) {
      TcpClient c = l.AcceptTcpClient();
      ThreadPool.QueueUserWorkItem(delegate(object state) {
        Relay((TcpClient)state, destHost, destPort);
      }, c);
    }
  }

  static void Relay(TcpClient client, string destHost, int destPort) {
    TcpClient backend = null;
    try {
      client.NoDelay = true;
      backend = new TcpClient();
      backend.NoDelay = true;
      backend.Connect(destHost, destPort);
      NetworkStream a = client.GetStream();
      NetworkStream b = backend.GetStream();
      Thread t = new Thread(delegate() { Copy(a, b); });
      t.IsBackground = true;
      t.Start();
      Copy(b, a);
    } catch {
    } finally {
      try { client.Close(); } catch {}
      try { if (backend != null) backend.Close(); } catch {}
    }
  }

  static void Copy(NetworkStream from, NetworkStream to) {
    byte[] buf = new byte[8192];
    try {
      int n;
      while ((n = from.Read(buf, 0, buf.Length)) > 0) {
        to.Write(buf, 0, n);
        to.Flush();
      }
    } catch {}
  }
}
"@

if (-not ([System.Management.Automation.PSTypeName]'LanProxy').Type) {
  Add-Type -TypeDefinition $proxyCode -Language CSharp
}

$internalPort = $port + 10000
$h = New-Object System.Net.HttpListener
$h.Prefixes.Add("http://127.0.0.1:$internalPort/")
try {
  $h.Start()
} catch {
  Write-Host "Port $internalPort band. Eski serverni yoping yoki OCHISH.bat ni qayta ishga tushiring."
  Write-Host $_.Exception.Message
  exit 1
}

$phoneOk = $false
try {
  [LanProxy]::Start($port, "127.0.0.1", $internalPort)
  Start-Sleep -Milliseconds 200
  $phoneOk = $true
} catch {
  Write-Host $_.Exception.Message
}

$lanIps = @(Get-LanIPs)
$publicUrl = "http://127.0.0.1:$port/"
if ($phoneOk -and $lanIps.Count -gt 0) {
  $publicUrl = "http://$($lanIps[0]):$port/"
}

Write-Host "Serving $root"
Write-Host "Bitta link (kompyuter va telefon, bir xil Wi-Fi): $publicUrl"
$linkText = @"
Bitta link — kompyuter va telefon shu manzilda ochiladi.
Kompyuter va telefon BIR XIL Wi-Fi da bolsin (mobil internet emas).

$publicUrl

Direktor / ishchi: ${publicUrl}admin.html
Sayt sozlamalari: ${publicUrl}sozlamalar.html
"@
[IO.File]::WriteAllText((Join-Path $root "SAYT-LINK.txt"), $publicUrl.Trim() + "`r`n", [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $root "TELEFON-LINK.txt"), $linkText.Trim() + "`r`n", [Text.UTF8Encoding]::new($false))
if (-not ($phoneOk -and $lanIps.Count -gt 0)) {
  Write-Host "Wi-Fi manzil topilmadi. Hozircha faqat shu kompyuterda ochiladi."
}
Write-Host "Direktor / ishchi: ${publicUrl}admin.html"
Write-Host "Sayt sozlamalari: ${publicUrl}sozlamalar.html"
Load-AuthUsers

$script:TelegramBotPolling = $true
$adminIdCount = (Get-TelegramAdminIds).Count
if ($adminIdCount -eq 0) {
  Write-Host "Telegram bot: TELEGRAM_ADMIN_IDS yozilmagan. .env faylida numeric user ID qo'ying. E'lon yuborish o'chiq."
} else {
  Write-Host "Telegram bot: polling ishga tushdi. Admin user ID soni: $adminIdCount"
}

while ($h.IsListening) {
  $ctx = $null
  try {
    $iar = $h.BeginGetContext($null, $null)
    while (-not $iar.AsyncWaitHandle.WaitOne(200)) {
      Pump-TelegramBotListener
    }
    $ctx = $h.EndGetContext($iar)
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
    $norm = ($local -replace '\\', '/').TrimStart('/').ToLowerInvariant()
    if ($norm -eq "data/staff.json" -or $norm -eq "data/rahbariyat.json") {
      Send-Json $ctx (Staff-Public)
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
    Write-Host (Redact-TelegramSecret ([string]$_.Exception.Message))
    if ($ctx -and $ctx.Response -and $ctx.Response.OutputStream.CanWrite) {
      try {
        $ctx.Response.StatusCode = 500
        $ctx.Response.Close()
      } catch {}
    }
  }
}
