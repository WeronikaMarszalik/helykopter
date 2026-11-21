#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdlib.h>

namespace s107 {
constexpr uint32_t kWatchdogMs = 500;
constexpr uint32_t kPeriodMs = 183;
constexpr unsigned kMaxThrottle = 127;  // Full seven-bit throttle field.
constexpr uint16_t kReference[67] = {
  2126,1912,384,204,404,242,366,632,386,632,384,634,384,634,384,632,
  384,638,380,202,402,206,402,636,382,638,380,634,382,636,382,638,
  380,634,416,588,384,226,398,196,410,198,404,206,402,206,402,204,
  402,228,396,202,404,634,384,204,402,634,382,206,404,204,404,202,
  404,634,382
}; // logs/device-monitor-261029-114318.log, #263, line 46. 3F 3F 80 51.

struct Controls {
  uint8_t throttle = 0, yaw = 63, pitch = 63, trim = 81, channel = 1;
  uint32_t word() const {
    return (uint32_t(yaw) << 24) | (uint32_t(pitch) << 16) |
           (uint32_t(throttle | (channel << 7)) << 8) | trim;
  }
};

inline void encode(uint32_t word, uint16_t out[67]) {
  // Initial timing assumptions from clean demodulated captures, not calibration.
  out[0] = 2096; out[1] = 1968;
  for (unsigned i = 0; i < 32; ++i) {
    out[2 + 2*i] = 354;
    out[3 + 2*i] = (word & (uint32_t(1) << (31-i))) ? 662 : 248;
  }
  out[66] = 354;
}

inline bool decode(const uint16_t* raw, size_t n, bool overflow, uint32_t& word) {
  if (overflow || n != 67 || raw[0] < 1700 || raw[0] > 2500 ||
      raw[1] < 1600 || raw[1] > 2400) return false;
  word = 0;
  for (unsigned i = 0; i < 32; ++i) {
    const auto mark = raw[2 + i*2], space = raw[3 + i*2];
    if (mark < 180 || mark > 550) return false;
    if (!((space >= 120 && space <= 400) || (space >= 500 && space <= 850)))
      return false;
    word = (word << 1) | (space > 450);
  }
  return raw[66] >= 180 && raw[66] <= 550;
}

enum class Mode { Idle, Armed, Control, Bench, Stopping };
class Controller {
 public:
  Mode mode = Mode::Idle;
  Controls values;
  uint32_t token = 0, sequence = 0;
  const char* reason = "boot";
  const char* name() const {
    switch (mode) {
      case Mode::Armed: return "armed";
      case Mode::Control: return "control";
      case Mode::Bench: return "bench";
      case Mode::Stopping: return "stopping";
      default: return "idle";
    }
  }
  void stop(uint32_t now, const char* why) {
    reason = why; token = 0; sequence = 0; values.throttle = 0;
    if (mode == Mode::Control) {
      mode = Mode::Stopping; remaining = 3; nextAt = now;
    } else if (mode != Mode::Stopping) {
      mode = Mode::Idle; remaining = 0;
    }
  }
  void tick(uint32_t now) {
    if ((mode == Mode::Armed && uint32_t(now-lastCommand) >= 1000) ||
        (mode == Mode::Control && uint32_t(now-lastCommand) >= kWatchdogMs))
      stop(now, "watchdog");
    if (mode == Mode::Bench && uint32_t(now-startedAt) >= 2000)
      stop(now, "bench_complete");
  }
  bool command(const char* line, uint32_t now) {
    tick(now); // Expired sessions cannot be revived by a late SET.
    char input[128];
    if (strlen(line) >= sizeof(input)) return fail(now, "line_too_long");
    strcpy(input, line);
    char* args[10]; unsigned count = 0; char* ctx = nullptr;
    for (char* p = strtok_r(input, " ", &ctx); p; p = strtok_r(nullptr," ",&ctx)) {
      if (count == 10) return fail(now, "bad_command");
      args[count++] = p;
    }
    if (!count) return fail(now, "bad_command");
    if (count == 1 && !strcmp(args[0],"STATUS")) return true;
    if (count == 1 && !strcmp(args[0],"STOP")) { stop(now,"stop"); return true; }
    if (count == 1 && !strcmp(args[0],"TEST")) {
      if (mode != Mode::Idle) return fail(now,"busy");
      mode = Mode::Bench; values = Controls{}; startedAt = nextAt = now;
      reason = "bench"; return true;
    }
    uint32_t n[8] = {};
    for (unsigned i = 1; i < count; ++i) {
      if (!*args[i]) return fail(now,"bad_number");
      uint64_t value = 0;
      for (const char* p = args[i]; *p; ++p) {
        if (*p < '0' || *p > '9') return fail(now,"bad_number");
        value = value * 10 + (*p-'0');
        if (value > 2147483647) return fail(now,"bad_number");
      }
      if (i > 8) return fail(now,"bad_command");
      n[i-1] = uint32_t(value);
    }
    if (count == 2 && !strcmp(args[0],"ARM")) {
      if (mode != Mode::Idle || !n[0]) return fail(now,"arm_rejected");
      mode = Mode::Armed; values = Controls{}; token = n[0]; sequence = 0;
      lastCommand = now; reason = "armed"; return true;
    }
    if (count == 8 && !strcmp(args[0],"SET")) {
      if ((mode != Mode::Armed && mode != Mode::Control) || !token || n[0] != token ||
          n[1] <= sequence) return fail(now,"session_rejected");
      if (n[2] > kMaxThrottle || n[3] > 127 || n[4] > 127 || n[5] > 127 || n[6] > 1)
        return fail(now,"out_of_range");
      if (mode == Mode::Control && n[6] != values.channel)
        return fail(now,"channel_change");
      if (mode == Mode::Armed) { startedAt = nextAt = now; mode = Mode::Control; }
      sequence = n[1]; lastCommand = now;
      values.throttle=n[2]; values.yaw=n[3]; values.pitch=n[4]; values.trim=n[5];
      values.channel=n[6]; reason="control"; return true;
    }
    return fail(now,"bad_command");
  }
  bool frame(uint32_t now, uint16_t out[67]) {
    tick(now);
    if (mode != Mode::Control && mode != Mode::Bench && mode != Mode::Stopping)
      return false;
    if (int32_t(now-nextAt) < 0) return false;
    nextAt = now + kPeriodMs; // Start-to-start; no backlog of late frames.
    if (mode == Mode::Bench) memcpy(out, kReference, sizeof(kReference));
    else encode(values.word(), out);
    if (mode == Mode::Stopping && --remaining == 0) mode = Mode::Idle;
    return true;
  }
 private:
  uint32_t lastCommand = 0, startedAt = 0, nextAt = 0;
  unsigned remaining = 0;
  bool fail(uint32_t now, const char* why) { stop(now,why); return false; }
};
} // namespace s107
