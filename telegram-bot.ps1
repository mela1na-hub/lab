# Telegram bot listener helpers. Dot-sourced from serve.ps1. Do not run alone.

$script:TelegramBotPolling = $false
$script:PendingBroadcasts = @{}
$script:TelegramTestMode = $false
$script:TelegramTestSink = @()
$script:LastTelegramPoll = [datetime]::MinValue
$script:TelegramWebhookCleared = $false

function Redact-TelegramSecret([string]$text) {
  return ([string]$text) -replace 'bot\d+:[A-Za-z0-9_-]+', 'bot<redacted>'
}

function Load-DotEnvFile([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  foreach ($line in Get-Content -LiteralPath $path -Encoding UTF8) {
    $t = [string]$line
    if ($t -match '^\s*#' -or [string]::IsNullOrWhiteSpace($t.Trim())) { continue }
    if ($t -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { continue }
    $key = [string]$Matches[1]
    $val = [string]$Matches[2]
    $val = $val.Trim()
    if ($val.StartsWith('"') -and $val.EndsWith('"') -and $val.Length -ge 2) {
      $val = $val.Substring(1, $val.Length - 2)
    } elseif ($val.StartsWith("'") -and $val.EndsWith("'") -and $val.Length -ge 2) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    $existing = [Environment]::GetEnvironmentVariable($key, "Process")
    if ([string]::IsNullOrWhiteSpace($existing)) {
      [Environment]::SetEnvironmentVariable($key, $val, "Process")
    }
  }
}

function Get-TelegramAdminIds {
  $raw = [Environment]::GetEnvironmentVariable("TELEGRAM_ADMIN_IDS", "Process")
  if ([string]::IsNullOrWhiteSpace($raw)) {
    $raw = [Environment]::GetEnvironmentVariable("TELEGRAM_ADMIN_IDS")
  }
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($p in @($raw -split '[,;\s]+')) {
    $s = ([string]$p).Trim()
    if ($s -match '^-?\d+$') { [void]$set.Add($s) }
  }
  return $set
}

function Test-TelegramAdminId($fromId) {
  $id = ([string]$fromId).Trim()
  if ($id -notmatch '^-?\d+$') { return $false }
  $set = Get-TelegramAdminIds
  if ($set.Count -eq 0) { return $false }
  return $set.Contains($id)
}

function Get-TelegramFromId($u) {
  if ($null -eq $u) { return "" }
  if ($u.callback_query -and $u.callback_query.from -and $u.callback_query.from.id) {
    return [string]$u.callback_query.from.id
  }
  $msg = $u.message
  if (-not $msg) { $msg = $u.edited_message }
  if ($msg -and $msg.from -and $msg.from.id) {
    return [string]$msg.from.id
  }
  return ""
}

function Get-WorkerBroadcastTargets($data) {
  $map = New-Object 'System.Collections.Generic.Dictionary[string,string]'
  foreach ($w in (As-Array $data.workers)) {
    if ($null -eq $w) { continue }
    $raw = ([string]$w.telegram).Trim()
    if ($raw -notmatch '^-?\d+$') { continue }
    if (-not $map.ContainsKey($raw)) {
      $label = ([string]$w.name).Trim()
      if ([string]::IsNullOrWhiteSpace($label)) { $label = $raw }
      $map[$raw] = $label
    }
  }
  return $map
}

function TgE([int]$code) {
  return [char]::ConvertFromUtf32($code)
}

function Format-TelegramAnnounce([string]$text) {
  $icon = TgE 0x1F4E2
  $dash = [string][char]0x2014
  return "$icon YANGI E'LON`n`n$text`n`n$dash Qashqadaryo Soil Lab"
}

function Format-TelegramPreview([string]$text, [int]$count) {
  $icon = TgE 0x1F4E2
  $people = TgE 0x1F465
  return "$icon E'lonni yuborishga tayyormisiz?`n`n$text`n`n$people Qabul qiluvchilar: $count nafar"
}

function Send-TelegramBotApi($token, $method, $bodyObj) {
  if ($script:TelegramTestMode) {
    $script:TelegramTestSink += , @{ method = [string]$method; body = $bodyObj }
    if ($bodyObj -and [string]$bodyObj.chat_id -eq "999") {
      throw "Forbidden: bot was blocked by the user"
    }
    return @{ ok = $true; result = @{ message_id = 1 } }
  }
  return Invoke-Telegram $token $method $null $bodyObj
}

function New-BroadcastPendingId {
  return [guid]::NewGuid().ToString("N").Substring(0, 12)
}

function Clear-ExpiredBroadcasts {
  $now = [datetime]::UtcNow
  $keys = @($script:PendingBroadcasts.Keys)
  foreach ($k in $keys) {
    $item = $script:PendingBroadcasts[$k]
    if ($null -eq $item) { continue }
    $created = [datetime]$item.createdAt
    if (($now - $created).TotalMinutes -gt 30) {
      $script:PendingBroadcasts.Remove($k)
    }
  }
}

function Merge-TelegramChatRow($row) {
  if ($null -eq $row -or [string]::IsNullOrWhiteSpace([string]$row.id)) { return }
  if ($script:TelegramTestMode) { return }
  $data = Get-AdminData
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
  $chats[[string]$row.id] = @{
    id       = [string]$row.id
    name     = [string]$row.name
    username = [string]$row.username
    at       = [string]$row.at
  }
  $data.telegramChats = To-JsonList @($chats.Values)
  Save-AdminData $data
}

function Get-TelegramPollOffset {
  if ($script:TelegramOffsetPath -and (Test-Path -LiteralPath $script:TelegramOffsetPath)) {
    try {
      $raw = (Get-Content -LiteralPath $script:TelegramOffsetPath -Raw -Encoding UTF8).Trim()
      if ($raw -match '^\d+$') { return [int64]$raw }
    } catch {}
  }
  try { return [int64](Get-AdminData).telegramOffset } catch { return [int64]0 }
}

function Set-TelegramPollOffset([int64]$offset) {
  if (-not $script:TelegramOffsetPath) { return }
  $dir = Split-Path -Parent $script:TelegramOffsetPath
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [IO.File]::WriteAllText($script:TelegramOffsetPath, [string]$offset, [Text.UTF8Encoding]::new($false))
}

function Send-TelegramStartReply($token, $chatId, $fromId) {
  $isAdmin = Test-TelegramAdminId $fromId
  $seed = TgE 0x1F331
  $icon = TgE 0x1F4E2
  if ($isAdmin) {
    $text = "$seed Qashqadaryo Soil Lab $([string][char]0x2014) Admin`nSiz administrator sifatida aniqlandingiz.`n$icon Xodimlarga e'lon yuborish uchun botga xabar yozishingiz mumkin."
  } else {
    $text = "$seed Qashqadaryo Soil Lab`nAssalomu alaykum! Bu bot orqali tashkilotga tegishli muhim e'lon va bildirishnomalarni olishingiz mumkin."
  }
  Send-TelegramBotApi $token "sendMessage" @{ chat_id = [string]$chatId; text = $text } | Out-Null
}

function Send-TelegramBroadcast($token, [string]$text) {
  $data = Get-AdminData
  $targets = Get-WorkerBroadcastTargets $data
  $total = $targets.Count
  $accepted = 0
  $errors = 0
  foreach ($id in @($targets.Keys)) {
    try {
      $resp = Send-TelegramBotApi $token "sendMessage" @{
        chat_id = [string]$id
        text    = (Format-TelegramAnnounce $text)
      }
      if (Test-TelegramSendOk $resp) { $accepted += 1 }
      else { $errors += 1 }
    } catch {
      $errors += 1
    }
  }
  return @{
    total     = $total
    accepted  = $accepted
    errors    = $errors
  }
}

function Handle-TelegramBotUpdate($u, [string]$token) {
  if ($null -eq $u) { return }
  $row = Get-ChatFromTelegramUpdate $u
  if ($row) { Merge-TelegramChatRow $row }

  if ($u.callback_query) {
    Handle-TelegramCallback $u.callback_query $token
    return
  }

  $msg = $u.message
  if (-not $msg) { return }
  if ($msg.from -and $msg.from.is_bot -eq $true) { return }
  $chatType = [string]$msg.chat.type
  if ($chatType -and $chatType -ne "private") { return }

  $fromId = Get-TelegramFromId $u
  $chatId = [string]$msg.chat.id
  $text = [string]$msg.text
  if ([string]::IsNullOrWhiteSpace($text) -and $msg.caption) { $text = [string]$msg.caption }
  $text = $text.Trim()
  if ([string]::IsNullOrWhiteSpace($text)) { return }

  if ($text -match '^/start(?:@\w+)?(?:\s|$)') {
    if (-not $script:TelegramTestMode) {
      Write-Host ("Telegram /start: user_id=" + $fromId)
    }
    Send-TelegramStartReply $token $chatId $fromId
    return
  }

  if ($text.StartsWith("/")) { return }

  if (-not (Test-TelegramAdminId $fromId)) { return }

  Clear-ExpiredBroadcasts
  $targets = Get-WorkerBroadcastTargets (Get-AdminData)
  $bid = New-BroadcastPendingId
  $script:PendingBroadcasts[$bid] = @{
    userId    = $fromId
    text      = $text
    createdAt = [datetime]::UtcNow
  }
  $preview = Format-TelegramPreview $text $targets.Count
  $okBtn = (TgE 0x2705) + " Barchaga yuborish"
  $noBtn = (TgE 0x274C) + " Bekor qilish"
  $markup = @{
    inline_keyboard = @(
      , @(
        @{ text = $okBtn; callback_data = "bcok_$bid" },
        @{ text = $noBtn; callback_data = "bcno_$bid" }
      )
    )
  }
  Send-TelegramBotApi $token "sendMessage" @{
    chat_id      = $chatId
    text         = $preview
    reply_markup = $markup
  } | Out-Null
}

function Handle-TelegramCallback($cq, [string]$token) {
  $qid = [string]$cq.id
  $fromId = ""
  if ($cq.from -and $cq.from.id) { $fromId = [string]$cq.from.id }
  $data = [string]$cq.data
  $chatId = ""
  $messageId = $null
  if ($cq.message) {
    if ($cq.message.chat) { $chatId = [string]$cq.message.chat.id }
    if ($cq.message.message_id) { $messageId = $cq.message.message_id }
  }

  if (-not (Test-TelegramAdminId $fromId)) {
    try {
      Send-TelegramBotApi $token "answerCallbackQuery" @{
        callback_query_id = $qid
        text              = "Ruxsat yo'q."
        show_alert        = $true
      } | Out-Null
    } catch {}
    return
  }

  $ok = $false
  $bid = ""
  if ($data -match '^bcok_([A-Za-z0-9]{8,16})$') {
    $ok = $true
    $bid = [string]$Matches[1]
  } elseif ($data -match '^bcno_([A-Za-z0-9]{8,16})$') {
    $ok = $false
    $bid = [string]$Matches[1]
  } else {
    try {
      Send-TelegramBotApi $token "answerCallbackQuery" @{
        callback_query_id = $qid
        text              = "Noma'lum buyruq."
      } | Out-Null
    } catch {}
    return
  }

  Clear-ExpiredBroadcasts
  if (-not $script:PendingBroadcasts.ContainsKey($bid)) {
    try {
      Send-TelegramBotApi $token "answerCallbackQuery" @{
        callback_query_id = $qid
        text              = "E'lon topilmadi yoki muddati o'tgan."
        show_alert        = $true
      } | Out-Null
    } catch {}
    return
  }

  $pending = $script:PendingBroadcasts[$bid]
  if ([string]$pending.userId -ne $fromId) {
    try {
      Send-TelegramBotApi $token "answerCallbackQuery" @{
        callback_query_id = $qid
        text              = "Ruxsat yo'q."
        show_alert        = $true
      } | Out-Null
    } catch {}
    return
  }

  if (-not $ok) {
    $script:PendingBroadcasts.Remove($bid)
    try {
      Send-TelegramBotApi $token "answerCallbackQuery" @{
        callback_query_id = $qid
        text              = "Bekor qilindi."
      } | Out-Null
    } catch {}
    if ($chatId -and $messageId) {
      try {
        Send-TelegramBotApi $token "editMessageText" @{
          chat_id    = $chatId
          message_id = $messageId
          text       = ((TgE 0x274C) + " E'lon bekor qilindi.")
        } | Out-Null
      } catch {}
    }
    return
  }

  $text = [string]$pending.text
  $script:PendingBroadcasts.Remove($bid)
  try {
    Send-TelegramBotApi $token "answerCallbackQuery" @{
      callback_query_id = $qid
      text              = "Yuborilmoqda..."
    } | Out-Null
  } catch {}

  $result = Send-TelegramBroadcast $token $text
  $summary = "$(TgE 0x2705) E'lon yuborildi.`n$(TgE 0x1F465) Jami: $($result.total) $(TgE 0x2705) Yetkazish uchun Telegram API qabul qildi: $($result.accepted) $(TgE 0x274C) Xatolik: $($result.errors)"
  if ($chatId -and $messageId) {
    try {
      Send-TelegramBotApi $token "editMessageText" @{
        chat_id    = $chatId
        message_id = $messageId
        text       = $summary
      } | Out-Null
    } catch {
      try {
        Send-TelegramBotApi $token "sendMessage" @{ chat_id = $chatId; text = $summary } | Out-Null
      } catch {}
    }
  } else {
    try {
      Send-TelegramBotApi $token "sendMessage" @{ chat_id = $fromId; text = $summary } | Out-Null
    } catch {}
  }
}

function Invoke-TelegramBotPollOnce {
  if ($script:TelegramTestMode) { return }
  $data = Get-AdminData
  $token = [string]$data.botToken
  if ([string]::IsNullOrWhiteSpace($token)) { return }
  if (-not $script:TelegramWebhookCleared) {
    try { Invoke-Telegram $token "deleteWebhook" $null $null | Out-Null } catch {}
    $script:TelegramWebhookCleared = $true
  }
  $offset = Get-TelegramPollOffset
  $allowed = "allowed_updates=%5B%22message%22%2C%22callback_query%22%2C%22my_chat_member%22%5D"
  $query = "timeout=0&limit=50&$allowed"
  if ($offset -gt 0) { $query = "timeout=0&limit=50&offset=$offset&$allowed" }
  $resp = $null
  try {
    $resp = Invoke-Telegram $token "getUpdates" $query
  } catch {
    $em = Redact-TelegramSecret ([string]$_.Exception.Message)
    if ($em -notmatch 'timed out|The operation has timed out') {
      Write-Host "Telegram listener: $em"
    }
    return
  }
  $raw = $null
  if ($null -ne $resp) {
    if ($resp.PSObject.Properties.Name -contains "result") { $raw = $resp.result }
    elseif ($resp.update_id) { $raw = $resp }
  }
  $batch = @(As-Array $raw)
  if ($batch.Count -eq 1 -and $null -eq $batch[0]) { $batch = @() }
  if ($batch.Count -eq 0) { return }
  foreach ($u in $batch) {
    if ($null -eq $u) { continue }
    try {
      $uid = [int64]$u.update_id
      if ($uid + 1 -gt $offset) { $offset = $uid + 1 }
    } catch {}
    try {
      Handle-TelegramBotUpdate $u $token
    } catch {
      Write-Host (Redact-TelegramSecret ([string]$_.Exception.Message))
    }
  }
  Set-TelegramPollOffset $offset
}

function Pump-TelegramBotListener {
  if (-not $script:TelegramBotPolling) { return }
  if (([datetime]::UtcNow - $script:LastTelegramPoll).TotalMilliseconds -lt 800) { return }
  $script:LastTelegramPoll = [datetime]::UtcNow
  try { Invoke-TelegramBotPollOnce } catch {
    Write-Host (Redact-TelegramSecret ([string]$_.Exception.Message))
  }
}
