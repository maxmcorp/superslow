# Speaks every number a set needs into sounds/<n>.wav with a Windows voice.
# These are stand-ins until the real recordings replace them; run tools/build.mjs afterwards.
#   powershell -File tools/placeholder-sounds.ps1 [-Last 180] [-Voice "Microsoft Zira Desktop"]

param(
  [int]$Last = 180,
  [string]$Voice = 'Microsoft Zira Desktop'
)

Add-Type -AssemblyName System.Speech

$sounds = Join-Path (Split-Path -Parent $PSScriptRoot) 'sounds'
New-Item -ItemType Directory -Force $sounds | Out-Null

# The same numbers as schedule.js: 0-10 for the countdown, then every 10 s to 60 and every 5 s after.
$numbers = @(0..10) + @(20, 30, 40, 50, 60)
for ($n = 65; $n -le $Last; $n += 5) { $numbers += $n }

$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.SelectVoice($Voice)
$speaker.Rate = 1
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($n in $numbers) {
  $speaker.SetOutputToWaveFile((Join-Path $sounds "$n.wav"), $format)
  $speaker.Speak("$n")
}
$speaker.SetOutputToNull()
$speaker.Dispose()
Write-Output "$($numbers.Count) placeholder sounds in $sounds"
