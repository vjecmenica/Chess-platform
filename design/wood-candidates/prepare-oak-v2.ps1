# Offline deterministic atlas. Oak Veneer 01, Jenelle van Heerden, CC0.
param([string]$Source='.local/oak-veneer-source.jpg', [string]$Output='design/wood-candidates/a-oak-squares-v2.jpg')
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
 // Fixed shuffled crop coordinates. See oak-v2-crops.json and revise-oak.mjs.
 int[] xs={234,3244,637,1485,662,605,2370,2398,2855,2401,1102,1485,1485,661,1076,1551,1491,1084,1961,3275,2830,177,2866,191,1107,185,2410,652,3312,669,2868,2800,675,1488,1113,2420,3254,1115,1952,1047,2404,3296,1943,1922,1947,1558,2875,1964,1117,3266,2361,3248,3311,227,1969,2878,178,1930,1480,2385,647,2846,195,173}, ys={667,2395,3314,629,659,1959,1118,2858,196,666,2384,2414,1534,1095,2860,1959,2823,3251,1057,1995,1074,1547,3280,3317,180,1087,161,1508,3240,2816,1549,1943,196,3263,1958,2425,209,615,1526,1554,3272,2874,2858,211,1962,187,666,635,1090,1510,1958,1120,614,2383,3248,2361,1997,2376,1119,1493,2381,2836,195,2865}; int sx=xs[i], sy=ys[i];
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

