#!/usr/bin/env python3
"""
JuFlow Mobile Apps - Icon Generator (Python/Pillow)
Generates all 6 required PNG icons for both PWAs

Requirements: pip install pillow
Run: python generate-icons.py
"""

import os
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# Icon specifications
ICONS = {
    'cashier': {
        'color': '#bc5125',
        'text': 'J•',
        'sizes': [
            ('cashier-192.png', 192, False),
            ('cashier-512.png', 512, False),
            ('cashier-maskable-512.png', 512, True)
        ]
    },
    'rider': {
        'color': '#39735b',
        'text': 'J•',
        'sizes': [
            ('rider-192.png', 192, False),
            ('rider-512.png', 512, False),
            ('rider-maskable-512.png', 512, True)
        ]
    }
}

def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def generate_icon(filename, size, color, text, maskable=False):
    """Generate a single icon"""
    # Create image with background color
    img = Image.new('RGB', (size, size), hex_to_rgb(color))
    draw = ImageDraw.Draw(img)
    
    # Calculate font size (60% of canvas for standard, 48% for maskable safe zone)
    font_size = int(size * 0.48 if maskable else size * 0.6)
    
    try:
        # Try to use a bold system font
        font = ImageFont.truetype("arialbd.ttf", font_size)
    except:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
        except:
            try:
                font = ImageFont.truetype("Arial Bold.ttf", font_size)
            except:
                # Fallback to default font
                font = ImageFont.load_default()
    
    # Get text bounding box
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # Calculate position to center text
    x = (size - text_width) // 2 - bbox[0]
    y = (size - text_height) // 2 - bbox[1]
    
    # Draw text in white
    draw.text((x, y), text, fill='white', font=font)
    
    # Save image
    icons_dir = Path(__file__).parent / 'icons'
    icons_dir.mkdir(exist_ok=True)
    img.save(icons_dir / filename, 'PNG')
    
    return True

def main():
    print("\n" + "="*60)
    print("  JuFlow Mobile Apps - Icon Generator")
    print("="*60 + "\n")
    
    if not PIL_AVAILABLE:
        print("❌ Pillow not available.")
        print("\nTo install:")
        print("  pip install pillow")
        print("\nOr use alternative methods:")
        print("  1. Browser tool: http://localhost:8080/icon-generator.html")
        print("  2. SVG templates: icons/cashier-template.svg")
        print("  3. ImageMagick: see icons/README.md")
        return
    
    print("🎨 Generating icons...\n")
    
    success_count = 0
    total_count = 0
    
    for app_name, config in ICONS.items():
        for filename, size, maskable in config['sizes']:
            total_count += 1
            try:
                generate_icon(
                    filename, 
                    size, 
                    config['color'], 
                    config['text'],
                    maskable
                )
                print(f"  ✅ Generated: {filename}")
                success_count += 1
            except Exception as e:
                print(f"  ❌ Failed: {filename} - {str(e)}")
    
    print("\n" + "="*60)
    if success_count == total_count:
        print("  ✅ SUCCESS! All 6 icons generated!")
        print("="*60 + "\n")
        print("📂 Location: icons/")
        print("📱 PWAs are now installable!\n")
        print("Next steps:")
        print("  1. Start server: python -m http.server 8080")
        print("  2. Test cashier: http://localhost:8080/cashier/")
        print("  3. Test rider: http://localhost:8080/rider/")
        print("  4. Install on mobile device to verify icons\n")
    else:
        print(f"  ⚠️  Generated {success_count}/{total_count} icons")
        print("="*60 + "\n")
        print("Check errors above and try alternative methods.")
    
if __name__ == '__main__':
    main()
