// Offline Canopy Swing check: simulated players with different reaction times on real seeded courses.
// Run after: sh scripts/build-tests.sh   →   node tests/swing-sim.cjs
const P=require('../.test-build/grapple-physics');const {mulberry32}=require('../.test-build/rng');
function run(seed, react, noise, r2){
  const rng=mulberry32(seed);const as=[P.FIRST_ANCHOR];const vines=[P.stageAt(0).vine];
  const ensure=(n)=>{while(as.length<n+3){const i=as.length;as.push(P.nextAnchor(as[i-1],i,rng));vines.push(P.stageAt(i).vine)}};
  ensure(5);
  let t=0;const b={f:3.6*Math.sin(-0.75),y:10.5-3.6*Math.cos(-0.75),vf:0,vy:0};let line={anchor:0,drop:0,L:3.6,t:0};
  let target=1,flying=null,reload=0,caught=0,pendingRel=-1,pendingFire=-1,perf=0;
  const h=1/240;
  for(let k=0;k<240*900;k++){
    const st=P.stageAt(target);const dt=h*st.speed;t+=dt;
    const pv=line?{f:P.anchorPos(as[line.anchor],t).f,y:P.anchorPos(as[line.anchor],t).y-line.drop}:null;
    P.step(b,line,pv,dt);
    if(line&&line.t>P.stageAt(line.anchor).hold){line=null}
    const T=P.anchorPos(as[target],t);
    // decisions (with reaction delay)
    if(line&&pendingRel<0&&P.releaseWorks(b,as[target],vines[target],st.range,t)) pendingRel=t+react+(r2()-0.5)*noise;
    if(line&&pendingRel>=0&&t>=pendingRel){line=null;pendingRel=-1}
    if(!line&&!flying&&reload<=0&&pendingFire<0){const hit=P.hookHit(b,T,vines[target],st.range);if(hit&&hit.drop>vines[target]*0.1&&hit.drop<vines[target]*0.9&&T.y-hit.drop-hit.d-0.6>1.4) pendingFire=t+react*0.5+(r2()-0.5)*noise;}
    if(!line&&pendingFire>=0&&t>=pendingFire){pendingFire=-1;if(!flying&&reload<=0)flying={f:b.f,y:b.y}}
    if(flying){const sl=P.HOOK_SPEED*dt;const nf=flying.f+P.AIM_DIR.f*sl,ny=flying.y+P.AIM_DIR.y*sl;
      if(nf>=T.f){const yAt=flying.y+((T.f-flying.f)/P.AIM_DIR.f)*P.AIM_DIR.y;const drop=T.y-yAt;flying=null;
        if(drop>=0.15&&drop<=vines[target]){if(P.isPerfect(drop,vines[target]))perf++;caught++;line={anchor:target,drop,L:Math.max(P.MIN_ROPE,Math.hypot(T.f-b.f,yAt-b.y)),t:0};target++;ensure(target+2)} else reload=P.RELOAD_S;}
      else if(Math.hypot(nf-b.f,ny-b.y)>st.range){flying=null;reload=P.RELOAD_S}else{flying.f=nf;flying.y=ny}}
    if(reload>0)reload-=dt;
    if(!line&&!flying&&b.f>as[target].f+0.6){target++;ensure(target+2)}
    if(b.y<P.WATER_Y+0.35)return {caught,perf,secs:Math.round(t)};
  }
  return {caught,perf,secs:Math.round(t),timeout:true};
}
for(const [react,noise] of [[0,0],[0.08,0.04],[0.15,0.1],[0.22,0.16]]){
  const res=[];for(let s=1;s<=8;s++){res.push(run(s*97,react,noise,mulberry32(s)))}
  console.log('react',react,'noise',noise,res.map(r=>`${r.caught}${r.timeout?'+':''}/${r.secs}s`).join(' '));
}
