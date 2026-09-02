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
  ".gitignore"
)

$script:Sessions = @{}
$script:AuthUsers = @{
  director = @{ password = "director123"; role = "director"; label = "Direktor" }
  ishchi   = @{ password = "ishchi123";   role = "worker";   label = "Ishchi" }
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
    botToken        = ""
    botUsername     = ""
    workers         = @()
    announcements   = @()
    telegramChats   = @()
    telegramOffset  = 0
  })
  if ($null -eq $data.botToken) { $data | Add-Member -NotePropertyName botToken -NotePropertyValue "" -Force }
  if ($null -eq $data.botUsername) { $data | Add-Member -NotePropertyName botUsername -NotePropertyValue "" -Force }
  if ($null -eq $data.workers) { $data | Add-Member -NotePropertyName workers -NotePropertyValue @() -Force }
  if ($null -eq $data.announcements) { $data | Add-Member -NotePropertyName announcements -NotePropertyValue @() -Force }
  if ($null -eq $data.telegramChats) { $data | Add-Member -NotePropertyName telegramChats -NotePropertyValue @() -Force }
  if ($null -eq $data.telegramOffset) { $data | Add-Member -NotePropertyName telegramOffset -NotePropertyValue 0 -Force }
  return $data
}

function Save-AdminData($data) {
  $payload = @{
    botToken       = [string]$data.botToken
    botUsername    = [string]$data.botUsername
    workers        = @(As-Array $data.workers)
    announcements  = @(As-Array $data.announcements)
    telegramChats  = @(As-Array $data.telegramChats)
    telegramOffset = [int64]$data.telegramOffset
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
      name     = [string]$w.name
      lavozim  = [string]$w.lavozim
      telegram = [string]$w.telegram
    }
  }
  $anns = @()
  foreach ($a in (As-Array $data.announcements)) {
    $anns += @{
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
      }
      Set-AuthCookie $ctx $sid $false
      Send-Json $ctx @{
        ok       = $true
        username = $username
        role     = [string]$user.role
        label    = [string]$user.label
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
      }
      return $true
    }

    $reportPosts = @(
      "/api/districts",
      "/api/districts/delete",
      "/api/districts/file"
    )
    $auth = Get-Auth $ctx
    $needDirector = $false
    if ($path -eq "/api/state") { $needDirector = $true }
    if ($path -eq "/api/telegram/chats") { $needDirector = $true }
    if ($method -eq "POST" -and ($reportPosts -notcontains $path)) { $needDirector = $true }
    if ($method -eq "POST" -and ($reportPosts -contains $path)) {
      if (-not $auth) {
        Send-Json $ctx @{ ok = $false; error = "Kirish kerak." } 401
        return $true
      }
    } elseif ($needDirector) {
      if (-not $auth -or [string]$auth.role -ne "director") {
        Send-Json $ctx @{ ok = $false; error = "Ruxsat yo'q." } 403
        return $true
      }
    }

    if ($method -eq "GET" -and $path -eq "/api/state") {
      Send-Json $ctx (Public-State)
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
      $list = @()
      foreach ($w in (As-Array $body.workers)) {
        $name = ([string]$w.name).Trim()
        $lavozim = ([string]$w.lavozim).Trim()
        $telegram = ([string]$w.telegram).Trim()
        if ($name -and $lavozim -and $telegram) {
          $list += @{ name = $name; lavozim = $lavozim; telegram = $telegram }
        }
      }
      $data.workers = $list
      Save-AdminData $data
      Sync-StaffWorkers $list
      Send-Json $ctx @{ ok = $true; workers = $list }
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
      if (-not $title -or -not $message) {
        Send-Json $ctx @{ ok = $false; error = "Sarlavha va xabar kerak." } 400
        return $true
      }
      $data = Get-AdminData
      $item = @{
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
        announcements = $anns
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
Write-Host "Admin: ${prefix}admin.html"

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
