#!/usr/bin/env python3

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SCALE = 4
SIZE = 512
CANVAS = SIZE * SCALE


def scaled(value: int) -> int:
    return value * SCALE


def make_icon() -> Image.Image:
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (scaled(24), scaled(32), scaled(488), scaled(496)),
        radius=scaled(112),
        fill=(3, 8, 26, 110),
    )
    image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(scaled(14))))

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (scaled(20), scaled(20), scaled(492), scaled(492)),
        radius=scaled(112),
        fill=(247, 249, 255, 255),
        outline=(223, 228, 244, 255),
        width=scaled(3),
    )

    colors = [
        (255, 73, 113, 225),
        (255, 111, 73, 225),
        (255, 169, 55, 225),
        (255, 216, 75, 225),
        (97, 212, 100, 225),
        (49, 202, 176, 225),
        (46, 174, 241, 225),
        (68, 119, 245, 225),
        (130, 91, 235, 225),
        (222, 77, 197, 225),
    ]

    for angle, color in zip(range(0, 360, 36), colors):
        petal = Image.new("RGBA", image.size, (0, 0, 0, 0))
        petal_draw = ImageDraw.Draw(petal)
        petal_draw.rounded_rectangle(
            (scaled(216), scaled(74), scaled(296), scaled(278)),
            radius=scaled(40),
            fill=color,
        )
        petal = petal.rotate(angle, resample=Image.Resampling.BICUBIC, center=(CANVAS // 2, CANVAS // 2))
        image.alpha_composite(petal)

    draw = ImageDraw.Draw(image)
    draw.ellipse(
        (scaled(216), scaled(216), scaled(296), scaled(296)),
        fill=(255, 255, 255, 248),
        outline=(238, 241, 250, 255),
        width=scaled(3),
    )
    draw.ellipse(
        (scaled(239), scaled(239), scaled(273), scaled(273)),
        fill=(250, 251, 255, 255),
        outline=(221, 226, 242, 255),
        width=scaled(3),
    )

    return image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def main() -> None:
    icon = make_icon()
    icon.save(ROOT / "icon.png", optimize=True)
    icon.resize((256, 256), Image.Resampling.LANCZOS).save(
        ROOT / "assets" / "immich-tv-logo.png",
        optimize=True,
    )


if __name__ == "__main__":
    main()
