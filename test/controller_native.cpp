#include "../lib/S107Controller/S107Controller.h"
#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
using namespace s107;

int main() {
  uint16_t raw[67]; uint32_t word;
  assert(decode(kReference,67,false,word) && word==0x3F3F8051);
  assert(!decode(kReference,65,false,word));
  assert(!decode(kReference,67,true,word));
  for (uint32_t w : {0u,0xFFFFFFFFu,0x3F3F8051u,0x0F002800u}) {
    encode(w,raw); assert(decode(raw,67,false,word) && word==w);
  }
  raw[3]=450; assert(!decode(raw,67,false,word));
  Controller c;
  assert(!c.frame(0,raw));
  assert(c.command("STOP",0)); assert(!c.frame(0,raw));
  assert(!c.command("SET 1 1 10 63 63 81 1",0));
  assert(!c.frame(0,raw));
  assert(c.command("ARM 123",1)); assert(!c.frame(1,raw));
  assert(c.command("SET 123 1 10 15 0 81 0",2));
  assert(c.frame(2,raw)); assert(decode(raw,67,false,word)&&word==0x0F000A51);
  assert(!c.frame(184,raw));
  assert(c.frame(185,raw)); // start-to-start cadence
  c.tick(501); assert(c.mode==Mode::Control);
  c.tick(502); assert(c.mode==Mode::Stopping && c.values.throttle==0);
  assert(!c.command("SET 123 2 20 63 63 81 0",503)); // late lease cannot revive
  unsigned stopFrames=0;
  for(unsigned t=503;t<1100;++t) if(c.frame(t,raw)) {
    ++stopFrames; assert(decode(raw,67,false,word)); assert(((word>>8)&0xFF)==0);
  }
  assert(stopFrames==3 && c.mode==Mode::Idle);
  assert(c.command("ARM 456",2000));
  assert(c.command("SET 456 1 20 63 63 81 1",2001));
  assert(!c.command("SET 456 1 20 63 63 81 1",2002)); // duplicate stops
  assert(c.values.throttle==0 && c.mode==Mode::Stopping);
  Controller bench; assert(bench.command("TEST",0));
  unsigned sent=0;
  for(unsigned t=0;t<=2100;++t) if(bench.frame(t,raw)) {
    ++sent; assert(!memcmp(raw,kReference,sizeof(raw)));
  }
  assert(sent==11 && bench.mode==Mode::Idle);
  Controller continuous; assert(continuous.command("ARM 1",0));
  for(unsigned t=1;t<60001;t+=100) {
    std::string cmd="SET 1 "+std::to_string(t)+" 127 63 63 81 1";
    assert(continuous.command(cmd.c_str(),t));
    if (continuous.frame(t,raw)) {
      assert(decode(raw,67,false,word) && ((word>>8)&0xFF)==0xFF);
    }
  }
  continuous.tick(60001);assert(continuous.mode==Mode::Control);
  continuous.tick(60401);assert(continuous.mode==Mode::Stopping && continuous.values.throttle==0);
  for(const auto bad : {"SET 1 2 128 63 63 81 1", "SET 1 2 -1 63 63 81 1",
      "SET 1 2 1 128 63 81 1", "SET 1 2 1 63 63 81 2", "SET 1 2 1 63 63 81 1 extra",
      "SET 1 2 999999999999999999999999 0 0 0 0", "STOP 0", "SET 2 2 10 63 63 81 1"}) {
    Controller invalid;assert(invalid.command("ARM 1",0));
    assert(invalid.command("SET 1 1 10 63 63 81 1",1));
    assert(!invalid.command(bad,2));assert(invalid.values.throttle==0);
  }
  Controller wrap;assert(wrap.command("ARM 1",0xFFFFFF00));
  assert(wrap.command("SET 1 1 10 63 63 81 1",0xFFFFFF01));
  wrap.tick(0x000000F5);assert(wrap.mode==Mode::Stopping);
  Controller arm;assert(arm.command("ARM 1",0));
  arm.tick(1000);assert(arm.mode==Mode::Idle&&!arm.frame(1000,raw));
  Controller channel;assert(channel.command("ARM 1",0));
  assert(channel.command("SET 1 1 10 63 63 81 1",1));
  assert(!channel.command("SET 1 2 10 63 63 81 0",2));
  assert(channel.values.channel==1&&channel.values.throttle==0);
  puts("PASS: reference, encoding, malformed frames, boot, arming, watchdog, stale/duplicate commands, STOP, continuous full throttle, bounds, wraparound, channel lock.");
}
