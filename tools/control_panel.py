"""Local-only USB bridge. No background heartbeat: only a live held UI sends SET."""
import argparse
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlsplit

import serial
from serial.tools import list_ports

ROOT = Path(__file__).resolve().parents[1]
FIRMWARE = "parakopter-tx-2"


class Bridge:
    def __init__(self, log_dir=None):
        self.lock = threading.RLock()
        self.device = None
        self.port = None
        self.state = {}
        self.last_seen = 0.0
        self.events = deque(maxlen=80)
        self.session = 0
        self.session_confirmed = False
        self.sequence = 0
        self.owner = None
        self.last_control = 0.0
        self.error = ""
        self.closed = False
        log_dir = log_dir or ROOT / ".local" / "sessions"
        log_dir.mkdir(parents=True, exist_ok=True)
        self.log_path = log_dir / (datetime.now().strftime("%Y%m%d-%H%M%S") + ".jsonl")
        self.log = self.log_path.open("a", encoding="utf-8", buffering=1)
        threading.Thread(target=self.reader, daemon=True).start()

    @staticmethod
    def ports():
        return [{"port": p.device, "name": p.description,
                 "usb": p.vid is not None} for p in list_ports.comports()]

    def record(self, event):
        event = dict(event, time=datetime.now(timezone.utc).isoformat())
        if event.get("event") != "status":
            self.events.append(event)
        self.log.write(json.dumps(event, ensure_ascii=False) + "\n")

    def fresh(self):
        return bool(self.device and self.state.get("firmware") == FIRMWARE and
                    self.state.get("protocol") == 1 and self.state.get("pwm_ready") and
                    time.monotonic()-self.last_seen < 1)

    def snapshot(self):
        with self.lock:
            return {"connected": self.fresh(), "port": self.port, "error": self.error,
                    "device": dict(self.state), "events": list(self.events),
                    "log": str(self.log_path)}

    def write(self, line):
        if not self.device:
            raise ValueError("ESP32 nie jest połączone.")
        try:
            self.device.write((line + "\n").encode("ascii"))
        except (serial.SerialException, OSError) as exc:
            self.session = 0
            self.error = str(exc)
            raise ValueError("Utracono połączenie USB.") from exc
        self.record({"event": "command", "line": line})

    def connect(self, port):
        with self.lock:
            if port not in {p["port"] for p in self.ports() if p["usb"]}:
                raise ValueError("Wybierz wykryty port USB płytki ESP32.")
            self.disconnect()
            device = serial.Serial()
            device.port = port
            device.baudrate = 115200
            device.timeout = 0.02
            device.write_timeout = 0.2
            device.dtr = False
            device.rts = False
            device.open()
            self.device = device
            self.port = port
            self.state = {}
            self.error = ""
            self.last_seen = 0
            self.write("STOP")
            self.write("STATUS")
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            with self.lock:
                if self.fresh():
                    return self.snapshot()
            time.sleep(0.05)
        with self.lock:
            self.disconnect()
        raise ValueError("Brak odpowiedzi nowego firmware. Zamknij Monitor portu szeregowego i sprawdź wgranie programu.")

    def disconnect(self):
        with self.lock:
            self.session = 0
            self.owner = None
            try:
                if self.device:
                    try:
                        self.write("STOP")
                    finally:
                        self.device.close()
                        self.device = None
            finally:
                # Reset even when the final STOP could not be written.
                self.port = None
                self.state = {}

    def stop(self):
        with self.lock:
            self.session = 0
            self.owner = None
            if self.device:
                self.write("STOP")

    @staticmethod
    def integer(data, key, low, high):
        value = data.get(key)
        if type(value) is not int or not low <= value <= high:
            raise ValueError(f"Nieprawidłowa wartość: {key}.")
        return value

    def action(self, name, data):
        with self.lock:
            if name == "stop":
                self.stop()
                return {"ok": True}
            if not self.fresh():
                self.stop()
                raise ValueError("Brak aktualnej odpowiedzi ESP32.")
            if name in ("test", "arm"):
                if self.state.get("mode") != "idle" or self.session:
                    raise ValueError("Poczekaj na stan Gotowy / gaz 0.")
                if name == "test":
                    if data.get("helicopter_off") is not True:
                        raise ValueError("Wyłącz helikopter i fabryczny pilot przed testem IR.")
                    self.write("TEST")
                    return {"ok": True}
                if data.get("controls_enabled") is not True:
                    raise ValueError("Włącz sterowanie w panelu.")
                owner = data.get("owner")
                if not isinstance(owner, str) or not 8 <= len(owner) <= 80:
                    raise ValueError("Odśwież panel.")
                self.session = secrets.randbelow(2147483646) + 1
                self.session_confirmed = False
                self.sequence = 0
                self.owner = owner
                self.last_control = time.monotonic()
                self.write(f"ARM {self.session}")
                return {"ok": True, "session": self.session}
            if name == "control":
                if not self.session or data.get("session") != self.session or data.get("owner") != self.owner:
                    raise ValueError("Sesja zakończona. Puść przycisk i rozpocznij nową próbę.")
                if time.monotonic()-self.last_control >= 0.45:
                    self.stop()
                    raise ValueError("Przerwa w sterowaniu. Próba zatrzymana.")
                try:
                    seq = self.integer(data,"sequence",self.sequence+1,2147483647)
                    values = [self.integer(data,k,0,limit) for k,limit in
                              (("throttle",127),("yaw",127),("pitch",127),("trim",127),("channel",1))]
                except ValueError:
                    self.stop()
                    raise
                self.sequence = seq
                self.last_control = time.monotonic()
                self.write("SET " + " ".join(map(str,[self.session,seq,*values])))
                return {"ok": True}
            raise ValueError("Nieznana komenda.")

    def reader(self):
        pending = bytearray()
        previous = None
        while not self.closed:
            with self.lock:
                device = self.device
                if previous is not device:
                    pending.clear()
                    previous = device
                if device:
                    try:
                        chunk = device.read(max(1, min(device.in_waiting,4096)))
                        pending.extend(chunk)
                        while b"\n" in pending:
                            line, _, rest = pending.partition(b"\n")
                            pending = bytearray(rest)
                            try:
                                event = json.loads(line)
                            except (ValueError, UnicodeDecodeError):
                                continue
                            if not isinstance(event, dict):
                                continue
                            self.record(event)
                            if event.get("firmware") == FIRMWARE:
                                self.state = event
                                self.last_seen = time.monotonic()
                                if self.session and event.get("token") == self.session:
                                    self.session_confirmed = True
                                if ((self.session_confirmed and event.get("mode") in ("idle", "stopping"))
                                    or event.get("event") == "ready" or not event.get("ok", True)):
                                    self.session = 0
                                    self.owner = None
                        if len(pending) > 8192:
                            pending.clear()
                        if self.session and time.monotonic()-self.last_control > 0.4:
                            self.stop()  # Additional host timeout; ESP32 also has its own.
                    except (OSError, serial.SerialException, ValueError) as exc:
                        self.error = str(exc)
                        self.session = 0
                        self.owner = None
                        device.close()
                        self.device = None
            time.sleep(0.005)

    def close(self):
        with self.lock:
            self.disconnect()
            self.closed = True
            self.log.close()


def make_handler(bridge, csrf, port):
    allowed_host = f"127.0.0.1:{port}"
    allowed_origin = "http://" + allowed_host

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def send(self, payload, code=200, mime="application/json; charset=utf-8"):
            content = payload if isinstance(payload,bytes) else json.dumps(payload,ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type",mime)
            self.send_header("Content-Length",str(len(content)))
            self.send_header("Cache-Control","no-store")
            self.send_header("X-Content-Type-Options","nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            try:
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.headers.get("Host") != allowed_host:
                return self.send({"error":"Invalid host"},403)
            path = urlsplit(self.path).path
            if path == "/api/state":
                return self.send(bridge.snapshot())
            if path == "/api/config":
                return self.send({"token":csrf,"ports":bridge.ports()})
            assets = {"/":("index.html","text/html; charset=utf-8"),
                      "/app.js":("app.js","text/javascript; charset=utf-8"),
                      "/flight-keys.js":("flight-keys.js","text/javascript; charset=utf-8"),
                      "/style.css":("style.css","text/css; charset=utf-8")}
            if path in assets:
                filename,mime=assets[path]
                return self.send((ROOT/"ui"/filename).read_bytes(),mime=mime)
            return self.send({"error":"Not found"},404)

        def do_POST(self):
            if (self.headers.get("Host") != allowed_host or
                self.headers.get("Origin") != allowed_origin or
                self.headers.get("X-Control-Token") != csrf):
                return self.send({"error":"Nieautoryzowane żądanie."},403)
            try:
                size = int(self.headers.get("Content-Length","0"))
                if size < 0 or size > 2048:
                    raise ValueError("Za duże żądanie.")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data,dict):
                    raise ValueError("Nieprawidłowe dane.")
                name = urlsplit(self.path).path.removeprefix("/api/")
                if name == "connect":
                    result=bridge.connect(data.get("port"))
                elif name == "disconnect":
                    bridge.disconnect()
                    result={"ok":True}
                else:
                    result=bridge.action(name,data)
                self.send(result)
            except (ValueError,OSError,serial.SerialException) as exc:
                self.send({"error":str(exc)},400)
    return Handler


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--port",help="ESP32 COM port; omit to choose in UI")
    parser.add_argument("--http-port",type=int,default=8765)
    args=parser.parse_args()
    bridge=Bridge()
    server=ThreadingHTTPServer(("127.0.0.1",args.http_port),make_handler(bridge,secrets.token_urlsafe(32),args.http_port))
    if args.port:
        try:
            bridge.connect(args.port)
        except (ValueError,OSError,serial.SerialException) as exc:
            bridge.error=str(exc)
    print(f"Panel: http://127.0.0.1:{args.http_port}",flush=True)
    print(f"Log: {bridge.log_path}",flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        bridge.close()
        server.server_close()


if __name__ == "__main__":
    main()
