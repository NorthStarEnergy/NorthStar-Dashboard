using System;
using System.Diagnostics;
using System.IO;

internal static class NorthStarManagerLauncher
{
    [STAThread]
    private static void Main()
    {
        var folder = Path.Combine(AppContext.BaseDirectory, "NorthStar Manager Runtime");
        var executable = Path.Combine(folder, "NorthStar Manager.exe");
        if (!File.Exists(executable))
        {
            System.Windows.Forms.MessageBox.Show("NorthStar Manager runtime is missing.", "NorthStar Manager");
            return;
        }
        Process.Start(new ProcessStartInfo(executable) { WorkingDirectory = folder, UseShellExecute = true });
    }
}
