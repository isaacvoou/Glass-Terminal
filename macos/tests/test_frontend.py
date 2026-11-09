#!/usr/bin/env python3
"""Exercise the actual vendored renderer in a browser. No native macOS claims."""
import base64
import functools
import http.server
import pathlib
import shutil
import threading
import unittest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_): pass

class FrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT / 'resources')))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        executable = shutil.which('chromium')
        cls.browser = cls.playwright.chromium.launch(headless=True, executable_path=executable)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.playwright.stop(); cls.server.shutdown(); cls.server.server_close()
    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 900, 'height': 580})
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.add_init_script('window.messages=[]; window.webkit={messageHandlers:{terminal:{postMessage(m){window.messages.push(m)}}}};')
        self.page.goto(f'http://127.0.0.1:{self.server.server_port}/index.html')
        self.page.wait_for_function('window.messages.some(m=>m.type==="ready")')
    def tearDown(self):
        self.assertEqual(self.errors, [])
        self.page.close()
    def write(self, value):
        data = value.encode() if isinstance(value, str) else value
        self.page.evaluate('window.messages = window.messages.filter(m=>m.type!=="ack")')
        self.page.evaluate('b => Glass.write(b)', base64.b64encode(data).decode())
        self.page.wait_for_function('window.messages.some(m=>m.type==="ack")')
    def selected_text(self):
        self.page.evaluate('Glass.selectAll(); Glass.copy()')
        return self.page.evaluate('window.messages.filter(m=>m.type==="copy").at(-1).text')
    def test_utf8_split_across_packets_and_ansi_sequences(self):
        text = 'Привет, мир! café 漢字 🙂'
        data = text.encode()
        self.write(b'\x1b[31m' + data[:3])
        self.write(data[3:17])
        self.write(data[17:] + b'\x1b[0m\r\n')
        self.assertIn(text, self.selected_text())
        self.assertTrue(self.page.locator('.xterm-fg-1').count())
    def test_alternate_screen_restores_primary_buffer(self):
        self.write('PRIMARY_MARKER\r\n')
        self.write('\x1b[?1049hALTERNATE_MARKER')
        self.assertIn('ALTERNATE_MARKER', self.selected_text())
        self.write('\x1b[?1049l')
        self.assertIn('PRIMARY_MARKER', self.selected_text())
        self.assertNotIn('ALTERNATE_MARKER', self.selected_text())
    def test_bracketed_paste_and_typing_use_the_native_bridge(self):
        self.write('\x1b[?2004h')
        self.page.evaluate('Glass.paste("echo привет\\n")')
        data = self.page.evaluate('window.messages.filter(m=>m.type==="input").at(-1).data')
        self.assertEqual(base64.b64decode(data), '\x1b[200~echo привет\r\x1b[201~'.encode())
        self.page.locator('.xterm-helper-textarea').focus()
        self.page.keyboard.type('ls')
        inputs = self.page.evaluate('window.messages.filter(m=>m.type==="input").slice(-2).map(m=>m.data)')
        self.assertEqual(b''.join(map(base64.b64decode, inputs)), b'ls')
    def test_find_and_copy_do_not_interpret_output_as_html(self):
        self.write('needle <img src=x onerror=alert(1)>\r\n')
        self.assertEqual(self.page.locator('img').count(), 0)
        self.page.evaluate('Glass.find()')
        self.page.locator('#query').fill('needle')
        self.assertEqual(self.page.locator('#query').get_attribute('aria-invalid'), 'false')
        self.page.evaluate('Glass.selectAll(); Glass.copy()')
        self.assertEqual(self.page.evaluate('window.messages.filter(m=>m.type==="copy").at(-1).text'), 'needle')
        self.page.keyboard.press('Escape')
        self.assertTrue(self.page.locator('#search').is_hidden())
    def test_font_resize_reports_new_dimensions(self):
        before = self.page.evaluate('window.messages.filter(m=>m.type==="ready").at(-1).cols')
        self.page.evaluate('Glass.configure(24)')
        self.page.wait_for_function('window.messages.some(m=>m.type==="resize" && m.cols < '+str(before)+')')
    def test_osc52_cannot_write_the_clipboard(self):
        self.write('\x1b]52;c;SGVsbG8=\x07still running')
        self.assertFalse(self.page.evaluate('window.messages.some(m=>m.type==="copy")'))
        self.assertIn('still running', self.selected_text())

if __name__ == '__main__': unittest.main(verbosity=2)
