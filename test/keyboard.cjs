'use strict';
// Pure input logic and app integration in a fake DOM/transport: never touches COM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FlightKeys = require('../ui/flight-keys.js');
const root = path.join(__dirname, '..');
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };

function harness() {
  let now=10000, nextTimer=1, focus=null, connected=true, mode='idle', armResolver=null, delayedArm=false;
  const timers=new Map(), requests=[], elements={};
  class Element {
    constructor(id, tag='DIV', type='') {
      Object.assign(this,{id,tagName:tag.toUpperCase(),type,value:'',checked:false,disabled:false,textContent:'',dataset:{},style:{},options:[],listeners:{}});
      const classes=new Set();
      this.classList={add:(x)=>classes.add(x),remove:(x)=>classes.delete(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)};
    }
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    dispatch(type,event={}){for(const fn of this.listeners[type]??[])fn({target:this,...event});}
    replaceChildren(){this.options=[];}
    append(option){this.options.push(option);if(!this.value)this.value=option.value;}
    focus(){focus=this;}
    setPointerCapture(){}
  }
  const html=fs.readFileSync(path.join(root,'ui/index.html'),'utf8');
  for(const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const el=elements[match[3]]=new Element(match[3],match[1],match[2].match(/type="([^"]+)"/)?.[1]||'');
    el.value=match[2].match(/value="([^"]+)"/)?.[1]||'';
    el.disabled=/\bdisabled\b/.test(match[2]);
  }
  elements.channel.value='1';
  const badges=[...html.matchAll(/data-key="([^"]+)"/g)].map(m=>{const e=new Element('');e.dataset.key=m[1];return e;});
  const win=new Element('window'), doc=new Element('document');
  doc.hidden=false;doc.getElementById=id=>{assert.ok(elements[id],id);return elements[id];};
  doc.querySelectorAll=()=>badges;doc.createElement=tag=>new Element('',tag);
  function schedule(fn,ms,interval=false){const id=nextTimer++;timers.set(id,{fn,at:now+ms,ms,interval});return id;}
  const context=vm.createContext({document:doc,window:win,FlightKeys,console,crypto:{randomUUID:()=> 'test-client-id'},
    performance:{now:()=>now},Date:class extends Date {static now(){return now;}},
    AbortSignal:{timeout:()=>({})},setTimeout:(f,m)=>schedule(f,m),setInterval:(f,m)=>schedule(f,m,true),
    fetch:async (url,options)=>{
      if(url==='/api/config')return {ok:true,json:async()=>({token:'fake',ports:[{port:'COM_FAKE',usb:true,name:'fake'}]})};
      if(url==='/api/state')return {ok:true,json:async()=>({connected,port:'COM_FAKE',device:{mode,throttle:0,reason:'boot'},events:[]})};
      const data=JSON.parse(options.body);requests.push({name:url.slice(5),data});
      if(url==='/api/arm'){
        if(delayedArm)await new Promise(resolve=>{armResolver=resolve;});
        mode='armed';return {ok:true,json:async()=>({session:7})};
      }
      if(url==='/api/stop')mode='idle';
      if(url==='/api/control')mode='control';
      return {ok:true,json:async()=>({ok:true})};
    }});
  vm.runInContext(fs.readFileSync(path.join(root,'ui/app.js'),'utf8'),context);
  return {elements,requests,
    async ready(){await flush();elements.controlsEnabled.checked=true;elements.controlsEnabled.dispatch('change');},
    key(type,code,repeat=false){win.dispatch(type,{code,repeat,target:focus||elements.hold,preventDefault(){}});},
    async advance(ms){
      await flush();const end=now+ms;
      while(true){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;
        const [id,t]=entry;now=t.at;if(t.interval)t.at+=t.ms;else timers.delete(id);t.fn();await flush();}
      now=end;await flush();
    },
    blur(){win.dispatch('blur');}, hide(){doc.hidden=true;doc.dispatch('visibilitychange');},
    disconnect(){connected=false;}, delayArm(){delayedArm=true;}, finishArm(){armResolver();},
    controls(){return requests.filter(r=>r.name==='control');}
  };
}

(async()=>{
  const logic=new FlightKeys();
  logic.press('ArrowLeft');assert.equal(logic.sample(0,{strength:64}).yaw,127);
  logic.release('ArrowLeft');assert.equal(logic.sample(0).yaw,63);
  logic.press('ArrowRight');assert.equal(logic.sample(0,{strength:64,invertYaw:true}).yaw,127);
  logic.reset();logic.press('KeyW');logic.press('KeyS');assert.equal(logic.sample(50).throttle,50);

  const h=harness();await h.ready();
  h.key('keydown','KeyW');await h.advance(400);assert.equal(h.controls().length,0);
  h.elements.throttle.value='127';h.key('keydown','Space');await h.advance(1);
  assert.ok(h.controls().length,JSON.stringify({requests:h.requests,message:h.elements.message.textContent,enabled:h.elements.controlsEnabled.checked,holdDisabled:h.elements.hold.disabled}));
  assert.equal(h.controls()[0].data.throttle,0); // previous slider value never launches at full power
  h.key('keydown','KeyW');await h.advance(6600);assert.equal(Number(h.elements.throttle.value),127);
  assert.equal(h.controls().at(-1).data.throttle,127);
  h.key('keyup','KeyW');await h.advance(500);assert.equal(Number(h.elements.throttle.value),127);
  h.key('keydown','ArrowLeft');h.key('keydown','ArrowUp');await h.advance(150);
  assert.equal(h.controls().at(-1).data.yaw,95);assert.equal(h.controls().at(-1).data.pitch,31);
  h.key('keyup','ArrowLeft');h.key('keyup','ArrowUp');await h.advance(150);
  assert.equal(h.controls().at(-1).data.yaw,63);assert.equal(h.controls().at(-1).data.pitch,63);
  await h.advance(4000);assert.equal(h.controls().at(-1).data.throttle,127); // no old 10-second cutoff
  h.key('keydown','KeyS');await h.advance(6600);assert.equal(Number(h.elements.throttle.value),0);
  h.key('keyup','KeyS');h.key('keyup','Space');await flush();
  const count=h.controls().length;await h.advance(500);assert.equal(h.controls().length,count);
  assert.equal(h.requests.at(-1).name,'stop');
  h.key('keydown','Space',true);await h.advance(200);assert.equal(h.controls().length,count);

  for(const leave of ['blur','hide','disconnect']){
    const t=harness();await t.ready();t.key('keydown','Space');await t.advance(1);
    t.key('keydown','KeyW');t.key('keydown','ArrowRight');await t.advance(300);
    t[leave]();await t.advance(300);assert.equal(Number(t.elements.throttle.value),0);assert.equal(Number(t.elements.yaw.value),63);
    assert.equal(t.requests.at(-1).name,'stop');const n=t.controls().length;await t.advance(700);assert.equal(t.controls().length,n);
  }
  const esc=harness();await esc.ready();esc.key('keydown','Space');await esc.advance(300);
  esc.key('keydown','Escape');await esc.advance(500);assert.equal(esc.requests.at(-1).name,'stop');
  const slow=harness();await slow.ready();slow.delayArm();slow.key('keydown','Space');await flush();
  slow.key('keyup','Space');await flush();slow.finishArm();await slow.advance(500);assert.equal(slow.controls().length,0);
  assert.ok(h.controls().every(r=>r.data.throttle>=0&&r.data.throttle<=127));
  console.log('PASS: keyboard full range, zero start, throttle hold, axis release/inversion, >10s control, Space/Esc/blur/hidden/disconnect STOP, delayed ARM cancellation. No hardware used.');
})().catch(error=>{console.error(error);process.exitCode=1;});
