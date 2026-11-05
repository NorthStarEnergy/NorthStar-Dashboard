"""TexasSolver v0.2.0 subprocess adapter; no upstream source is embedded.

Study-only heads-up postflop trees. Inputs are explicit user ranges, never the
table's hidden cards. A reported accuracy applies only to the configured tree.
"""
import itertools
from collections import deque
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time

from .cards import DECK, hand_class, validate


NATIVE_SLOT = threading.Lock()

def executable():
    configured = os.environ.get('NORTHSTAR_TEXASSOLVER_EXE')
    if configured:
        return Path(configured)
    base = Path(os.environ.get('LOCALAPPDATA', Path.home()))
    return base / 'NorthStar/TexasSolver/v0.2.0/TexasSolver-v0.2.0-Windows/console_solver.exe'


def normalize(data):
    """Validate the entire request before creating a process or command file."""
    board = data.get('board', '')
    if isinstance(board, str):
        board = board.replace(',', ' ').split()
    if not isinstance(board, list) or len(board) not in (3, 4, 5):
        raise ValueError('Enter 3, 4 or 5 board cards, such as Qs Jh 2h.')
    if any(not isinstance(c, str) for c in board):
        raise ValueError('Invalid board cards.')
    validate(board)
    result = {'board': board}
    for name in ('pot', 'stack'):
        value = data.get(name)
        if type(value) not in (int, float) or not math.isfinite(value) or not 1 <= value <= 1000:
            raise ValueError('Pot and effective stack must be between 1 and 1000 BB.')
        result[name] = float(value)
    if result['stack'] / result['pot'] > 4:
        raise ValueError('Use an effective stack of at most four times the pot.')
    combos = list(itertools.combinations([c for c in DECK if c not in board], 2))
    ranges = []
    # Conservative caps bound the native tree's memory footprint.
    cap = {3: 60, 4: 200, 5: 1326}[len(board)]
    for name in ('oop_range', 'ip_range'):
        value = data.get(name)
        if not isinstance(value, str) or not 1 <= len(value) <= 5000:
            raise ValueError('Enter comma-separated ranges, such as AA,KK,AKs:0.5.')
        classes = {}
        for token in value.split(','):
            match = re.fullmatch(r'([2-9TJQKA]{2}[so]?)(?::(0(?:\.\d+)?|1(?:\.0+)?))?', token.strip())
            if not match:
                raise ValueError('Ranges use AA,AK,AKs,AKo and optional weights :0.5. No + or dash notation.')
            label, weight = match.group(1), float(match.group(2) or 1)
            ranks = '23456789TJQKA'
            if ranks.index(label[0]) < ranks.index(label[1]) or (label[0] == label[1] and len(label) != 2):
                raise ValueError('Put the higher rank first; pairs have no s/o suffix.')
            expanded = [label] if label[0] == label[1] or len(label) == 3 else [label+'s', label+'o']
            for item in expanded:
                if item in classes:
                    raise ValueError('Range entries must not overlap.')
                classes[item] = weight
        live = [set(c) for c in combos if classes.get(hand_class(c), 0) > 0]
        if not live or len(live) > cap:
            raise ValueError(f'Each range must contain 1–{cap} unblocked combinations on this street.')
        ranges.append(live)
        result[name] = ','.join(f'{k}:{v:g}' for k, v in sorted(classes.items()) if v > 0)
    if not any(not a.intersection(b) for a in ranges[0] for b in ranges[1]):
        raise ValueError('The two ranges have no compatible pair of hands.')
    return result


def commands(request, destination):
    lines = [f"set_pot {request['pot']:g}", f"set_effective_stack {request['stack']:g}",
             'set_board ' + ','.join(request['board']),
             'set_range_oop ' + request['oop_range'], 'set_range_ip ' + request['ip_range']]
    for street in ('flop', 'turn', 'river')[len(request['board'])-3:]:
        for seat in ('oop', 'ip'):
            lines += [f'set_bet_sizes {seat},{street},bet,50',
                      f'set_bet_sizes {seat},{street},raise,100',
                      f'set_bet_sizes {seat},{street},allin']
    lines += ['set_allin_threshold 0.67', 'build_tree', 'set_thread_num 2',
              'set_accuracy 0.5', 'set_max_iteration 300', 'set_print_interval 10',
              'set_use_isomorphism 1', 'start_solve', 'set_dump_rounds 1',
              'dump_result ' + destination.as_posix()]
    return '\n'.join(lines) + '\n'


def solve(data, *, exe=None, timeout=90):
    request = normalize(data)
    exe = Path(exe) if exe else executable()
    if not exe.is_file() or not (exe.parent / 'resources').is_dir():
        raise ValueError('TexasSolver is not installed on this host.')
    started = time.monotonic()
    # ASCII, space-free relative output avoids the upstream command parser's
    # unquoted path behavior. No user text reaches a shell.
    with tempfile.TemporaryDirectory(prefix='ns-solve-', dir=exe.parent) as directory:
        folder = Path(directory)
        output = folder / 'result.json'
        instruction = folder / 'input.txt'
        instruction.write_text(commands(request, output.relative_to(exe.parent)), encoding='ascii')
        with (folder / 'solver.log').open('wb') as log:
            try:
                proc = subprocess.run([str(exe), '-i', instruction.relative_to(exe.parent).as_posix()],
                    cwd=exe.parent, stdout=log, stderr=subprocess.STDOUT, timeout=timeout,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), check=False)
            except subprocess.TimeoutExpired as error:
                raise ValueError('TexasSolver reached its 90-second limit. Narrow the ranges or use a later street.') from error
        if proc.returncode or not output.is_file():
            raise ValueError('TexasSolver could not solve these ranges and settings.')
        if output.stat().st_size > 20_000_000:
            raise ValueError('Result is too large. Narrow the ranges.')
        tree = json.loads(output.read_text(encoding='utf-8'))
        if tree.get('node_type') != 'action_node' or tree.get('player') != 1 or not tree.get('strategy'):
            raise ValueError('TexasSolver returned an unsupported result.')
        log_text = (folder / 'solver.log').read_text(encoding='utf-8', errors='replace')
    metrics = re.findall(r'Total exploitability ([\d.eE+\-]+) precent', log_text)
    exploitability = float(metrics[-1]) if metrics else None
    if exploitability is not None and not math.isfinite(exploitability):
        exploitability = None
    return {'engine': 'TexasSolver 0.2.0', 'request': request, 'tree': tree,
            'seconds': round(time.monotonic()-started, 2),
            'reported_exploitability_percent': exploitability,
            'target_met': exploitability is not None and 0 <= exploitability <= .5,
            'scope': 'Heads-up postflop, supplied ranges, 50% pot bets / 100% raises / all-in. '
                     'Only the current street is exported; future streets are included in solving. '
                     'Upstream reported exploitability; not a full-game or six-player GTO certificate.'}


class TexasSolverJobs:
    """One native solve at a time; results isolated to the requesting session."""
    def __init__(self):
        self.slot = NATIVE_SLOT
        self.completed = deque()

    def start(self, session, data):
        request = normalize(data)
        if not executable().is_file():
            raise ValueError('TexasSolver is not installed on this host.')
        if not self.slot.acquire(blocking=False):
            raise ValueError('TexasSolver is busy. Try again after the current solve.')
        job = {'status': 'running'}
        session['texas_solver_job'] = job
        def worker():
            try:
                result = solve(request)
                while len(self.completed) >= 8:
                    old = self.completed.popleft()
                    old.clear()
                    old.update(status='expired')
                job.update(result=result, status='complete')
                self.completed.append(job)
            except (ValueError, OSError, subprocess.SubprocessError) as error:
                job.update(error=str(error) if isinstance(error, ValueError) else 'The solver process failed.', status='failed')
            finally:
                self.slot.release()
        threading.Thread(target=worker, name='texas-solver-study', daemon=True).start()
        return {'status': 'running'}

    def status(self, session):
        job = session.get('texas_solver_job', {'status': 'idle'})
        # Result is fetched separately, keeping polling responses small.
        return {'installed': executable().is_file(), **{k:v for k,v in job.items() if k != 'result'}}

    def result(self, session):
        job = session.get('texas_solver_job', {})
        if job.get('status') != 'complete':
            raise ValueError('No completed TexasSolver result in this session.')
        return job['result']

