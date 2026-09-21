export const LEVELS = [0.5, 1, 1.5, 2, 2.5];
export const SUPPORTED = /\.(png|jpe?g|webp|bmp)$/i;
export function levelFromName(name) {
  const stem = name.replace(/\.[^.]+$/, '');
  const m = stem.match(/(?<![\d.])(0\.5|1\.0|1\.5|2\.0|2\.5)$/);
  return m ? Number(m[1]) : null;
}
export function caseKey(name) {
  const stem = name.replace(/\.[^.]+$/, '').replace(/(?<![\d.])(0\.5|1\.0|1\.5|2\.0|2\.5)$/, '');
  return stem.replace(/(^|[_\s-])(anterior|lateral|ap|lat|images_patch|patch|crop)(?=$|[_\s-])/gi, '_').replace(/^[_\s-]+|[_\s-]+$/g, '').replace(/[_\s-]+/g, '_').toLowerCase();
}
export function locatePath(path) {
  const pieces = path.replaceAll('\\', '/').split('/');
  const lower = pieces.map(p => p.toLowerCase());
  const i = lower.findIndex((p, n) => ['anterior', 'lateral'].includes(p) && ['images', 'images_patch'].includes(lower[n + 1]));
  if (i < 0 || pieces.length < i + 3 || !SUPPORTED.test(pieces.at(-1))) return null;
  const relative = pieces.slice(i + 2).join('/');
  return {view: lower[i] === 'anterior' ? 'ap' : 'lateral', kind: lower[i + 1] === 'images' ? 'image' : 'patch', key: caseKey(relative), level: levelFromName(pieces.at(-1))};
}
export function groupEntries(entries) {
  const grouped = new Map(), warnings = [];
  for (const entry of entries) {
    const info = locatePath(entry.path); if (!info || !info.key) continue;
    if (!grouped.has(info.key)) grouped.set(info.key, {key: info.key, views: {ap: {}, lateral: {}}, levels: new Set(), errors: []});
    const item = grouped.get(info.key), view = item.views[info.view];
    if (view[info.kind]) { item.errors.push('동일 사례의 중복 파일'); continue; }
    view[info.kind] = entry.url; if (info.kind === 'image') view.filename = entry.path.split('/').at(-1);
    if (info.level !== null) item.levels.add(info.level);
  }
  const cases = [...grouped.values()].sort((a,b) => a.key.localeCompare(b.key, 'en', {numeric:true})).map((item, i) => {
    const levels = [...item.levels];
    if (levels.length > 1) item.errors.push('AP/LAT/패치의 단계 값이 서로 다름');
    const complete = !!item.views.ap.image && !!item.views.lateral.image;
    if (!complete) item.errors.push('AP 또는 LAT 원본 누락');
    if (item.errors.length) warnings.push(item.key + ': ' + item.errors.join(', '));
    return {id:'CASE ' + String(i + 1).padStart(3,'0'), key:item.key, level:levels.length === 1 ? levels[0] : null, views:item.views, complete, errors:item.errors, source:'local'};
  });
  return {cases, warnings};
}
export function validROI(roi) { return Array.isArray(roi) && roi.length === 4 && roi.every(Number.isFinite) && roi[0] >= 0 && roi[1] >= 0 && roi[2] > 0 && roi[3] > 0 && roi[0] + roi[2] <= 1.001 && roi[1] + roi[3] <= 1.001; }
export const sampleCase = {id:'CASE 001',key:'virtual-example',level:1,complete:true,errors:[],source:'sample',views:{ap:{image:'assets/ap.svg',patch:'assets/valve.svg',roi:[.6827,.4775,.0673,.1422],roiSource:'sample'},lateral:{image:'assets/lateral.svg',patch:'assets/valve.svg',roi:[.7267,.5501,.0467,.1293],roiSource:'sample'}}};

// Patch matching is preparation for the demo, not model inference.
// Sparse normalized correlation estimates a patch location; ambiguous matches return null.
export async function estimateROI(original, patch) {
  if (!original || !patch) return null;
  await new Promise(resolve => setTimeout(resolve,0));
  const scale = Math.min(1, 320 / Math.max(original.naturalWidth, original.naturalHeight));
  const width = Math.max(1,Math.round(original.naturalWidth*scale)), height = Math.max(1,Math.round(original.naturalHeight*scale));
  const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true}); ctx.drawImage(original,0,0,width,height);
  const rgba=ctx.getImageData(0,0,width,height).data, gray=new Float32Array(width*height);
  for(let i=0;i<gray.length;i++) gray[i]=(rgba[i*4]+rgba[i*4+1]+rgba[i*4+2])/3;
  const side=12, n=side*side;
  const temp=document.createElement('canvas'); temp.width=side;temp.height=side;
  const tc=temp.getContext('2d',{willReadFrequently:true});tc.drawImage(patch,0,0,side,side);
  const td=tc.getImageData(0,0,side,side).data,t=new Float32Array(n);
  let mean=0;for(let i=0;i<n;i++){t[i]=(td[i*4]+td[i*4+1]+td[i*4+2])/3;mean+=t[i];}mean/=n;
  let varT=0;for(let i=0;i<n;i++){t[i]-=mean;varT+=t[i]*t[i];}if(varT/n<12)return null;
  let best={score:-1};
  const aspect=patch.naturalWidth/patch.naturalHeight;
  const base=patch.naturalWidth*scale;
  const candidates=[.25,.33,.5,.67,1,1.33,1.75,2.25].map(k=>Math.round(base*k));
  for(const pw of new Set(candidates)){
    const ph=Math.round(pw/aspect);if(pw<12||ph<12||pw>width*.85||ph>height*.85)continue;
    const offsets=[];for(let y=0;y<side;y++)for(let x=0;x<side;x++)offsets.push(Math.min(ph-1,Math.floor((y+.5)*ph/side))*width+Math.min(pw-1,Math.floor((x+.5)*pw/side)));
    const scoreAt=(x,y)=>{let sum=0,sq=0,dot=0;const start=y*width+x;for(let i=0;i<n;i++){const v=gray[start+offsets[i]];sum+=v;sq+=v*v;dot+=v*t[i];}const variance=sq-sum*sum/n;return variance>n*8?dot/Math.sqrt(variance*varT):-1;};
    let candidate={score:-1,x:0,y:0};
    for(let y=0;y<=height-ph;y+=4)for(let x=0;x<=width-pw;x+=4){const score=scoreAt(x,y);if(score>candidate.score)candidate={score,x,y};}
    const center={...candidate};for(let y=Math.max(0,center.y-3);y<=Math.min(height-ph,center.y+3);y++)for(let x=Math.max(0,center.x-3);x<=Math.min(width-pw,center.x+3);x++){const score=scoreAt(x,y);if(score>candidate.score)candidate={score,x,y};}
    if(candidate.score>best.score)best={...candidate,w:pw,h:ph};
  }
  if(best.score<.65)return null;
  return {roi:[(best.x+best.w*.25)/width,(best.y+best.h*.2)/height,best.w*.5/width,best.h*.6/height],score:best.score,source:'patch-match'};
}
