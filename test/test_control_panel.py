import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

spec=importlib.util.spec_from_file_location('panel',Path(__file__).parents[1]/'tools/control_panel.py')
panel=importlib.util.module_from_spec(spec)
spec.loader.exec_module(panel)


class FakeSerial:
    def __init__(self):
        self.commands=[]
        self.in_waiting=0
    def write(self,value): self.commands.append(value.decode().strip())
    def read(self,n): return b''
    def close(self): pass


class PanelTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.bridge=panel.Bridge(Path(self.temp.name))
        self.fake=FakeSerial()
        with self.bridge.lock:
            self.bridge.device=self.fake
            self.bridge.state={'firmware':panel.FIRMWARE,'protocol':1,'pwm_ready':True,'mode':'idle','best':10}
            self.bridge.last_seen=time.monotonic()
    def tearDown(self):
        self.bridge.close()
        self.temp.cleanup()
    def arm(self):
        return self.bridge.action('arm',{'owner':'test-client','controls_enabled':True})['session']
    def data(self,session):
        return dict(owner='test-client',session=session,sequence=1,throttle=10,yaw=63,pitch=63,trim=81,channel=1)
    def test_no_automatic_emission(self):
        time.sleep(.06)
        self.assertEqual(self.fake.commands,[])
    def test_motor_interlock(self):
        with self.assertRaises(ValueError):
            self.bridge.action('arm',{'owner':'test-client','controls_enabled':False})
        self.assertEqual(self.fake.commands,[])
    def test_stop_rejects_inflight_control(self):
        self.bridge.state['best']=0  # Receiver is optional, including for motor tests.
        token=self.arm()
        self.bridge.stop()
        with self.assertRaises(ValueError): self.bridge.action('control',self.data(token))
        self.assertEqual(self.fake.commands[-1],'STOP')
        self.assertFalse(any(c.startswith('SET') for c in self.fake.commands))
    def test_invalid_control_stops(self):
        token=self.arm()
        data=self.data(token);data['throttle']=128
        with self.assertRaises(ValueError):self.bridge.action('control',data)
        self.assertEqual(self.fake.commands[-1],'STOP')
    def test_full_throttle(self):
        token=self.arm()
        data=self.data(token);data['throttle']=127
        self.bridge.action('control',data)
        self.assertEqual(self.fake.commands[-1],f'SET {token} 1 127 63 63 81 1')
    def test_other_tab_cannot_control(self):
        token=self.arm();data=self.data(token);data['owner']='second-tab'
        with self.assertRaises(ValueError):self.bridge.action('control',data)
        self.assertFalse(any(c.startswith('SET') for c in self.fake.commands))
    def test_host_timeout(self):
        self.arm()
        with self.bridge.lock:self.bridge.last_control-=1
        time.sleep(.06)
        self.assertEqual(self.fake.commands[-1],'STOP')
        self.assertEqual(self.bridge.session,0)
    def test_duplicate_sequence(self):
        token=self.arm();data=self.data(token)
        self.bridge.action('control',data)
        with self.assertRaises(ValueError):self.bridge.action('control',data)
        self.assertEqual(self.fake.commands[-1],'STOP')
    def test_foreign_origin_rejected(self):
        server=panel.ThreadingHTTPServer(('127.0.0.1',0),panel.BaseHTTPRequestHandler)
        port=server.server_port
        server.RequestHandlerClass=panel.make_handler(self.bridge,'secret',port)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            request=Request(f'http://127.0.0.1:{port}/api/test',data=b'{"helicopter_off":true}',
                headers={'Origin':'https://foreign.example','X-Control-Token':'secret','Content-Type':'application/json'})
            with self.assertRaises(HTTPError) as error:urlopen(request)
            self.assertEqual(error.exception.code,403)
            self.assertEqual(self.fake.commands,[])
        finally:server.shutdown();server.server_close()


if __name__=='__main__':unittest.main()
