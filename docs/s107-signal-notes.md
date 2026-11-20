# S107 remote signal notes

Status: bench measurements from 2026-10-29. The receiver was connected to
GPIO 14. These are demodulated IR durations, not a measurement of the optical
carrier. Control positions were reported separately; every saved frame is
still labelled `unlabeled`, so direction and switch-position names need a
labelled repeat.

## Capture quality and decoding

A complete candidate frame has a header, 32 mark/space pairs and a stop mark:
67 raw durations. Here, "complete" means plausible timings and no data mark
requiring merged-pulse repair; it does not prove that the helicopter accepts
the frame.

| Log suffix | Distinct parsed frames | Complete 67-duration frames | Decoded using merged-pulse repair |
|------------|------------------------|-----------------------------|----------------------------------|
| `114318` | 127 | 94 | Not used for this audit |
| `114952` | 99 | 93 | Not used for this audit |
| `120220` | 81 | 6 | 75 |
| `120804` | 52 | 5 | 41; another 6 did not decode |

`120220` contains 104,348 text lines, mostly duplicated fragments, but only
81 distinct parsed frames. The recent captures have substantially more merged
pulses than the earlier captures.

`tools/decode_s107.py` removes repeated frame records and reconstructs missing
zero bits from long marks. That reconstruction is a heuristic, not a direct
measurement. The script does not fully validate pulse widths or reject the
`OVERFLOW` flag. Use complete, unrepaired frames for the first raw replay.

## Frame shape

Typical medians in the complete frames from `114318` and `114952`, in us:

| Element | Receiver output duration |
|---------|--------------------------|
| Header mark | 2094-2096 |
| Header space | 1966-1970 |
| Data mark | 352-354 |
| Space interpreted as 0 | 246-248 |
| Space interpreted as 1 | 660-664 |

The complete frames support a 32-bit, MSB-first interpretation. A space
threshold of 450 us separates the observed zero and one clusters in those
earlier complete frames. Receiver delays can change the measured mark/space
widths relative to the original optical signal.

PC log arrival intervals are usually about 183 ms. This is an approximate
observation, not a directly measured transmission period or inter-frame gap:
the logger omits `rawbuf[0]` and stores no ESP32 capture timestamp. The carrier
frequency and duty cycle remain unmeasured; 38 kHz is a starting assumption
for a bench test, not a result established by these logs.

## Bytes (A B C D)

The earlier throttle sweep is `114318`. The stick test is `114952`, with the
reported order centre, right, left, up, down, centre at roughly full throttle.

| Byte | Values observed | Interpretation and limits |
|------|-----------------|---------------------------|
| A | 15-122 in the stick test | Yaw candidate. Reported right gave 15, left 122; neutral was often 68 at high throttle and 63 at zero throttle. Direction names depend on the unlabelled test order. |
| B | 0-121 in the stick test | Pitch candidate. Reported stick up gave 0, down 121, centre 63. Physical forward/backward response is unverified. |
| C | 0x00-0xFF across tests | Bit 7 is the channel candidate; bits 0-6 are throttle. The earlier position called A used bit 7 = 1. Roughly full throttle often gave 0xFA/0xFB, meaning 122/123 in the lower 7 bits. |
| D | 0-127 in the trim test | Trim candidate supported by the reported knob sequence and repaired frames; complete recent frames directly establish the right-knob state D = 0. |

Other observations: C sometimes varies by one while held, and reached 0xFF
during a pitch-stick test. A also changed between sessions and trim settings.
These observations do not establish ADC coupling, a throttle-dependent yaw
neutral, or a universal trim-mixing formula. Do not encode such a calibration
rule yet.

## Channel switch (`120220`)

Complete frames at log lines 104202 and 104302 decode to `41 3F 7B 47` and
`41 3F FB 47`: only C bit 7 differs. This strongly supports the channel-bit
interpretation without relying on repaired pulses.

Repaired and complete records together show one segment with C bit 7 = 0
around 12:02:29-35 and another with bit 7 = 1 around 12:02:40-45. There are
about 4.9 seconds without captured frames between them. The switch-movement
order was not recorded in the log. That gap does not prove a silent centre
position, and the physical A/B mapping needs a labelled repeat.

## Trim knob (`120804`)

Reported order: left, centre, right; roughly full throttle and centred sticks.

| Reported knob position | D | A at high throttle | A at zero throttle | Evidence quality |
|------------------------|---|--------------------|--------------------|------------------|
| Left | 0x7F (127) | 0x52 (82) | 0x3F (63) | Repaired frames |
| Centre | 0x49 (73) | 0x41 (65) | 0x3F (63) | Repaired frames |
| Right | 0x00 (0) | 0x2D (45) | 0x3F (63) | Five complete high-throttle frames, e.g. line 76; zero-throttle frame repaired |

The values suggest that moving trim changes D and also correlates with A when
throttle is raised. They do not yet prove how the remote combines these
controls or whether the helicopter uses A, D, or both. A mechanical midpoint
reading of 73 does not establish the electrical neutral value.

## First raw replay reference: zero throttle

Use the complete, unrepaired record in
[`device-monitor-261029-114318.log`, line 46](../logs/device-monitor-261029-114318.log#L46):
counter `#263`, PC timestamp `11:43:25.729`, 67 raw durations. It decodes to
`3F 3F 80 51`, so the proposed throttle field is `0x80 & 0x7F = 0`.
Another complete occurrence is in `114952`, line 190.

This is the reference for an emitter-to-receiver bench test with the
helicopter switched off. Copy its original raw durations rather than replaying
a reconstructed zero-throttle record from the recent logs. First confirm the
emitted packet with the receiver; helicopter response and powered-motor
behaviour are separate, later checks.

## Next measurements

Keep the helicopter switched off during pilot capture. Before each change,
send a label over serial and check the `# label = ...` acknowledgement. Hold
one state for at least 10-20 frames and return to the same baseline between
changes.

1. Improve reception until repeated complete frames are available at a fixed
   pilot/receiver position; record distance and lighting conditions.
2. Capture `A_baseline`, `B_baseline`, `A_baseline_repeat` with identical
   throttle, sticks and trim. Record the actual switch position for each.
3. Capture `trim_L`, `trim_center`, `trim_R` with fixed stick positions and
   throttle. Repeat at zero and a modest nonzero throttle setting; obtain
   complete frames rather than relying on repaired pulses.
4. Repeat `yaw_left`, `yaw_center`, `yaw_right`, `pitch_up`, `pitch_center`,
   `pitch_down`, changing one control at a time. Label stick movement separately
   from the helicopter's still-unverified physical response.
5. For accurate repeat timing, preserve the leading gap and capture timestamps
   on the ESP32 or use a logic analyser. Measure the optical carrier and duty
   cycle separately if transmission does not match the original pilot.
