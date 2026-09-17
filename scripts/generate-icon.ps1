Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeIconMethods {
    [DllImport("user32.dll")]
    public static extern bool DestroyIcon(IntPtr handle);
}
"@

$iconDirectory = Join-Path $PSScriptRoot "..\src-tauri\icons"
New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 64, 64
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(21, 24, 29))

$orange = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(223, 155, 66)), 5
$orange.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$orange.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$muted = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(92, 102, 116)), 2

$graphics.DrawEllipse($orange, 14, 14, 36, 36)
$graphics.DrawEllipse($muted, 25, 25, 14, 14)
$graphics.DrawLine($orange, 32, 6, 32, 18)
$graphics.DrawLine($orange, 32, 46, 32, 58)
$graphics.DrawLine($orange, 6, 32, 18, 32)
$graphics.DrawLine($orange, 46, 32, 58, 32)
$graphics.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(240, 173, 83))), 29, 29, 6, 6)

$handle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($handle)
$stream = [System.IO.File]::Create((Join-Path $iconDirectory "icon.ico"))
$icon.Save($stream)
$stream.Dispose()
$icon.Dispose()
[NativeIconMethods]::DestroyIcon($handle) | Out-Null
$orange.Dispose()
$muted.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
