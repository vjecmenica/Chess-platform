# Offline deterministic atlas. Oak Veneer 01, Jenelle van Heerden, CC0.
param([string]$Source='.local/oak-veneer-source.jpg', [string]$Output='design/wood-candidates/a-oak-squares.jpg')
$ErrorActionPreference='Stop'
if ((Get-FileHash $Source -Algorithm SHA256).Hash -ne '7e8c64811e580ef6664c20524606359c739e6fe030eff5c2c06c3482ecc8b1cf') { throw 'Unexpected oak source hash' }
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies @('System.Drawing.Common','System.Drawing.Primitives','System.Private.Windows.GdiPlus','System.Private.Windows.Core','System.Runtime') -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
public class OakSquareAtlas {
 public static void Make(string source,string output) {
 using(var input=Image.FromFile(source)) using(var atlas=new Bitmap(2048,2048)) {
 for(int i=0;i<64;i++) {
 // Fixed bijection. Every board square receives a different source crop.
 int variant=(23*i+11)%64, sx=200+(variant%8)*440, sy=200+(variant/8)*440;
 using(var tile=new Bitmap(256,256)) {
 using(var g=Graphics.FromImage(tile)) { g.InterpolationMode=InterpolationMode.HighQualityBicubic; g.DrawImage(input,new Rectangle(0,0,256,256),new Rectangle(sx,sy,320,320),GraphicsUnit.Pixel); }
 double sum=0;for(int y=0;y<256;y++)for(int x=0;x<256;x++){var p=tile.GetPixel(x,y);sum+=.2126*p.R+.7152*p.G+.0722*p.B;}
 double mean=sum/65536; var mid=((i/8+i%8)%2==0)?new[]{224,203,168}:new[]{139,102,69};
 for(int y=0;y<256;y++)for(int x=0;x<256;x++){var p=tile.GetPixel(x,y);double d=(.2126*p.R+.7152*p.G+.0722*p.B-mean)*.65;tile.SetPixel(x,y,Color.FromArgb((int)Math.Clamp(mid[0]+d,0,255),(int)Math.Clamp(mid[1]+d,0,255),(int)Math.Clamp(mid[2]+d,0,255)));}
 using(var g=Graphics.FromImage(atlas)){g.DrawImageUnscaled(tile,(i%8)*256,(i/8)*256);}
 }
 }
 var codec=Array.Find(ImageCodecInfo.GetImageEncoders(),c=>c.MimeType=="image/jpeg");using(var p=new EncoderParameters(1)){p.Param[0]=new EncoderParameter(Encoder.Quality,84L);atlas.Save(output,codec,p);}
 }
 }
}
"@
[OakSquareAtlas]::Make((Resolve-Path $Source).Path,[IO.Path]::GetFullPath($Output))

