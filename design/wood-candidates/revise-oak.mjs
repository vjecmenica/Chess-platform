// Preview only. Never writes production assets or preferences.
import fs from 'node:fs';
let seed = 0x6f616b32;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const distinct = xs => new Set(xs).size;
function acceptable(p) {
  for (let n = 0; n < 8; n++) {
    for (const line of [Array.from({length:8},(_,k)=>n*8+k), Array.from({length:8},(_,k)=>k*8+n)]) {
      if (distinct(line.map(i=>p[i]%8)) < 5 || distinct(line.map(i=>Math.floor(p[i]/8))) < 5) return false;
      for (let parity=0;parity<2;parity++) {
        const same = line.filter(i=>(Math.floor(i/8)+i%8)%2===parity);
        if (distinct(same.map(i=>p[i]%8)) < 3) return false;
      }
    }
  }
  for (const line of [Array.from({length:8},(_,k)=>k*9),Array.from({length:8},(_,k)=>k*8+7-k)]) {
    if (distinct(line.map(i=>p[i]%8)) < 5 || distinct(line.map(i=>Math.floor(p[i]/8))) < 5) return false;
  }
  return true;
}
let p, attempts=0;
do {
  p=Array.from({length:64},(_,i)=>i);
  for(let i=63;i>0;i--){const j=Math.floor(random()*(i+1));[p[i],p[j]]=[p[j],p[i]];}
  if(++attempts>2000000) throw Error('No suitable distribution');
} while(!acceptable(p));
const crops=p.map((v,i)=>({square:'abcdefgh'[i%8]+(8-Math.floor(i/8)),region:v,x:200+(v%8)*440+Math.floor(random()*81)-40,y:200+Math.floor(v/8)*440+Math.floor(random()*81)-40,size:320}));
fs.writeFileSync('design/wood-candidates/oak-v2-crops.json',JSON.stringify({seed:'0x6f616b32',attempts,crops},null,2)+'\n');
let ps=fs.readFileSync('tools/prepare-oak-squares.ps1','utf8');
ps=ps.replace("design/wood-candidates/a-oak-squares.jpg","design/wood-candidates/a-oak-squares-v2.jpg");
ps=ps.replace('int variant=(23*i+11)%64, sx=200+(variant%8)*440, sy=200+(variant/8)*440;',`int[] xs={${crops.map(c=>c.x)}}, ys={${crops.map(c=>c.y)}}; int sx=xs[i], sy=ys[i];`);
ps=ps.replace('// Fixed bijection. Every board square receives a different source crop.','// Fixed shuffled crop coordinates. See oak-v2-crops.json and revise-oak.mjs.');
fs.writeFileSync('design/wood-candidates/prepare-oak-v2.ps1',ps);
let html=fs.readFileSync('design/wood-candidates/squares.html','utf8').replaceAll('a-oak-squares','a-oak-squares-v2').replace('A refined · Oak squares','A revised · Varied oak squares');
html=html.replace('<button id="flip">','<button id="pieces">Hide pieces</button><button id="flip">').replace('let flipped=false;','let flipped=false; let showPieces=true;').replace('if(c.piece)el.innerHTML','if(c.piece && showPieces)el.innerHTML');
html=html.replace('select.onchange=render;',"document.querySelector('#pieces').onclick=e=>{showPieces=!showPieces;e.target.textContent=showPieces?'Hide pieces':'Show pieces';render()};select.onchange=render;");
fs.writeFileSync('design/wood-candidates/squares-v2.html',html);
const compare=fs.readFileSync('design/wood-candidates/compare.html','utf8').replace('src="squares.html"','src="squares-v2.html"').replace('src="index.html"','src="squares.html"').replace('Original A — continuous photograph','Current Refined A').replace('Refined A — separate oak squares','Revised A — mixed source regions');
fs.writeFileSync('design/wood-candidates/compare-v2.html',compare);
console.log({attempts,unique:distinct(p),columnSourceStrips:Array.from({length:8},(_,f)=>distinct(crops.filter((_,i)=>i%8===f).map(c=>c.region%8)))});
