Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies @("System.Drawing.Common","System.Drawing.Primitives","System.Private.Windows.GdiPlus","System.Private.Windows.Core","System.Runtime") -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
public class WoodCandidates { static double Clamp(double v,int a,int b) { return Math.Max(a,Math.Min(b,v)); }
 public static void Make(string source,string output,int x,int y,int crop,int[] light,int[] dark,double contrast) {
 using(var input=Image.FromFile(source)) using(var bitmap=new Bitmap(1024,1024)) {
 using(var g=Graphics.FromImage(bitmap)) { g.InterpolationMode=InterpolationMode.HighQualityBicubic; g.DrawImage(input,new Rectangle(0,0,1024,1024),new Rectangle(x,y,crop,crop),GraphicsUnit.Pixel); }
 double sum=0;
 for(int j=0;j<1024;j++) for(int i=0;i<1024;i++) { var p=bitmap.GetPixel(i,j); sum+=.2126*p.R+.7152*p.G+.0722*p.B; }
 double mean=sum/(1024*1024);
 for(int j=0;j<1024;j++) for(int i=0;i<1024;i++) { var p=bitmap.GetPixel(i,j); double d=(.2126*p.R+.7152*p.G+.0722*p.B-mean)*contrast; var mid=((i/128+j/128)%2==0)?light:dark; bitmap.SetPixel(i,j,Color.FromArgb((int)Clamp(mid[0]+d,0,255),(int)Clamp(mid[1]+d,0,255),(int)Clamp(mid[2]+d,0,255))); }
 var codec=Array.Find(ImageCodecInfo.GetImageEncoders(),c=>c.MimeType=="image/jpeg"); using(var parameters=new EncoderParameters(1)) { parameters.Param[0]=new EncoderParameter(Encoder.Quality,92L); bitmap.Save(output,codec,parameters); }
 }
 }
}
"@
$root=(Get-Location).Path
[WoodCandidates]::Make("$root/.local/oak-veneer-source.jpg","$root/design/wood-candidates/a-oak.jpg",900,800,1800,@(224,203,168),@(139,102,69),0.65)
[WoodCandidates]::Make("$root/.local/wood-table-001-source.jpg","$root/design/wood-candidates/b-walnut.jpg",1000,900,2000,@(223,203,175),@(124,89,62),0.95)
[WoodCandidates]::Make("$root/.local/oak-veneer-source.jpg","$root/design/wood-candidates/c-honey.jpg",1800,1600,1200,@(234,211,167),@(156,113,62),0.55)



