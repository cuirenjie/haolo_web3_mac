"""Isolated retirement safety tests; no real Docker or production files."""
import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import retire_drained_gateway as retirement


class RetirementSafetyTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = {'phase': 'accepted_retirement_pending', 'old_retained': True,
            'old': {'container': 'old-fixture', 'public': 50887, 'private': 50888,
                    'identity': ['id', 'sha256:image', 'started', 0]}}
        self.data = {'Id': 'id', 'Image': 'sha256:image', 'RestartCount': 0,
            'State': {'Status': 'running', 'Pid': 42, 'StartedAt': 'started', 'ExitCode': 0}}
        (self.root / 'state.json').write_text(json.dumps(self.state))
        (self.root / 'active').write_text('CONTAINER=current-fixture\n')
        (self.root / 'haproxy').write_text('server current 127.0.0.1:50987\n')
        self.calls = []
        self.connections = iter([0, 0])
        self.websockets = iter([0, 0])
        for name, file in [('ACTIVE', 'active'), ('HAPROXY', 'haproxy'), ('LOCK', 'lock')]:
            p = patch.object(retirement, name, self.root / file)
            p.start(); self.addCleanup(p.stop)
        for target, value in [('run', self.run_command), ('time.sleep', lambda _: None)]:
            p = patch('retire_drained_gateway.' + target, value)
            p.start(); self.addCleanup(p.stop)

    def run_command(self, args, **kwargs):
        self.calls.append(args)
        if args[:2] == ['docker', 'inspect']:
            return json.dumps([copy.deepcopy(self.data)])
        if args[0] == 'nsenter':
            return 'ESTABLISHED\n' * next(self.connections)
        if args[:2] == ['docker', 'exec']:
            return str(next(self.websockets))
        if args == ['docker', 'stop', '--time', '-1', 'old-fixture']:
            self.data['State']['Status'] = 'exited'
            return 'old-fixture\n'
        raise AssertionError('Unexpected operation: ' + repr(args))

    def stopped(self):
        return any(args[:2] == ['docker', 'stop'] for args in self.calls)

    def test_both_independent_connection_counts_must_be_zero(self):
        for connections, websockets in [(1, 0), (0, 1)]:
            self.connections = iter([connections]); self.websockets = iter([websockets])
            self.assertFalse(retirement.check(self.root))
            self.assertFalse(self.stopped())
            self.assertEqual(json.loads((self.root / 'state.json').read_text())['phase'], 'accepted_retirement_pending')

    def test_two_zero_checks_then_infinite_grace_stop_and_preserve_artifacts(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(retirement.check(self.root))
        self.assertTrue(self.stopped())
        report = json.loads((self.root / 'retirement-status.json').read_text())
        self.assertEqual(len(report['snapshots']), 2)
        self.assertFalse(report['forced']); self.assertEqual(report['exitCode'], 0)
        self.assertTrue(json.loads((self.root / 'state.json').read_text())['old_container_and_image_preserved'])
        self.assertFalse(any(args[:2] in [['docker', 'rm'], ['docker', 'rmi']] for args in self.calls))

    def test_second_nonzero_sample_prevents_stop(self):
        self.connections = iter([0, 1])
        self.assertFalse(retirement.check(self.root)); self.assertFalse(self.stopped())

    def test_active_pointer_or_backend_reference_prevents_stop(self):
        for file, unsafe, safe in [('active', 'CONTAINER=old-fixture\n', 'CONTAINER=current-fixture\n'),
                ('haproxy', 'server old 127.0.0.1:50888\n', 'server current 127.0.0.1:50987\n')]:
            (self.root / file).write_text(unsafe)
            with self.assertRaises(RuntimeError): retirement.check(self.root)
            self.assertFalse(self.stopped()); (self.root / file).write_text(safe)

    def test_restarted_or_replaced_old_instance_prevents_stop(self):
        self.data['RestartCount'] = 1
        with self.assertRaises(RuntimeError): retirement.check(self.root)
        self.assertFalse(self.stopped())

    def test_unsuccessful_existing_exit_is_not_accepted(self):
        self.data['State'].update(Status='exited', ExitCode=137)
        with self.assertRaises(RuntimeError): retirement.check(self.root)
        self.assertFalse(self.stopped())


if __name__ == '__main__':
    unittest.main()
