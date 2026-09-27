#!/usr/bin/env python3
"""Create small case-list previews and full-resolution WebP views for Pages."""

import json
from pathlib import Path

from PIL import Image, ImageOps


def prepare(root: Path) -> tuple[int, int, int]:
    manifest_path = root / 'data' / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    original_dir = root / 'data' / 'web' / 'original'
    thumb_dir = root / 'data' / 'web' / 'thumb'
    original_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)

    original_bytes = web_bytes = image_count = 0
    for case in manifest['cases']:
        case_id = case['id'].replace(' ', '').lower()
        for view_name in ('ap', 'lateral'):
            view = case['views'][view_name]
            source = view.get('image')
            if not source:
                continue
            source_path = root / source
            original_path = original_dir / f'{case_id}_{view_name}.webp'
            thumb_path = thumb_dir / f'{case_id}_{view_name}.webp'

            with Image.open(source_path) as opened:
                image = ImageOps.exif_transpose(opened)
                if image.mode not in ('L', 'RGB'):
                    image = image.convert('RGB')
                image.save(original_path, format='WEBP', quality=92, method=4)
                thumb = image.copy()
                thumb.thumbnail((160, 160), Image.Resampling.LANCZOS)
                thumb.save(thumb_path, format='WEBP', quality=75, method=4)

            original_bytes += source_path.stat().st_size
            web_bytes += original_path.stat().st_size + thumb_path.stat().st_size
            image_count += 1
            view['image'] = original_path.relative_to(root).as_posix()
            view['thumbnail'] = thumb_path.relative_to(root).as_posix()

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return image_count, original_bytes, web_bytes


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    count, before, after = prepare(root)
    print(f'Prepared {count} X-rays and thumbnails: {before / 2**20:.1f} MiB -> {after / 2**20:.1f} MiB')
