#!/usr/bin/env python3
"""Real PTY integration tests. Linux and macOS; no UI or fake PTY."""
import ctypes as C
import errno
import hashlib
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build' / 'tests'
BUILD.mkdir(parents=True, exist_ok=True)
LIB = BUILD / ('libgtpty.dylib' if sys.platform == 'darwin' else 'libgtpty.so')
command = ['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-pthread', '-g',
           '-fPIC', '-shared', str(ROOT / 'src/pty.c'), '-o', str(LIB)]
if sys.platform != 'darwin':
    command += ['-lutil']
subprocess.run(command, check=True)
lib = C.CDLL(str(LIB), use_errno=True)
lib.gt_pty_open.argtypes = [C.c_char_p, C.POINTER(C.c_char_p), C.c_char_p, C.c_uint, C.c_uint]
lib.gt_pty_open.restype = C.c_void_p
lib.gt_pty_write.argtypes = [C.c_void_p, C.c_void_p, C.c_size_t]
lib.gt_pty_read.argtypes = [C.c_void_p, C.c_void_p, C.c_size_t]
lib.gt_pty_read.restype = C.c_size_t
lib.gt_pty_resize.argtypes = [C.c_void_p, C.c_uint, C.c_uint]
lib.gt_pty_exited.argtypes = [C.c_void_p, C.POINTER(C.c_int)]
lib.gt_pty_has_foreground_job.argtypes = [C.c_void_p]
lib.gt_pty_close.argtypes = [C.c_void_p]
lib.gt_pty_pid.argtypes = [C.c_void_p]
lib.gt_pty_pid.restype = C.c_int

class Session:
    def __init__(self, executable, args, cwd=None, cols=80, rows=24):
        values = [os.fsencode(executable), *(os.fsencode(a) for a in args)]
        argv = (C.c_char_p * (len(values) + 1))(*values, None)
        self.ptr = lib.gt_pty_open(values[0], argv, os.fsencode(cwd) if cwd else None, cols, rows)
        if not self.ptr:
            raise OSError(C.get_errno(), os.strerror(C.get_errno()))
    def send(self, data):
        if lib.gt_pty_write(self.ptr, data, len(data)) < 0:
            raise OSError(C.get_errno(), os.strerror(C.get_errno()))
    def read(self):
        output = C.create_string_buffer(65536)
        size = lib.gt_pty_read(self.ptr, output, len(output))
        return output.raw[:size]
    def until(self, marker=None, timeout=10):
        output = bytearray()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            data = self.read()
            output += data
            if marker is not None and marker in output:
                return bytes(output)
            if marker is None and lib.gt_pty_exited(self.ptr, None):
                while (tail := self.read()):
                    output += tail
                return bytes(output)
            time.sleep(.002)
        raise TimeoutError(f'PTY did not produce {marker!r}: {output[-1000:]!r}')
    def close(self):
        if self.ptr:
            lib.gt_pty_close(self.ptr)
            self.ptr = None
    def __enter__(self): return self
    def __exit__(self, *exc): self.close()

class PTYTests(unittest.TestCase):
    def test_tty_environment_working_directory_and_exit_status(self):
        with tempfile.TemporaryDirectory(prefix='glass tty ') as directory:
            script = 'test -t 0 && test -t 1 && test -t 2 || exit 99; stty size; printf "%s|%s|%s|" "$TERM" "$COLORTERM" "$SHELL"; pwd; exit 7'
            with Session('/bin/sh', ['-c', script], directory, 103, 37) as session:
                output = session.until()
                self.assertIn(b'37 103', output)
                self.assertIn(b'xterm-256color|truecolor|/bin/sh|', output)
                self.assertIn(os.fsencode(os.path.realpath(directory)), output)
                status = C.c_int()
                self.assertEqual(lib.gt_pty_exited(session.ptr, C.byref(status)), 1)
                self.assertTrue(os.WIFEXITED(status.value))
                self.assertEqual(os.WEXITSTATUS(status.value), 7)

    def test_window_resize_reaches_child(self):
        script = 'import os,sys; print("READY",flush=True); sys.stdin.readline(); print(os.get_terminal_size().columns,os.get_terminal_size().lines,flush=True)'
        with Session(sys.executable, ['-c', script]) as session:
            session.until(b'READY')
            self.assertEqual(lib.gt_pty_resize(session.ptr, 119, 42), 0)
            session.send(b'\n')
            self.assertIn(b'119 42', session.until())

    def test_large_output_applies_backpressure_without_losing_bytes(self):
        count = 3 * 1024 * 1024 + 19
        script = f'import os,tty; tty.setraw(0); data=b"Z"*{count}; offset=0\nwhile offset<len(data): offset+=os.write(1,data[offset:])'
        with Session(sys.executable, ['-c', script]) as session:
            time.sleep(.15)  # exceed the C queue, then drain the blocked producer
            output = session.until(timeout=15)
            self.assertEqual(len(output), count)
            self.assertEqual(hashlib.sha256(output).digest(), hashlib.sha256(b'Z' * count).digest())

    def test_binary_input_is_not_truncated_or_recoded(self):
        data = bytes(range(256)) * 4096
        script = f'import os,tty,hashlib; tty.setraw(0); os.write(1,b"READY"); data=bytearray()\nwhile len(data)<{len(data)}: data.extend(os.read(0,min(65536,{len(data)}-len(data))))\nos.write(1,hashlib.sha256(data).hexdigest().encode())'
        with Session(sys.executable, ['-c', script]) as session:
            session.until(b'READY')
            session.send(data)
            self.assertIn(hashlib.sha256(data).hexdigest().encode(), session.until())

    def test_control_c_interrupts_foreground_program_and_shell_survives(self):
        with Session('/bin/sh', ['-i']) as session:
            session.send(b'sleep 30\n')
            deadline = time.monotonic() + 3
            while not lib.gt_pty_has_foreground_job(session.ptr) and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertEqual(lib.gt_pty_has_foreground_job(session.ptr), 1)
            session.send(b'\x03')
            time.sleep(.08)
            session.send(b'printf "SHELL_SURVIVED\\n"\nexit\n')
            output = session.until(timeout=5)
            self.assertIn(b'SHELL_SURVIVED', output)
            self.assertNotIn(b"can't access tty", output)

    def test_utf8_survives_the_pty(self):
        text = 'Привет, мир! café 漢字 🙂'
        script = 'import os,tty; tty.setraw(0); os.write(1,' + repr(text.encode()) + ')'
        with Session(sys.executable, ['-c', script]) as session:
            self.assertEqual(session.until(), text.encode())

    def test_close_reaps_child_without_hanging(self):
        session = Session('/bin/sh', ['-c', 'sleep 60'])
        pid = lib.gt_pty_pid(session.ptr)
        started = time.monotonic()
        session.close()
        self.assertLess(time.monotonic() - started, 2)
        with self.assertRaises(ChildProcessError): os.waitpid(pid, os.WNOHANG)

    def test_failed_spawns_and_invalid_dimensions(self):
        for _ in range(20):
            with self.assertRaises(OSError) as caught:
                Session('/path/that/does/not/exist', [])
            self.assertEqual(caught.exception.errno, errno.ENOENT)
        with self.assertRaises(OSError): Session('/bin/sh', ['-c', 'true'], '/missing/glass/directory')
        with self.assertRaises(OSError) as caught: Session('/bin/sh', [], cols=0)
        self.assertEqual(caught.exception.errno, errno.EINVAL)

if __name__ == '__main__': unittest.main(verbosity=2)
