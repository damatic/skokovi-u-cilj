// Firebase mock (auth + Firestore u memoriji) za testove u pregledniku.
module.exports = String.raw`
(function(){
 const P=window.__P=Object.assign({user:'admin',failLoad:false,spectator:false},window.__PARAMS||{});
 const store=window.__store={docs:{'natjecanja/_meta':{currentEdition:'37.'},'natjecanja/37.':{config:{numJumps:9,eventName:'Alkarski Padobranski Kup',eventEdition:'37.'},teams:[{number:1,name:'AK Sinj',country:'HR',competitors:['A','B','C','D','E'].map(l=>({letter:l,ime:'Ime '+l,alkarski:true,spol:'M'}))}],results:{},rules:''}},calls:[]};
 const listeners={};
 const clone=o=>JSON.parse(JSON.stringify(o));
 class FieldPath{constructor(...p){this.p=p}}
 const DEL={__del:true};
 function snap(path){const d=store.docs[path];return{exists:d!==undefined,data:()=>clone(d),metadata:{hasPendingWrites:false,fromCache:false}}}
 window.__notify=(p)=>notify(p);
 function notify(path){(listeners[path]||[]).forEach(cb=>cb(snap(path)))}
 function setPath(obj,parts,val){let o=obj;for(let i=0;i<parts.length-1;i++){o[parts[i]]=o[parts[i]]||{};o=o[parts[i]]}const k=parts[parts.length-1];if(val&&val.__del)delete o[k];else o[k]=val}
 function docRef(path){return{
  get:async(opt)=>{if(P.failLoad)throw new Error('offline');if(path==='natjecanja/provjera'&&P.user==='other')throw {code:'permission-denied'};return snap(path)},
  set:async(v)=>{store.calls.push(['set',path]);store.docs[path]=clone(v);notify(path)},
  update:async(...a)=>{store.calls.push(['update',path,a.filter((x,i)=>i%2==0).map(x=>x instanceof FieldPath?x.p.join('.'):x)]);const d=store.docs[path];if(!d){const e=new Error('nf');e.code='not-found';throw e}
    for(let i=0;i<a.length;i+=2){const f=a[i],v=a[i+1];setPath(d,f instanceof FieldPath?f.p:[f],v)}notify(path)},
  onSnapshot:(opts,cb)=>{(listeners[path]=listeners[path]||[]).push(cb);setTimeout(()=>cb(snap(path)),0);return()=>{}}
 }}
 const fs=()=>({settings(){},enablePersistence:async()=>{},collection:()=>({doc:id=>docRef('natjecanja/'+id),get:async()=>({forEach:cb=>Object.keys(store.docs).filter(k=>k!=='natjecanja/_meta').forEach(k=>cb({id:k.split('/')[1],data:()=>clone(store.docs[k])}))})})});
 fs.FieldPath=FieldPath;fs.FieldValue={delete:()=>DEL};
 let cbA=null,user=P.user==='admin'?{email:'d.matic91@gmail.com'}:P.user==='other'?{email:'x@y.z'}:null;
 window.firebase={initializeApp(){},firestore:fs,auth:Object.assign(()=>({onAuthStateChanged:cb=>{cbA=cb;setTimeout(()=>cb(user),0)},signOut:async()=>{user=null;cbA(null)},signInWithPopup:async()=>{user={email:'d.matic91@gmail.com'};cbA(user)}}),{GoogleAuthProvider:function(){}})};
})();`;
