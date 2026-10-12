# JuFlow Mobile Apps - Icons Directory

## Required Icons (6 total)

### Cashier App (Orange #bc5125)
- `cashier-192.png` - 192×192px standard icon
- `cashier-512.png` - 512×512px standard icon  
- `cashier-maskable-512.png` - 512×512px maskable icon (80% safe zone)

### Rider App (Green #39735b)
- `rider-192.png` - 192×192px standard icon
- `rider-512.png` - 512×512px standard icon
- `rider-maskable-512.png` - 512×512px maskable icon (80% safe zone)

## Design Specs

**Logo:** "J•" (J followed by bullet character)  
**Font:** Bold, 60% of canvas size  
**Color:** White text on colored background  
**Maskable Safe Zone:** Center 80% (410×410px on 512px canvas)

## Generation Methods

### 🌟 Recommended: Browser Tool
```bash
http://localhost:8080/icon-generator.html
```
One-click generation with instant preview.

### 📐 Manual: Use SVG Templates
Open the `*-template.svg` files in this directory:
1. Open in browser (Chrome/Firefox)
2. Take screenshot or use "Save as PNG"
3. Resize if needed (to 192px for small icons)
4. Rename and save here

### 🎨 Design Software
Use Figma, Photoshop, Canva, or similar:
1. Create canvas (512×512px or 192×192px)
2. Fill with background color
3. Add "J•" text centered, bold, white
4. For maskable: keep logo in center 80%
5. Export as PNG

### 🔧 Command Line (ImageMagick)
```bash
# Cashier 512px
convert -size 512x512 xc:"#bc5125" -gravity center -pointsize 307 -font Arial-Bold -fill white -annotate +0+40 "J•" cashier-512.png

# Cashier 192px  
convert -size 192x192 xc:"#bc5125" -gravity center -pointsize 115 -font Arial-Bold -fill white -annotate +0+15 "J•" cashier-192.png

# Rider 512px
convert -size 512x512 xc:"#39735b" -gravity center -pointsize 307 -font Arial-Bold -fill white -annotate +0+40 "J•" rider-512.png

# Rider 192px
convert -size 192x192 xc:"#39735b" -gravity center -pointsize 115 -font Arial-Bold -fill white -annotate +0+15 "J•" rider-192.png

# For maskable versions, same command
# (Safe zone is visual guideline, actual rendering keeps logo centered)
```

## Verification

After generating all 6 files:
```bash
ls -lh *.png
```

Expected output:
```
cashier-192.png
cashier-512.png
cashier-maskable-512.png
rider-192.png
rider-512.png
rider-maskable-512.png
```

All PNG files should be present and properly sized.

## Next Steps

Once icons are generated:
1. Test PWA installation on mobile device
2. Verify icons appear correctly on home screen
3. Check maskable icons with different OS masks
4. Proceed to Phase 2 (Backend Integration)

---

**Status:** Icons directory ready  
**Generated:** $(date)  
**Files needed:** 6 PNG files  
**Recommended method:** http://localhost:8080/icon-generator.html
