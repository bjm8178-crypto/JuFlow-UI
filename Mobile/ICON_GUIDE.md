# JuFlow Mobile Apps - Icon Generation Guide

## Overview

This guide explains how to generate the required app icons for both Cashier and Rider PWAs. You'll need icons in multiple sizes for optimal display across devices and contexts.

## Required Icons

### Cashier App (Orange Theme)
- **Primary color:** #bc5125 (burnt orange)
- **Package name:** `ph.jukitchen.cashier`
- **Files needed:**
  - `cashier-192.png` - 192×192px (standard icon)
  - `cashier-512.png` - 512×512px (high-res icon)
  - `cashier-maskable-512.png` - 512×512px (maskable/adaptive icon)

### Rider App (Green Theme)
- **Primary color:** #39735b (forest green)
- **Package name:** `ph.jukitchen.rider`
- **Files needed:**
  - `rider-192.png` - 192×192px (standard icon)
  - `rider-512.png` - 512×512px (high-res icon)
  - `rider-maskable-512.png` - 512×512px (maskable/adaptive icon)

## Design Specifications

### Standard Icons (192px, 512px)

**Cashier App Design:**
```
Background: Solid #bc5125 (burnt orange)
Foreground: White "J•" mark
Font: Bold, sans-serif
Size: 60% of icon dimensions
Centered
Optional: Small "POS" or "CASHIER" label at bottom
```

**Rider App Design:**
```
Background: Solid #39735b (forest green)
Foreground: White "J•" mark
Font: Bold, sans-serif
Size: 60% of icon dimensions
Centered
Optional: Small motorcycle/delivery icon or "RIDER" label
```

### Maskable Icons (512px)

Maskable icons support Android's adaptive icon system. They must have:
- **Safe zone:** 80% of icon dimensions (410px diameter for 512px icon)
- **Bleed area:** Full 512×512px with background color extending to edges
- **No text or important elements outside safe zone**

**Design approach:**
1. Create a 512×512px square
2. Fill entire square with brand color
3. Center "J•" mark within a 410px circle (80% safe zone)
4. Make "J•" mark slightly larger than standard icons (65-70% of safe zone)
5. Optionally add subtle gradient or texture

## Generation Methods

### Method 1: Online Tools (Easiest)

**PWA Asset Generator:**
1. Go to https://www.pwabuilder.com/imageGenerator
2. Upload a 512×512px source image
3. Select "Generate for Web Manifest"
4. Download the generated icons
5. Rename to match JuFlow naming convention

**Favicon.io:**
1. Go to https://favicon.io/favicon-generator/
2. Configure:
   - Text: "J•"
   - Background: #bc5125 or #39735b
   - Font: Bold sans-serif
   - Font Size: 100
3. Generate and download
4. Resize using ImageMagick or online tool

### Method 2: Figma/Adobe Illustrator (Best Quality)

**Step-by-step in Figma:**

1. **Create artboards:**
   - New file → Create three artboards: 192×192, 512×512, 512×512
   - Name them: `cashier-192`, `cashier-512`, `cashier-maskable-512`

2. **Design standard icon (192px):**
   - Draw rectangle 192×192, fill #bc5125
   - Add text "J•" in white, bold sans-serif
   - Font size ~120px, centered
   - Optional: Add "POS" label at bottom (14px, white, 70% opacity)

3. **Design 512px version:**
   - Copy 192px design
   - Scale everything proportionally to 512px artboard
   - Font size ~320px
   - Ensure edges are crisp

4. **Design maskable version:**
   - Copy 512px design
   - Draw 410px circle (80% safe zone) as guide
   - Ensure "J•" mark fits entirely within circle
   - Increase mark size to ~350px
   - Remove circle guide before export
   - Verify no critical elements outside safe zone

5. **Export:**
   - Select all artboards
   - Export → PNG
   - Quality: 2x or "Best"
   - Color profile: sRGB

6. **Repeat for Rider app** with green theme (#39735b)

### Method 3: ImageMagick CLI (For Developers)

Create a simple script to generate icons programmatically:

```bash
#!/bin/bash
# generate-icons.sh - Generate JuFlow app icons

# Cashier icons (orange)
convert -size 192x192 xc:"#bc5125" \
  -gravity center \
  -pointsize 120 \
  -font "Arial-Bold" \
  -fill white \
  -annotate +0+0 "J•" \
  icons/cashier-192.png

convert -size 512x512 xc:"#bc5125" \
  -gravity center \
  -pointsize 320 \
  -font "Arial-Bold" \
  -fill white \
  -annotate +0+0 "J•" \
  icons/cashier-512.png

# Cashier maskable (with safe zone)
convert -size 512x512 xc:"#bc5125" \
  -gravity center \
  -pointsize 280 \
  -font "Arial-Bold" \
  -fill white \
  -annotate +0+0 "J•" \
  icons/cashier-maskable-512.png

# Rider icons (green)
convert -size 192x192 xc:"#39735b" \
  -gravity center \
  -pointsize 120 \
  -font "Arial-Bold" \
  -fill white \
  -annotate +0+0 "J•" \
  icons/rider-192.png

convert -size 512x512 xc:"#39735b" \
  -gravity center \
  -pointsize 320 \
  -font "Arial-Bold" \
  -fill white \
  -annotate +0+0 "J•" \
  icons/rider-512.png

# Rider maskable (with safe zone)
convert -size 512x512 xc:"#39735b" \
  -gravity center \
  -pointsize 280 \
  -font "Arial-Bold" \
  -fill white \
  -annotate +0+0 "J•" \
  icons/rider-maskable-512.png

echo "✓ Icons generated in icons/ directory"
```

Usage:
```bash
chmod +x generate-icons.sh
./generate-icons.sh
```

### Method 4: Canvas HTML Generator

Create `icon-generator.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>JuFlow Icon Generator</title>
</head>
<body>
  <h1>JuFlow Icon Generator</h1>
  <button onclick="generateIcons()">Generate All Icons</button>
  <div id="previews"></div>

  <script>
    function generateIcon(size, bgColor, text, filename, isMaskable = false) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // Background
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);

      // Text
      const fontSize = isMaskable ? size * 0.55 : size * 0.62;
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, size / 2, size / 2);

      // Preview
      const preview = document.createElement('div');
      preview.innerHTML = `<p>${filename}</p>`;
      preview.appendChild(canvas);
      document.getElementById('previews').appendChild(preview);

      // Download link
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.textContent = 'Download ' + filename;
        a.style.display = 'block';
        preview.appendChild(a);
      });
    }

    function generateIcons() {
      document.getElementById('previews').innerHTML = '';

      // Cashier icons (orange)
      generateIcon(192, '#bc5125', 'J•', 'cashier-192.png');
      generateIcon(512, '#bc5125', 'J•', 'cashier-512.png');
      generateIcon(512, '#bc5125', 'J•', 'cashier-maskable-512.png', true);

      // Rider icons (green)
      generateIcon(192, '#39735b', 'J•', 'rider-192.png');
      generateIcon(512, '#39735b', 'J•', 'rider-512.png');
      generateIcon(512, '#39735b', 'J•', 'rider-maskable-512.png', true);
    }
  </script>

  <style>
    body { font-family: system-ui; padding: 20px; }
    #previews > div { margin: 20px 0; padding: 20px; border: 1px solid #ddd; }
    canvas { border: 1px solid #ccc; margin: 10px 0; }
    a { margin: 5px 0; padding: 8px 16px; background: #007bff; color: white; text-decoration: none; display: inline-block; border-radius: 4px; }
  </style>
</body>
</html>
```

Open in browser and click "Generate All Icons" to download.

## Validation Checklist

After generating icons, verify:

- [ ] **File sizes:** All files < 50 KB (preferably < 30 KB)
- [ ] **Dimensions:** Exactly 192×192 or 512×512 pixels
- [ ] **Format:** PNG with transparency support (even if not using transparency)
- [ ] **Color profile:** sRGB
- [ ] **Compression:** Optimized (use tools like TinyPNG or ImageOptim)
- [ ] **Maskable safe zone:** Critical content within 80% circle
- [ ] **Contrast:** White text legible on brand color background
- [ ] **Consistency:** Both apps use same "J•" mark styling

## Testing Icons

### In Browser (PWA Manifest)
1. Deploy icons to `/icons/` directory
2. Update manifest files (already configured)
3. Open app in Chrome on Android
4. Check Chrome DevTools → Application → Manifest
5. Verify icons load correctly

### Maskable Icon Testing
1. Go to https://maskable.app/editor
2. Upload your maskable icon
3. Adjust safe zone slider to verify content stays visible
4. Test with different mask shapes (circle, squircle, rounded square)

### Installation Testing
1. Install PWA on Android device
2. Check home screen icon appearance
3. Verify splash screen uses correct icon
4. Check app switcher/recent apps icon

## Optimization

After generating, optimize file sizes:

```bash
# Using ImageOptim (macOS)
imageoptim icons/*.png

# Using pngquant (cross-platform)
pngquant --quality=80-95 --ext .png --force icons/*.png

# Using TinyPNG CLI
tinypng icons/*.png
```

Target sizes:
- 192px icons: < 10 KB
- 512px icons: < 30 KB
- Maskable icons: < 35 KB

## Troubleshooting

**Icon doesn't appear on install:**
- Check manifest.webmanifest `icons` array
- Verify icon file path is correct and accessible
- Ensure MIME type is `image/png`
- Clear browser cache and reinstall

**Maskable icon gets cropped:**
- Ensure content is within 80% safe zone (410px circle for 512px icon)
- Test with https://maskable.app/editor
- Add more padding if necessary

**Icon looks pixelated:**
- Generate at 2x size then downscale
- Use vector graphics (SVG) as source if possible
- Ensure anti-aliasing is enabled during export

**Wrong color on splash screen:**
- Check `theme_color` and `background_color` in manifest
- Ensure they match icon background

## Final Delivery

Place all generated icons in:
```
Mobile/icons/
├── cashier-192.png
├── cashier-512.png
├── cashier-maskable-512.png
├── rider-192.png
├── rider-512.png
└── rider-maskable-512.png
```

Total: 6 files, ~100-150 KB combined.

## Alternative: Use Existing Brand Assets

If JuFlow already has:
- Logo files
- Brand guidelines
- Design system

Contact the design team to generate icons following this spec. Provide them with:
- This guide
- Target dimensions (192px, 512px)
- Maskable safe zone requirement (80%)
- Brand colors (#bc5125 cashier, #39735b rider)
- Naming convention

---

**Next steps:** After generating icons, proceed to [DEPLOYMENT.md](./DEPLOYMENT.md) for integration and testing instructions.
