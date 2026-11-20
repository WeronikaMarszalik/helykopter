#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

// Interface fixed by the coordinator. Implement in IrFormat.cpp; do not change signatures.
// Free functions in namespace irfmt (no class). Std C++ only, no Arduino includes.
namespace irfmt {

// Keep only [A-Za-z0-9_-], truncate to 32 chars; empty result -> "unlabeled".
std::string sanitizeLabel(const std::string& raw);

// "uint16_t rawData[N] = {a, b, c};" ; N==0 -> "uint16_t rawData[0] = {};"
std::string formatRawData(const uint16_t* data, size_t length);

// Multi-line block, exactly:
//   "[<label> #<counter>] protocol=<protocol>[ OVERFLOW]\n" + formatRawData(...) + "\n"
// " OVERFLOW" (leading space) appears only when overflow is true.
std::string formatFrame(const std::string& label, unsigned counter,
                        const std::string& protocol,
                        const uint16_t* data, size_t length, bool overflow);

}  // namespace irfmt
