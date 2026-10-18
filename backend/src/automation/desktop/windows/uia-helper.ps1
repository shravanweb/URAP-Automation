# URAP desktop automation helper for Windows.
# Called by backend/src/automation/desktop/windowsDriver.js once per command:
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File uia-helper.ps1 -Payload <base64 JSON>
# Writes exactly one JSON line: {"ok":true,"result":{...}} or {"ok":false,"code":"...","message":"..."}
# Uses .NET UI Automation (UIAutomationClient), SendKeys, and user32 mouse/keyboard input.
param(
  [Parameter(Mandatory = $true)][string]$Payload
)

$ErrorActionPreference = 'Stop'

function Write-Result($result) {
  $out = @{ ok = $true; result = $result }
  Write-Output ($out | ConvertTo-Json -Depth 8 -Compress)
}

function Write-Failure([string]$code, [string]$message) {
  $out = @{ ok = $false; code = $code; message = $message }
  Write-Output ($out | ConvertTo-Json -Depth 4 -Compress)
}

class UrapError : System.Exception {
  [string]$Code
  UrapError([string]$code, [string]$message) : base($message) { $this.Code = $code }
}

try {
  # URAP_UIA_SKIP_ASSEMBLIES=1 lets tests check payload handling with pwsh on Linux or macOS.
  $skipAssemblies = $env:URAP_UIA_SKIP_ASSEMBLIES -eq '1'
  if (-not $skipAssemblies) {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Windows.Forms
  if (-not ('UrapNative' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class UrapNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
  }
  }

  $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Payload))
  $req = $json | ConvertFrom-Json

  function Get-Timeout($value, [int]$fallback) {
    if ($null -eq $value) { return $fallback }
    return [int]$value
  }

  function Test-Title([string]$actual, [string]$expected, [string]$mode) {
    if ([string]::IsNullOrEmpty($expected)) { return $true }
    if ($null -eq $actual) { return $false }
    switch ($mode) {
      'exact' { return $actual -eq $expected }
      'regex' { return $actual -match $expected }
      default { return $actual.IndexOf($expected, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 }
    }
  }

  function Get-ProcessNameSafe([int]$processId) {
    try { return (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { return '' }
  }

  function Find-Window($title, $processName, [string]$mode, [int]$timeoutMs, $exclude = $null) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
    do {
      $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
      foreach ($w in $windows) {
        $name = $w.Current.Name
        if ($exclude -and $exclude.Contains([int64]$w.Current.NativeWindowHandle)) { continue }
        if (-not (Test-Title $name $title $mode)) { continue }
        if ($processName) {
          $pn = Get-ProcessNameSafe $w.Current.ProcessId
          if ($pn -ne ($processName -replace '\.exe$', '')) { continue }
        }
        return $w
      }
      Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw [UrapError]::new('WINDOW_NOT_FOUND', "No window matched title '$title' process '$processName'")
  }

  function Resolve-Window($window) {
    if ($null -eq $window) { throw [UrapError]::new('NO_WINDOW', 'No window was given') }
    if ($window.handle) {
      try {
        return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][int64]$window.handle)
      } catch {
        if (-not $window.title) { throw [UrapError]::new('WINDOW_NOT_FOUND', 'The attached window is closed') }
      }
    }
    return Find-Window $window.title $null 'exact' 5000
  }

  function Focus-Window($element) {
    $handle = [IntPtr][int64]$element.Current.NativeWindowHandle
    if ($handle -ne [IntPtr]::Zero) {
      if ([UrapNative]::IsIconic($handle)) { [UrapNative]::ShowWindow($handle, 9) | Out-Null }
      [UrapNative]::SetForegroundWindow($handle) | Out-Null
      Start-Sleep -Milliseconds 100
    }
  }

  function Find-Element($rootElement, $selector, [int]$timeoutMs) {
    $conditions = New-Object System.Collections.Generic.List[System.Windows.Automation.Condition]
    if ($selector.name) { $conditions.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, [string]$selector.name))) }
    if ($selector.automationId) { $conditions.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, [string]$selector.automationId))) }
    if ($selector.className) { $conditions.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, [string]$selector.className))) }
    if ($selector.controlType) {
      $type = [System.Windows.Automation.ControlType]::$($selector.controlType)
      if ($null -eq $type) { throw [UrapError]::new('VALIDATION', "Unknown control type $($selector.controlType)") }
      $conditions.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type)))
    }
    if ($conditions.Count -eq 0) { throw [UrapError]::new('VALIDATION', 'Empty selector') }
    if ($conditions.Count -eq 1) { $condition = $conditions[0] } else { $condition = New-Object System.Windows.Automation.AndCondition(, $conditions.ToArray()) }
    $index = 0
    if ($null -ne $selector.index) { $index = [int]$selector.index }
    $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
    do {
      $found = $rootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
      if ($found.Count -gt $index) { return $found[$index] }
      Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw [UrapError]::new('ELEMENT_NOT_FOUND', "No element matched $(($selector | ConvertTo-Json -Compress))")
  }

  function Invoke-MouseClick([int]$x, [int]$y, [string]$button, [bool]$double) {
    $down = 0x0002; $up = 0x0004
    if ($button -eq 'right') { $down = 0x0008; $up = 0x0010 }
    if ($button -eq 'middle') { $down = 0x0020; $up = 0x0040 }
    [UrapNative]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 50
    $count = 1
    if ($double) { $count = 2 }
    for ($i = 0; $i -lt $count; $i++) {
      [UrapNative]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
      [UrapNative]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 60
    }
  }

  function Window-Info($w) {
    return @{ handle = [int64]$w.Current.NativeWindowHandle; title = $w.Current.Name; processId = $w.Current.ProcessId; processName = (Get-ProcessNameSafe $w.Current.ProcessId) }
  }

  $timeout = Get-Timeout $req.timeoutMs 10000

  switch ($req.command) {
    'ping' {
      Write-Result @{ powershell = $PSVersionTable.PSVersion.ToString() }
    }
    'open_app' {
      $startArgs = @{ FilePath = [string]$req.path; PassThru = $true }
      if ($req.args -and $req.args.Count -gt 0) { $startArgs.ArgumentList = [string[]]$req.args }
      if ($req.workingDirectory) { $startArgs.WorkingDirectory = [string]$req.workingDirectory }
      # Remember windows that already exist so Open Application never reuses one the user had open.
      $existing = New-Object System.Collections.Generic.HashSet[int64]
      $winCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
      foreach ($ew in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $winCond)) { [void]$existing.Add([int64]$ew.Current.NativeWindowHandle) }
      if ($req.allowExistingWindow) { $existing.Clear() }
      $process = Start-Process @startArgs
      if ($req.windowTitle) {
        $w = Find-Window $req.windowTitle $null $req.match $timeout $existing
      } else {
        $deadline = [DateTime]::UtcNow.AddMilliseconds($timeout)
        $w = $null
        do {
          $process.Refresh()
          if ($process.MainWindowHandle -ne [IntPtr]::Zero -and -not $existing.Contains([int64]$process.MainWindowHandle)) { $w = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle); break }
          Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($null -eq $w) {
          # Apps such as the Windows 11 Notepad hand off to another process. Fall back to the newest window of that name.
          $w = Find-Window $null ([System.IO.Path]::GetFileNameWithoutExtension([string]$req.path)) 'contains' 3000 $existing
        }
      }
      Focus-Window $w
      Write-Result (Window-Info $w)
    }
    'attach' {
      $w = Find-Window $req.title $req.processName $req.match $timeout
      Focus-Window $w
      Write-Result (Window-Info $w)
    }
    'click' {
      $w = Resolve-Window $req.window
      Focus-Window $w
      if ($req.selector) {
        $el = Find-Element $w $req.selector $timeout
        $rect = $el.Current.BoundingRectangle
        if ($rect.IsEmpty) { throw [UrapError]::new('ELEMENT_NOT_VISIBLE', 'The element has no screen position') }
        $x = [int]($rect.X + $rect.Width / 2); $y = [int]($rect.Y + $rect.Height / 2)
      } else {
        $x = [int]$req.x; $y = [int]$req.y
      }
      Invoke-MouseClick $x $y ([string]$req.button) ([bool]$req.double)
      Write-Result @{ x = $x; y = $y }
    }
    'type' {
      $w = Resolve-Window $req.window
      Focus-Window $w
      $target = $w
      if ($req.selector) { $target = Find-Element $w $req.selector $timeout }
      $pattern = $null
      if ($req.method -eq 'value' -and $target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $pattern.SetValue([string]$req.text)
        Write-Result @{ method = 'value' }
      } else {
        if ($req.selector) { try { $target.SetFocus() } catch { } }
        if ($req.clearBefore -and $req.selector) {
          [System.Windows.Forms.SendKeys]::SendWait('^a')
          [System.Windows.Forms.SendKeys]::SendWait('{DEL}')
        }
        [System.Windows.Forms.SendKeys]::SendWait([string]$req.sendKeys)
        Write-Result @{ method = 'keys' }
      }
    }
    'hotkey' {
      $w = Resolve-Window $req.window
      Focus-Window $w
      foreach ($m in $req.modifiers) { [UrapNative]::keybd_event([byte]$m, 0, 0, [UIntPtr]::Zero) }
      foreach ($k in $req.keys) {
        [UrapNative]::keybd_event([byte]$k, 0, 0, [UIntPtr]::Zero)
        [UrapNative]::keybd_event([byte]$k, 0, 2, [UIntPtr]::Zero)
      }
      $mods = @($req.modifiers)
      [array]::Reverse($mods)
      foreach ($m in $mods) { [UrapNative]::keybd_event([byte]$m, 0, 2, [UIntPtr]::Zero) }
      Write-Result @{ sent = $true }
    }
    'get_text' {
      $w = Resolve-Window $req.window
      $el = Find-Element $w $req.selector $timeout
      $text = $null
      $pattern = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { $text = $pattern.Current.Value }
      elseif ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { $text = $pattern.DocumentRange.GetText(100000) }
      else { $text = $el.Current.Name }
      Write-Result @{ text = $text }
    }
    'close' {
      $w = Resolve-Window $req.window
      $pattern = $null
      if ($w.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)) { $pattern.Close() }
      else { Stop-Process -Id $w.Current.ProcessId }
      Write-Result @{ closed = $true }
    }
    default {
      throw [UrapError]::new('UNKNOWN_COMMAND', "Unknown command $($req.command)")
    }
  }
} catch [UrapError] {
  Write-Failure $_.Exception.Code $_.Exception.Message
} catch {
  Write-Failure 'DESKTOP_ERROR' $_.Exception.Message
}
