# Windows notification hook for Claude Code
# Sends desktop toast when Claude needs attention

$input_json = $input | Out-String
$data = $null
try {
    $data = $input_json | ConvertFrom-Json
} catch {
    exit 0
}

if (-not $data) { exit 0 }

$title = "Claude Code"
$message = "Attention needed"

# Determine message based on notification type
if ($data.type -match "permission") {
    $message = "Permission required"
} elseif ($data.type -match "idle") {
    $message = "Waiting for input"
}

# Try BurntToast (best), fall back to native balloon
try {
    $btModule = Get-Module -ListAvailable -Name BurntToast -ErrorAction SilentlyContinue
    if ($btModule) {
        Import-Module BurntToast -ErrorAction Stop
        New-BurntToastNotification -Text $title, $message -Sound 'Default'
    } else {
        # Native Windows balloon notification
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        $balloon = New-Object System.Windows.Forms.NotifyIcon
        $balloon.Icon = [System.Drawing.SystemIcons]::Information
        $balloon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $balloon.BalloonTipTitle = $title
        $balloon.BalloonTipText = $message
        $balloon.Visible = $true
        $balloon.ShowBalloonTip(5000)
        Start-Sleep -Milliseconds 500
        $balloon.Dispose()
    }
} catch {
    # Silent fail - notification is optional
}

exit 0
