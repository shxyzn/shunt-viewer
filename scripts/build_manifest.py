#!/usr/bin/env python3
"""Index shunt_data and prepare patch-based locations for a static demo."""
import argparse
import json
import re
from pathlib import Path

SUPPORTED = {'.png', '.jpg', '.jpeg', '.webp', '.bmp'}
LEVEL = re.compile(r'(?<![\d.])(0\.5|1\.0|1\.5|2\.0|2\.5)$')
ROLE = re.compile(r'(^|[_\s-])(anterior|lateral|ap|lat|images_patch|patch|crop)(?=$|[_\s-])', re.I)
STRATA_VIEW = re.compile(r'(^|/)(strata_\d+_\d{8}_\d+)(?:0000_A|0001_L)_?$', re.I)

def case_key(relative):
    stem = str(relative.with_suffix('')).replace('\\', '/')
    stem = LEVEL.sub('', stem)
    stem = STRATA_VIEW.sub(r'\g<1>\g<2>', stem)
    return re.sub(r'[_\s-]+', '_', ROLE.sub('_', stem).strip('_ -\t')).lower()

def locate_patch(original_path, patch_path):
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None
    try:
        original = cv2.imdecode(np.fromfile(original_path, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
        patch = cv2.imdecode(np.fromfile(patch_path, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
        if original is None or patch is None or patch.std() < 3:
            return None
        scale = min(1.0, 960 / max(original.shape))
        original = cv2.resize(original, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        oh, ow = original.shape
        best = None
        for multiplier in [.25, .33, .5, .67, 1, 1.33, 1.75, 2.25]:
            w = round(patch.shape[1] * scale * multiplier)
            h = round(patch.shape[0] * scale * multiplier)
            if min(w, h) < 10 or w > ow * .9 or h > oh * .9:
                continue
            template = cv2.resize(patch, (w, h), interpolation=cv2.INTER_AREA)
            if template.std() < 3:
                continue
            matched = cv2.matchTemplate(original, template, cv2.TM_CCOEFF_NORMED)
            _, score, _, (x, y) = cv2.minMaxLoc(matched)
            if best is None or score > best['score']:
                best = {'score': float(score), 'x': x, 'y': y, 'w': w, 'h': h}
        if best is None or best['score'] < .55:
            return None
        # The valve is near the center of images_patch. This is a demo estimate,
        # not a measured bounding box. The viewer supports manual correction.
        b = best
        return {'roi': [round((b['x'] + .25*b['w'])/ow, 6), round((b['y'] + .2*b['h'])/oh, 6), round(.5*b['w']/ow, 6), round(.6*b['h']/oh, 6)], 'roiSource': 'patch-match', 'matchScore': round(b['score'], 4)}
    except (ValueError, OSError, cv2.error):
        return None

def build(root):
    dataset = root / 'shunt_data'
    cases = {}
    warnings = []
    for folder, view in [('anterior', 'ap'), ('lateral', 'lateral')]:
        for group, kind in [('images', 'image'), ('images_patch', 'patch')]:
            directory = dataset / folder / group
            if not directory.exists():
                continue
            for path in sorted(directory.rglob('*')):
                if not path.is_file() or path.name.startswith('.'):
                    continue
                if path.suffix.lower() not in SUPPORTED:
                    warnings.append(f'Unsupported image: {path.relative_to(root)}')
                    continue
                key = case_key(path.relative_to(directory))
                if not key:
                    warnings.append(f'Missing case identifier: {path.name}')
                    continue
                c = cases.setdefault(key, {'key': key, 'views': {'ap': {}, 'lateral': {}}, '_levels': set(), 'errors': []})
                if kind in c['views'][view]:
                    c['errors'].append('동일 사례의 중복 파일')
                    continue
                c['views'][view][kind] = path.relative_to(root).as_posix()
                if kind == 'image':
                    c['views'][view]['filename'] = path.name
                level = LEVEL.search(path.stem)
                if level:
                    c['_levels'].add(float(level.group(1)))
    result = []
    for index, c in enumerate(sorted(cases.values(), key=lambda c: c['key']), 1):
        levels = c.pop('_levels')
        c['id'] = f'CASE {index:03d}'
        c['level'] = next(iter(levels)) if len(levels) == 1 else None
        if len(levels) > 1:
            c['errors'].append('AP/LAT/패치의 단계 값이 서로 다름')
        c['complete'] = bool(c['views']['ap'].get('image') and c['views']['lateral'].get('image'))
        if not c['complete']:
            c['errors'].append('AP 또는 LAT 원본 누락')
        for view in c['views'].values():
            if view.get('image') and view.get('patch'):
                location = locate_patch(root / view['image'], root / view['patch'])
                if location:
                    view.update(location)
        if c['errors']:
            warnings.append(c['key'] + ': ' + ', '.join(c['errors']))
        result.append(c)
    return {'version': 1, 'cases': result, 'warnings': warnings}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    output = args.output or args.root / 'data' / 'manifest.json'
    manifest = build(args.root.resolve())
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Indexed {len(manifest["cases"])} cases; {len(manifest["warnings"])} warnings.')
    for message in manifest['warnings']:
        print(message)

if __name__ == '__main__':
    main()
