#!/usr/bin/env python3
"""Collect installer assets and verify their build-provided SHA-256 manifests."""
import argparse
import hashlib
import json
import pathlib
import plistlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def expected_names():
    version = json.loads((ROOT / 'package.json').read_text())['version']
    with (ROOT / 'macos/Info.plist').open('rb') as stream:
        mac_version = plistlib.load(stream)['CFBundleShortVersionString']
    names = {
        f'Glass-Terminal-{version}-win-x64.exe',
        f'Glass-Terminal-{version}-linux-amd64.deb',
        f'Glass-Terminal-{version}-linux-x86_64.AppImage',
    }
    for architecture in ('arm64', 'x64'):
        for extension in ('dmg', 'zip'):
            names.add(f'Glass-Terminal-{version}-mac-{architecture}.{extension}')
    for architecture in ('arm64', 'x86_64'):
        for extension in ('dmg', 'pkg'):
            names.add(f'Glass-Terminal-Native-{mac_version}-{architecture}.{extension}')
    return names


def collect(source, destination):
    names = expected_names()
    files = {}
    checksums = {}
    for path in sorted(source.rglob('*')):
        if not path.is_file():
            continue
        if path.name.startswith('SHA256SUMS') and path.suffix == '.txt':
            for line in path.read_text(encoding='utf-8-sig').splitlines():
                if not line.strip():
                    continue
                match = re.fullmatch(r'([0-9a-fA-F]{64})\s+\*?(.+)', line.strip())
                if not match:
                    raise ValueError(f'Invalid checksum record in {path.name}')
                name = pathlib.PurePosixPath(match[2].replace('\\', '/')).name
                value = match[1].lower()
                if name in checksums and checksums[name] != value:
                    raise ValueError(f'Conflicting checksums for {name}')
                checksums[name] = value
        elif path.name in names:
            if path.name in files:
                raise ValueError(f'Duplicate installer: {path.name}')
            files[path.name] = path
    missing = names - files.keys()
    if missing:
        raise ValueError('Missing installers: ' + ', '.join(sorted(missing)))
    for name, path in files.items():
        if name not in checksums or digest(path) != checksums[name]:
            raise ValueError(f'Checksum verification failed: {name}')
    destination.mkdir(parents=True, exist_ok=True)
    for name, path in files.items():
        shutil.copy2(path, destination / name)
    manifest = ''.join(f'{checksums[name]}  {name}\n' for name in sorted(files))
    (destination / 'SHA256SUMS.txt').write_text(manifest, encoding='utf-8')
    return sorted(files)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    arguments = parser.parse_args()
    names = collect(arguments.input, arguments.output)
    print(f'Verified {len(names)} installers and wrote SHA256SUMS.txt.')
