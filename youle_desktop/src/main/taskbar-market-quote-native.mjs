// Read-only shell geometry watcher. It neither injects into Explorer nor changes
// taskbar settings. Kept in an mjs resource so it is included in signed packages.
export const TASKBAR_GEOMETRY_SCRIPT = String.raw`
param([int]$OwnerProcessId)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Win32;

public static class HaoloTaskbarGeometry {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string c,string n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,System.Text.StringBuilder b,int n);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  static volatile bool closed;
  static object Box(double x,double y,double w,double h) { return new { x=x,y=y,width=w,height=h }; }
  static object Box(RECT r) { return Box(r.Left,r.Top,r.Right-r.Left,r.Bottom-r.Top); }
  static object Snapshot() {
    IntPtr taskbar=FindWindow("Shell_TrayWnd",null);
    RECT r;
    if(taskbar==IntPtr.Zero||!IsWindowVisible(taskbar)||!GetWindowRect(taskbar,out r)) return new {visible=false};
    var screen=Screen.FromHandle(taskbar).Bounds;
    // Auto-hide can leave only a 1-2px strip. Hide with the shell.
    if(Math.Min(r.Bottom,screen.Bottom)-Math.Max(r.Top,screen.Top)<24 || r.Right-r.Left<r.Bottom-r.Top)
      return new {visible=false};
    IntPtr fg=GetForegroundWindow();
    RECT f;
    var cls=new System.Text.StringBuilder(128);
    GetClassName(fg,cls,cls.Capacity);
    if(fg!=taskbar&&cls.ToString()!="Progman"&&cls.ToString()!="WorkerW"&&GetWindowRect(fg,out f)
      &&f.Left<=screen.Left&&f.Top<=screen.Top&&f.Right>=screen.Right&&f.Bottom>=screen.Bottom)
      return new {visible=false};
    var root=AutomationElement.FromHandle(taskbar);
    var condition=new OrCondition(
      new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),
      new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.TabItem),
      new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.MenuItem),
      new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.CheckBox),
      new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit),
      new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.ListItem));
    var occupied=new List<object>();
    object anchor=null;
    var items=root.FindAll(TreeScope.Descendants,condition);
    for(int i=0;i<items.Count;i++) {
      var item=items[i].Current;
      var b=item.BoundingRectangle;
      if(item.IsOffscreen||b.IsEmpty||b.Width<=0||b.Height<=0||b.Bottom<=r.Top||b.Top>=r.Bottom) continue;
      var box=Box(b.X,b.Y,b.Width,b.Height);
      occupied.Add(box);
      string id=(item.AutomationId??"").ToLowerInvariant();
      string name=(item.Name??"").ToLowerInvariant();
      if(id.Contains("local.haolo.desktop")||name.StartsWith("haolo")||name.StartsWith("\u597d\u54af")) anchor=box;
    }
    // Native tray bounds also protect icons that a shell UIA provider omits.
    IntPtr tray=FindWindowEx(taskbar,IntPtr.Zero,"TrayNotifyWnd",null);
    RECT tr;
    if(tray!=IntPtr.Zero&&GetWindowRect(tray,out tr)) occupied.Add(Box(tr));
    bool dark=false;
    using(var key=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")) {
      if(key!=null) dark=Convert.ToInt32(key.GetValue("SystemUsesLightTheme",1))==0;
    }
    return new { visible=anchor!=null, bar=Box(r), anchor=anchor, occupied=occupied, dark=dark };
  }
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string name);
  public static void Run(int owner) {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch {}
    var input=new Thread(()=>{try {while(Console.ReadLine()!=null){}} catch {} finally {closed=true;}});
    input.IsBackground=true; input.Start();
    var serializer=new JavaScriptSerializer();
    while(!closed) {
      try { using(var process=Process.GetProcessById(owner)) { if(process.HasExited) break; } } catch { break; }
      try { Console.WriteLine(serializer.Serialize(Snapshot())); }
      catch { Console.WriteLine("{\"visible\":false}"); }
      Console.Out.Flush();
      Thread.Sleep(1000);
    }
  }
}
'@
$framework = [Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$refs = @('System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll',
  (Join-Path $framework 'WPF\UIAutomationClient.dll'),(Join-Path $framework 'WPF\UIAutomationTypes.dll'),(Join-Path $framework 'WPF\WindowsBase.dll'))
Add-Type -TypeDefinition $source -ReferencedAssemblies $refs
[HaoloTaskbarGeometry]::Run($OwnerProcessId)
`;
