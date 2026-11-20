#include "IrFormat.h"

#include <sstream>

namespace irfmt {

std::string sanitizeLabel(const std::string& raw) {
  std::string out;
  for (char c : raw) {
    bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
              (c >= '0' && c <= '9') || c == '_' || c == '-';
    if (ok) out += c;
    if (out.size() == 32) break;
  }
  return out.empty() ? "unlabeled" : out;
}

std::string formatRawData(const uint16_t* data, size_t length) {
  std::ostringstream os;
  os << "uint16_t rawData[" << length << "] = {";
  for (size_t i = 0; i < length; i++) {
    if (i) os << ", ";
    os << data[i];
  }
  os << "};";
  return os.str();
}

std::string formatFrame(const std::string& label, unsigned counter,
                        const std::string& protocol, const uint16_t* data,
                        size_t length, bool overflow) {
  std::ostringstream os;
  os << "[" << label << " #" << counter << "] protocol=" << protocol;
  if (overflow) os << " OVERFLOW";
  os << "\n" << formatRawData(data, length) << "\n";
  return os.str();
}

}  // namespace irfmt
