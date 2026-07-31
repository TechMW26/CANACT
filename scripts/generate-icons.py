#!/usr/bin/env python3
"""
Generate all app icons and splash screen from the new source SVG.
Usage: python3 scripts/generate-icons.py
"""

import os
from pathlib import Path
from PIL import Image, ImageOps

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ICON_SOURCE = PROJECT_ROOT / "Canact-appicon.png"
ASSETS_DIR = PROJECT_ROOT / "assets"
PUBLIC_DIR = PROJECT_ROOT / "public"
APP_DIR = PROJECT_ROOT / "src" / "app"
ANDROID_RES = PROJECT_ROOT / "android" / "app" / "src" / "main" / "res"

# ---------------------------------------------------------------------------
# 1. Load source PNG
# ---------------------------------------------------------------------------
def load_source_png(png_path: Path) -> Image.Image:
    return Image.open(png_path)

# ---------------------------------------------------------------------------
# 2. Save master source PNG to assets/
# ---------------------------------------------------------------------------
def save_master_source(master: Image.Image):
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    # Save full source
    source_path = ASSETS_DIR / "icon-source.png"
    master.save(source_path, "PNG")
    print(f"  ✓ Saved source: {source_path} ({master.size})")

    # Also save a 1024x1024 square version for capacitor assets generate
    icon_source = master.copy()
    # Crop to square from center
    w, h = icon_source.size
    sz = min(w, h)
    left = (w - sz) // 2
    top = (h - sz) // 2
    icon_source = icon_source.crop((left, top, left + sz, top + sz))
    icon_source = icon_source.resize((1024, 1024), Image.LANCZOS)
    icon_1024_path = ASSETS_DIR / "icon-1024.png"
    icon_source.save(icon_1024_path, "PNG")
    print(f"  ✓ Saved 1024x1024 icon: {icon_1024_path}")
    
    # Save splash source (2732x2732 for Android 12+)
    splash_source = master.copy()
    w, h = splash_source.size
    sz = min(w, h)
    left = (w - sz) // 2
    top = (h - sz) // 2
    splash_source = splash_source.crop((left, top, left + sz, top + sz))
    splash_source = splash_source.resize((2732, 2732), Image.LANCZOS)
    splash_path = ASSETS_DIR / "splash-source.png"
    splash_source.save(splash_path, "PNG")
    print(f"  ✓ Saved splash source: {splash_path}")
    
    return master, icon_source, splash_source

# ---------------------------------------------------------------------------
# 3. Android mipmap icons
# ---------------------------------------------------------------------------
ANDROID_SIZES = {
    "mipmap-ldpi": 36,
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

def generate_android_mipmaps(icon_source: Image.Image):
    for folder, size in ANDROID_SIZES.items():
        dir_path = ANDROID_RES / folder
        dir_path.mkdir(parents=True, exist_ok=True)
        resized = icon_source.resize((size, size), Image.LANCZOS)
        
        # ic_launcher.png
        resized.save(dir_path / "ic_launcher.png", "PNG")
        # ic_launcher_round.png (same for now)
        resized.save(dir_path / "ic_launcher_round.png", "PNG")
        # ic_notification.png (same source)
        resized.save(dir_path / "ic_notification.png", "PNG")
        print(f"  ✓ {folder}: {size}x{size}")

# ---------------------------------------------------------------------------
# 4. PWA / Web icons
# ---------------------------------------------------------------------------
PWA_SIZES = {
    "favicon-32.png": 32,
    "icon-32.png": 32,
    "icon-192.png": 192,
    "icon-256.png": 256,
    "icon-384.png": 384,
    "icon-512.png": 512,
    "apple-touch-icon.png": 180,
}

def generate_pwa_icons(icon_source: Image.Image):
    for filename, size in PWA_SIZES.items():
        resized = icon_source.resize((size, size), Image.LANCZOS)
        resized.save(PUBLIC_DIR / filename, "PNG")
        print(f"  ✓ public/{filename}: {size}x{size}")

# ---------------------------------------------------------------------------
# 5. Next.js app icons
# ---------------------------------------------------------------------------
def generate_next_icons(icon_source: Image.Image):
    # icon.png - 512x512
    icon_512 = icon_source.resize((512, 512), Image.LANCZOS)
    icon_512.save(APP_DIR / "icon.png", "PNG")
    print(f"  ✓ src/app/icon.png: 512x512")
    
    # apple-icon.png - 180x180
    apple = icon_source.resize((180, 180), Image.LANCZOS)
    apple.save(APP_DIR / "apple-icon.png", "PNG")
    print(f"  ✓ src/app/apple-icon.png: 180x180")

# ---------------------------------------------------------------------------
# 6. Public branding assets
# ---------------------------------------------------------------------------
def generate_branding_assets(icon_source: Image.Image, splash_source: Image.Image):
    # Canact - appicon.png (keep same size as current)
    appicon = icon_source.resize((1024, 1024), Image.LANCZOS)
    appicon.save(PUBLIC_DIR / "Canact - appicon.png", "PNG")
    print(f"  ✓ public/Canact - appicon.png: 1024x1024")

# ---------------------------------------------------------------------------
# 7. Android splash drawable
# ---------------------------------------------------------------------------
def generate_android_splash(splash_source: Image.Image):
    # drawable/splash.png - 1280x720 (common splash size)
    for folder in ["drawable", "drawable-night"]:
        dir_path = ANDROID_RES / folder
        dir_path.mkdir(parents=True, exist_ok=True)
        splash = splash_source.copy()
        splash = splash.resize((1280, 720), Image.LANCZOS)
        splash.save(dir_path / "splash.png", "PNG")
        print(f"  ✓ {folder}/splash.png: 1280x720")

# ---------------------------------------------------------------------------
# 8. Notification icon (drawable)
# ---------------------------------------------------------------------------
def generate_notification_drawable(icon_source: Image.Image):
    # drawable/canact_notification_icon.png
    notif = icon_source.resize((96, 96), Image.LANCZOS)
    notif.save(ANDROID_RES / "drawable" / "canact_notification_icon.png", "PNG")
    print(f"  ✓ drawable/canact_notification_icon.png: 96x96")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("🔧 Loading source PNG...")
    master = load_source_png(ICON_SOURCE)

    print("\n📦 Saving master source assets...")
    master, icon_source, splash_source = save_master_source(master)
    print("\n🤖 Generating Android mipmap icons...")
    generate_android_mipmaps(icon_source)
    
    print("\n🌐 Generating PWA/web icons...")
    generate_pwa_icons(icon_source)
    
    print("\n⚡ Generating Next.js app icons...")
    generate_next_icons(icon_source)
    
    print("\n🏷️  Generating branding assets...")
    generate_branding_assets(icon_source, splash_source)
    
    print("\n📱 Generating Android splash drawables...")
    generate_android_splash(splash_source)
    
    print("\n🔔 Generating notification drawable...")
    generate_notification_drawable(icon_source)
    
    print("\n✅ All icons generated successfully!")

if __name__ == "__main__":
    main()
