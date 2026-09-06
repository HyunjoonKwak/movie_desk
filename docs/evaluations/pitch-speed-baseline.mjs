import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/apps/web/package.json');
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
console.log(JSON.stringify(await page.evaluate(async () => {
 const sr=48000,n=sr*2;
 const frequency = a => {let crossings=0; for(let i=sr/10+1;i<a.length-sr/10;i++) if(a[i-1]<=0&&a[i]>0)crossings++; return crossings/((a.length-sr/5)/sr);};
 const rows=[];
 for(const rate of [.5,2]) {
 const ctx=new OfflineAudioContext(1,n/rate,sr), b=ctx.createBuffer(1,n,sr);
 const pcm=b.getChannelData(0);for(let i=0;i<n;i++)pcm[i]=Math.sin(2*Math.PI*440*i/sr);
 const s=ctx.createBufferSource();s.buffer=b;s.playbackRate.value=rate;s.connect(ctx.destination);s.start();
 const out=(await ctx.startRendering()).getChannelData(0);
 const nearest=Float32Array.from({length:n/rate},(_,i)=>pcm[Math.floor(i*rate)]??0);
 rows.push({rate,previewHz:frequency(out),exportHz:frequency(nearest)});
 }
 const ctx=new OfflineAudioContext(1,sr*2,sr),b=ctx.createBuffer(1,sr*4,sr);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=Math.sin(2*Math.PI*440*i/sr);
 const s=ctx.createBufferSource();s.buffer=b;s.playbackRate.setValueCurveAtTime(new Float32Array([.5,2]),0,2);s.connect(ctx.destination);s.start();const a=(await ctx.startRendering()).getChannelData(0);
 const fixtures=[];
 for (const name of ['speech-band burst','18kHz alias probe']) {
  const src=new Float32Array(sr);
  for(let i=0;i<sr;i++) {
   if(name==='18kHz alias probe') src[i]=Math.sin(2*Math.PI*18000*i/sr);
   else if(i>=sr*.2&&i<sr*.4) { for(let j=0;j<64;j++)src[i]+=Math.sin(2*Math.PI*(300+j*49)*i/sr+j*j*.71)/8; }
  }
  const pcm=Float32Array.from({length:sr/2},(_,i)=>src[i*2]);
  const ctx=new OfflineAudioContext(1,sr/2,sr),b=ctx.createBuffer(1,sr,sr);
  b.copyToChannel(src,0);const node=ctx.createBufferSource();node.buffer=b;node.playbackRate.value=2;node.connect(ctx.destination);node.start();
  const preview=(await ctx.startRendering()).getChannelData(0);
  const metric=(out)=>{
   let energy=0, crossings=0, re=0,im=0;
   for(let i=0;i<out.length;i++){energy+=out[i]*out[i];if(i&&out[i-1]<=0&&out[i]>0)crossings++;re+=out[i]*Math.cos(2*Math.PI*12000*i/sr);im+=out[i]*Math.sin(2*Math.PI*12000*i/sr);}
   return {rms:Math.sqrt(energy/out.length),crossings,alias12kAmplitude:2*Math.hypot(re,im)/out.length};
  };
  fixtures.push({name,preview:metric(preview),export:metric(pcm)});
 }
 return {rows,fixtures,rampFirstHz:frequency(a.subarray(0,sr/2)),rampLastHz:frequency(a.subarray(sr*1.5)),note:'zero-crossing windows exclude 100ms each edge'};
}), null, 2));
await browser.close();
