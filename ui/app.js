'use strict';
const $ = id => document.getElementById(id);
const keys = new FlightKeys();
const owner = crypto.randomUUID();
let csrf='', latest=null, held=false, starting=false, session=0, sequence=0, epoch=0;
let holdStarted=0, polling=false, benchPendingUntil=0, testInProgress=false, stopPending=0, inputSource='';
const modes={idle:'Gotowy · gaz 0',armed:'Uruchamianie sterowania',control:'Nadawanie',bench:'Test diod IR',stopping:'Wysyłanie gazu 0'};
const reasons={boot:'ESP32 gotowe. Nadajnik jest wyłączony.',stop:'STOP: gaz wyzerowany.',watchdog:'Przerwa w komendach — ESP32 uruchomiło STOP.',bench_complete:'Zakończono test IR.',control:'Nadawanie podczas przytrzymania Spacji lub przycisku.',bench:'Test nadajnika z gazem 0.',armed:'Oczekiwanie na komendy.'};
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
async function api(name,data={}){
  const res=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Control-Token':csrf},body:JSON.stringify(data),signal:AbortSignal.timeout(2500)});
  const result=await res.json();if(!res.ok)throw Error(result.error||'Błąd połączenia.');return result;
}
function updateEnabled(){
  const connected=latest?.connected, mode=latest?.device?.mode;
  const idle=connected&&mode==='idle'&&!held&&!starting&&!stopPending&&Date.now()>benchPendingUntil;
  $('test').disabled=!(idle&&$('heliOff').checked);
  $('hold').disabled=!held&&!starting&&!(idle&&$('controlsEnabled').checked);
  $('connect').disabled=!!connected||starting||held||!!stopPending;
  $('disconnect').disabled=!connected;
  for(const id of ['channel','invertYaw','invertPitch','strength'])$(id).disabled=held||starting||mode==='stopping';
  $('controlsEnabled').disabled=!connected||mode==='bench';
  $('keyboardState').textContent=held?'Sterowanie aktywne':$('controlsEnabled').checked?'Przytrzymaj Spację, aby rozpocząć':'Zaznacz „Włącz sterowanie”, aby używać klawiszy';
}
function setValue(id,value){$(id).value=value;updateValue(id);}
function updateValue(id){$(id+'Value').textContent=$(id).value+(id==='throttle'?' / 127 · '+Math.round(Number($(id).value)*100/127)+'%':'');}
function centerControls(){keys.reset();setValue('throttle',0);setValue('yaw',63);setValue('pitch',63);showKeys();}
function showKeys(){for(const el of document.querySelectorAll('[data-key]'))el.classList.toggle('pressed',el.dataset.key==='Space'?held&&inputSource==='keyboard':keys.keys.has(el.dataset.key));}
function applyKeys(ramp=true){
  if(!held||starting)return;
  const values=keys.sample(Number($('throttle').value),{ramp,strength:Number($('strength').value),invertYaw:$('invertYaw').checked,invertPitch:$('invertPitch').checked});
  for(const [id,value] of Object.entries(values))setValue(id,value);
  showKeys();
}
async function stop(show=true){
  ++epoch;held=false;starting=false;session=0;inputSource='';benchPendingUntil=0;testInProgress=false;++stopPending;
  centerControls();$('hold').classList.remove('active');$('hold').textContent='Przytrzymaj Spację lub ten przycisk';
  $('holdTime').textContent='0,0 s';updateEnabled();
  try{await api('stop');if(show)message('STOP wysłany. Gaz 0.');}
  catch(e){message('Brak potwierdzenia STOP przez USB. ESP32 ma timeout 0,5 s; sprawdź helikopter.',true);}
  finally{--stopPending;updateEnabled();}
}
async function begin(source){
  if(held||starting||stopPending||$('hold').disabled||!$('controlsEnabled').checked)return;
  centerControls();held=true;starting=true;inputSource=source;const thisEpoch=++epoch;holdStarted=performance.now();
  $('hold').classList.add('active');$('hold').textContent='Nadaję · puść, aby zatrzymać';showKeys();updateEnabled();
  try{
    const answer=await api('arm',{owner,controls_enabled:$('controlsEnabled').checked});
    // Abandoned ARM emits nothing and expires; do not stop a newer session.
    if(!held||thisEpoch!==epoch)return;
    session=answer.session;sequence=0;starting=false;applyKeys(false);
    message('Sterowanie aktywne: W/S — gaz, strzałki — kierunek. Puść Spację lub naciśnij Esc, aby zatrzymać.');
    while(held&&thisEpoch===epoch){
      const start=performance.now();
      const values=Object.fromEntries(['throttle','yaw','pitch','trim','channel'].map(k=>[k,Number($(k).value)]));
      await api('control',{owner,session,sequence:++sequence,...values});
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,120-(performance.now()-start))));
    }
  }catch(e){if(thisEpoch===epoch){await stop(false);message(e.message,true);}}
  finally{if(thisEpoch===epoch)starting=false;}
}
async function refreshPorts(){const res=await fetch('/api/config');if(!res.ok)throw Error('Panel nie odpowiada.');const data=await res.json();csrf=data.token;const old=$('port').value;$('port').replaceChildren();for(const p of data.ports.filter(p=>p.usb)){const option=document.createElement('option');option.value=p.port;option.textContent=p.port+' · '+p.name;$('port').append(option);}if(old&&[...$('port').options].some(p=>p.value===old))$('port').value=old;}
async function poll(){
  if(polling)return;polling=true;
  try{
    const res=await fetch('/api/state',{signal:AbortSignal.timeout(1000)});if(!res.ok)throw Error('Błąd panelu.');latest=await res.json();const d=latest.device;
    $('connection').textContent=latest.connected?'● '+latest.port+' · połączono':'Rozłączony';$('connection').classList.toggle('online',latest.connected);
    $('mode').textContent=latest.connected?(modes[d.mode]||d.mode):'Brak połączenia';
    $('actualThrottle').textContent=latest.connected?(d.throttle??0):'—';
    const receiver=$('receiverEnabled').checked;
    $('tx').textContent=d.tx??0;
    for(const id of ['rx','clean'])$(id).textContent=receiver?(d[id]??0):'—';
    $('best').textContent=receiver?(d.best??0)+' / 10':'nie mierzono';$('progressFill').style.width=receiver?Math.min(100,(d.best??0)*10)+'%':'0%';
    $('testResult').textContent=!receiver?(d.reason==='bench_complete'?'Nadawanie wzorca zakończone. Odbiór nie jest mierzony.':'Bez odbiornika panel nie potwierdza emisji optycznej ani odbioru przez helikopter.'):d.best>=10?'✓ Odbiornik rozpoznał co najmniej 10 kolejnych ramek wzorcowych.':d.reason==='bench_complete'?'Brak pełnej serii wzorcowej. Sprawdź odbiornik: VCC → 3V3, GND → GND, IN → GPIO14.':'Cel diagnostyczny: 10 kolejnych ramek wzorcowych.';
    $('reason').textContent=reasons[d.reason]||d.reason||'Brak automatycznego nadawania po podłączeniu USB.';
    $('rxDiagnostic').textContent=!receiver?'Odbiornik VS1838B jest opcjonalny.':d.rx_edges!==undefined?'GPIO14: '+(d.rx_level?'HIGH':'LOW')+' · zbocza: '+d.rx_edges:'Oczekiwanie na odbiornik.';
    const rx=[...latest.events].reverse().find(e=>e.event==='rx');$('lastFrame').textContent=!receiver?'Nie mierzono':rx?(rx.valid?rx.word.match(/../g).join(' '):'Niepełna / szum'):'— — — —';
    $('log').textContent=latest.events.filter(e=>e.event==='command'||e.event==='rx'||e.event==='ready').slice(-12).reverse().map(e=>new Date(e.time).toLocaleTimeString('pl-PL')+'  '+(e.line||(e.event==='rx'?(e.valid?'RX '+e.word:'RX niepoprawna')+' · '+e.count+' impulsów':'ESP32 gotowe'))).join('\n')||'Oczekiwanie na pierwszą komendę…';
    if(!latest.connected){$('controlsEnabled').checked=false;if(held||starting){await stop(false);message('Utracono połączenie. Sterowanie zatrzymane.',true);}}
    if(held&&!starting&&(d.mode==='stopping'||(d.mode==='idle'&&performance.now()-holdStarted>600))){await stop(false);message('ESP32 zakończyło sterowanie.');}
    if(d.mode==='bench')benchPendingUntil=0;
    if(testInProgress&&d.mode==='idle'&&d.reason==='bench_complete'&&Date.now()>benchPendingUntil){testInProgress=false;message(receiver?(d.best>=10?'Odbiór wzorca potwierdzony.':'Test zakończony bez potwierdzenia odbioru.'):'Zakończono nadawanie wzorca z gazem 0.');}
    if(held)$('holdTime').textContent=((performance.now()-holdStarted)/1000).toFixed(1).replace('.',',')+' s';
    updateEnabled();
  }catch(e){$('controlsEnabled').checked=false;if(held||starting)await stop(false);$('connection').textContent='Brak połączenia';latest=null;updateEnabled();message('Panel nie odpowiada. Sprawdź serwer.',true);}
  finally{polling=false;}
}
for(const id of ['throttle','yaw','pitch','trim','strength'])$(id).addEventListener('input',()=>updateValue(id));
for(const id of ['heliOff','controlsEnabled'])$(id).addEventListener('change',()=>{if((held||starting)&&!$('controlsEnabled').checked)stop();updateEnabled();if(id==='controlsEnabled'&&$('controlsEnabled').checked)$('hold').focus({preventScroll:true});});
$('stop').addEventListener('click',()=>stop());$('neutral').addEventListener('click',()=>stop());
$('refresh').addEventListener('click',()=>refreshPorts().catch(e=>message(e.message,true)));
$('connect').addEventListener('click',async()=>{try{message('Łączę z ESP32…');await api('connect',{port:$('port').value});message('Połączono. Zaznacz „Włącz sterowanie”, potem przytrzymaj Spację.');await poll();}catch(e){message(e.message,true);}});
$('disconnect').addEventListener('click',async()=>{$('controlsEnabled').checked=false;await stop(false);try{await api('disconnect');message('Rozłączono ESP32.');await poll();}catch(e){message(e.message,true);}});
$('test').addEventListener('click',async()=>{benchPendingUntil=Date.now()+3000;testInProgress=true;updateEnabled();try{await api('test',{helicopter_off:$('heliOff').checked});message('Test IR: gaz 0 przez 2 sekundy.');}catch(e){benchPendingUntil=0;testInProgress=false;message(e.message,true);}updateEnabled();});
$('hold').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();if(!$('hold').disabled&&!held&&!starting){$('hold').setPointerCapture(e.pointerId);begin('pointer');}});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('hold').addEventListener(event,()=>{if(inputSource==='pointer'&&(held||starting))stop();});
function isEditing(target){return !!target&&(target.isContentEditable||target.tagName==='TEXTAREA'||target.tagName==='SELECT'||(target.tagName==='INPUT'&&target.type!=='range'));}
window.addEventListener('keydown',e=>{
  if(e.code==='Escape'){e.preventDefault();if(!e.repeat)stop();return;}
  if(e.ctrlKey||e.altKey||e.metaKey||isEditing(e.target))return;
  if(e.code==='Space'){
    if(e.target?.tagName==='BUTTON'&&e.target.id!=='hold')return;
    if($('controlsEnabled').checked){e.preventDefault();if(!e.repeat)begin('keyboard');}
    return;
  }
  if((held||starting)&&keys.accepts(e.code)){e.preventDefault();if(!e.repeat){keys.press(e.code);applyKeys(false);showKeys();}}
});
window.addEventListener('keyup',e=>{
  if(e.code==='Space'&&inputSource==='keyboard'){e.preventDefault();stop();}
  if(keys.release(e.code)){e.preventDefault();applyKeys(false);showKeys();}
});
function leavePage(){keys.reset();showKeys();if(held||starting||testInProgress||latest?.device?.mode==='bench')stop(false);}
window.addEventListener('blur',leavePage);
document.addEventListener('visibilitychange',()=>{if(document.hidden)leavePage();});
window.addEventListener('pagehide',()=>{keys.reset();fetch('/api/stop',{method:'POST',headers:{'Content-Type':'application/json','X-Control-Token':csrf},body:'{}',keepalive:true}).catch(()=>{});});
$('download').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(latest,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='parakopter-test.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
setInterval(()=>applyKeys(true),100);
(async()=>{try{await refreshPorts();await poll();message(latest?.connected?'Połączono. Zaznacz „Włącz sterowanie”, potem przytrzymaj Spację.':'Wybierz port USB ESP32 i kliknij Połącz.');}catch(e){message(e.message,true);}setInterval(poll,250);})();
