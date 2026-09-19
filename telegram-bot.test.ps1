$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $root) { $root = "c:\Users\Gebruiker\.cursor\projects\lab" }
Set-Location $root

$script:FakeData = @{
  botToken      = "0:TESTTOKEN"
  workers       = @(
    @{ id = "w1"; name = "Ali"; telegram = "111" }
    @{ id = "w2"; name = "Vali"; telegram = "222" }
    @{ id = "w3"; name = "NoChat"; telegram = "" }
    @{ id = "w4"; name = "Bad"; telegram = "999" }
  )
  telegramChats = @()
}
$script:Sink = @()
$script:TelegramOffsetPath = Join-Path $env:TEMP "ttati-telegram-offset-test.txt"

function As-Array($value) {
  if ($null -eq $value) { return @() }
  if ($value -is [System.Array]) { return @($value) }
  return @($value)
}

function Get-AdminData { return $script:FakeData }
function Save-AdminData($data) { $script:FakeData = $data }
function To-JsonList($items) { return @(As-Array $items) }

function Test-TelegramSendOk($resp) {
  if ($null -eq $resp) { return $false }
  if ($resp.ok -eq $true) { return $true }
  if ($resp.result -and $resp.result.message_id) { return $true }
  return $false
}

function Get-ChatFromTelegramUpdate($u) {
  $msg = $u.message
  if (-not $msg) { $msg = $u.callback_query.message }
  if (-not $msg -or -not $msg.chat) { return $null }
  return @{
    id       = [string]$msg.chat.id
    name     = [string]$msg.chat.first_name
    username = ""
    at       = "1"
  }
}

function Invoke-Telegram($token, $method, $query = $null, $bodyObj = $null) {
  throw "Invoke-Telegram should not be called in unit tests: $method"
}

. (Join-Path $root "telegram-bot.ps1")
$script:TelegramTestMode = $true
$env:TELEGRAM_ADMIN_IDS = "555001"

function Reset-Sink {
  $script:TelegramTestSink = @()
  $script:PendingBroadcasts = @{}
}

function New-Msg($fromId, $text, $chatId = $null) {
  if (-not $chatId) { $chatId = $fromId }
  return @{
    message = @{
      chat = @{ id = $chatId; type = "private"; first_name = "User$fromId" }
      from = @{ id = $fromId; is_bot = $false }
      text = $text
    }
  }
}

function New-Cb($fromId, $data, $chatId = $null) {
  if (-not $chatId) { $chatId = $fromId }
  return @{
    callback_query = @{
      id   = "cq1"
      data = $data
      from = @{ id = $fromId }
      message = @{
        message_id = 10
        chat       = @{ id = $chatId; type = "private" }
      }
    }
  }
}

function Sink-Methods { @($script:TelegramTestSink | ForEach-Object { $_.method }) }
function Sink-WorkerSends {
  @($script:TelegramTestSink | Where-Object {
    $_.method -eq "sendMessage" -and $_.body.chat_id -in @("111", "222", "999")
  })
}

$script:failed = 0
function Assert-True($cond, $name) {
  if ($cond) { Write-Host "PASS $name" }
  else { Write-Host "FAIL $name"; $script:failed++ }
}

# A) ordinary worker message must not broadcast
Reset-Sink
Handle-TelegramBotUpdate (New-Msg "111" "Salom hammaga") "0:TESTTOKEN"
Assert-True ((Sink-WorkerSends).Count -eq 0) "A worker text is not broadcast"
Assert-True ($script:PendingBroadcasts.Count -eq 0) "A no pending for worker"

# B) admin text -> preview
Reset-Sink
Handle-TelegramBotUpdate (New-Msg "555001" "Test elon") "0:TESTTOKEN"
$preview = @($script:TelegramTestSink | Where-Object { $_.method -eq "sendMessage" })[0]
Assert-True ($null -ne $preview) "B preview sent"
Assert-True ($preview.body.text -match "E'lonni yuborishga tayyormisiz") "B preview title"
Assert-True ($preview.body.text -match "Test elon") "B preview body"
Assert-True ($preview.body.text -match "Qabul qiluvchilar: 3 nafar") "B recipient count skips empty chat_id"
Assert-True ($script:PendingBroadcasts.Count -eq 1) "B pending stored"
$bid = @($script:PendingBroadcasts.Keys)[0]
Assert-True ($preview.body.reply_markup.inline_keyboard[0][0].callback_data -eq "bcok_$bid") "B confirm button"

# C) admin cancel -> nobody receives
Reset-Sink
Handle-TelegramBotUpdate (New-Msg "555001" "Test elon") "0:TESTTOKEN"
$bid = @($script:PendingBroadcasts.Keys)[0]
$script:TelegramTestSink = @()
Handle-TelegramBotUpdate (New-Cb "555001" "bcno_$bid") "0:TESTTOKEN"
Assert-True ((Sink-WorkerSends).Count -eq 0) "C cancel does not send to workers"
Assert-True ($script:PendingBroadcasts.Count -eq 0) "C pending cleared"
$edited = @($script:TelegramTestSink | Where-Object { $_.method -eq "editMessageText" })[0]
Assert-True ($edited.body.text -match "bekor") "C cancel edits preview"

# D + E + F) confirm sends to chat_id workers, skips empty, continues after error
Reset-Sink
Handle-TelegramBotUpdate (New-Msg "555001" "Test elon") "0:TESTTOKEN"
$bid = @($script:PendingBroadcasts.Keys)[0]
$script:TelegramTestSink = @()
Handle-TelegramBotUpdate (New-Cb "555001" "bcok_$bid") "0:TESTTOKEN"
$workerSends = @(Sink-WorkerSends)
$ids = @($workerSends | ForEach-Object { [string]$_.body.chat_id })
Assert-True ($ids -contains "111") "D sent to worker 111"
Assert-True ($ids -contains "222") "D sent to worker 222"
Assert-True ($ids -contains "999") "F attempted bad chat_id"
Assert-True ($ids -notcontains "") "E no empty chat_id send"
Assert-True ($workerSends[0].body.text -match "YANGI E'LON") "D announce header"
Assert-True ($workerSends[0].body.text -match "Test elon") "D announce body"
$summary = @($script:TelegramTestSink | Where-Object { $_.method -eq "editMessageText" })[0]
Assert-True ($summary.body.text -match "Jami: 3") "D/F total 3 with chat_id"
Assert-True ($summary.body.text -match "qabul qildi: 2") "F API accepted 2"
Assert-True ($summary.body.text -match "Xatolik: 1") "F one error recorded"
Assert-True ($summary.body.text -notmatch "Yetkazildi") "wording does not claim delivered"

# G) non-admin forged callback cannot broadcast
Reset-Sink
Handle-TelegramBotUpdate (New-Msg "555001" "Test elon") "0:TESTTOKEN"
$bid = @($script:PendingBroadcasts.Keys)[0]
$script:TelegramTestSink = @()
Handle-TelegramBotUpdate (New-Cb "111" "bcok_$bid") "0:TESTTOKEN"
Assert-True ((Sink-WorkerSends).Count -eq 0) "G forged callback does not send"
Assert-True ($script:PendingBroadcasts.ContainsKey($bid)) "G pending still for admin"
$denied = @($script:TelegramTestSink | Where-Object { $_.method -eq "answerCallbackQuery" })[0]
Assert-True ($denied.body.text -match "Ruxsat") "G rejected"

# /start texts
Reset-Sink
Handle-TelegramBotUpdate (New-Msg "111" "/start") "0:TESTTOKEN"
$st = @($script:TelegramTestSink | Where-Object { $_.method -eq "sendMessage" })[0]
Assert-True ($st.body.text -match "Assalomu alaykum") "start user greeting"
Assert-True ($st.body.text -notmatch "administrator") "start user is not admin"
Reset-Sink
Handle-TelegramBotUpdate (New-Msg "555001" "/start") "0:TESTTOKEN"
$st = @($script:TelegramTestSink | Where-Object { $_.method -eq "sendMessage" })[0]
Assert-True ($st.body.text -match "administrator sifatida") "start admin greeting"

# username must not grant admin
Reset-Sink
$env:TELEGRAM_ADMIN_IDS = "notaname,@boss"
Handle-TelegramBotUpdate (New-Msg "555001" "Hacking") "0:TESTTOKEN"
Assert-True ($script:PendingBroadcasts.Count -eq 0) "username in env is ignored"

if ($script:failed -gt 0) {
  Write-Host "FAILED $($script:failed)"
  exit 1
}
Write-Host "ALL_PASS"
exit 0
