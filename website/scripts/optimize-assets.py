"""Lossless source screenshots remain available; generate smaller display assets."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / "public" / "assets"
for path in sorted(root.glob("*.png")):
    with Image.open(path) as source:
        if path.stem == "logo":
            source.resize((32, 32), Image.Resampling.LANCZOS).save(root / "favicon.png")
            source.resize((180, 180), Image.Resampling.LANCZOS).save(root / "apple-touch-icon.png")
            continue
        for width in (768, 1280, 1920):
            if width > source.width:
                continue
            height = round(source.height * width / source.width)
            source.resize((width, height), Image.Resampling.LANCZOS).convert("RGB").save(
                root / f"{path.stem}-{width}.webp", format="WEBP", quality=88, method=6
            )
