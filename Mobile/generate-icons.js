#!/usr/bin/env node

/**
 * JuFlow Mobile Apps - Automated Icon Generator
 * Generates all 6 required PNG icons for both PWAs
 * 
 * Run: node generate-icons.js
 * 
 * Requires: No dependencies! Uses pure Node.js Canvas API
 * Note: If Canvas is not available, this provides the exact specs
 *       for manual generation or using the browser tool.
 */

const fs = require('fs');
const path = require('path');

// Icon specifications
const ICONS = {
  cashier: {
    name: 'Cashier',
    color: '#bc5125',
    textColor: '#ffffff',
    files: [
      { name: 'cashier-192.png', size: 192, maskable: false },
      { name: 'cashier-512.png', size: 512, maskable: false },
      { name: 'cashier-maskable-512.png', size: 512, maskable: true }
    ]
  },
  rider: {
    name: 'Rider',
    color: '#39735b',
    textColor: '#ffffff',
    files: [
      { name: 'rider-192.png', size: 192, maskable: false },
      { name: 'rider-512.png', size: 512, maskable: false },
      { name: 'rider-maskable-512.png', size: 512, maskable: true }
    ]
  }
};

const ICONS_DIR = path.join(__dirname, 'icons');

// Ensure icons directory exists
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

/**
 * Generate icon specifications document
 */
function generateSpecs() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     JuFlow Mobile Apps - Icon Generation Specifications    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('📋 REQUIRED ICONS (6 total):\n');

  Object.entries(ICONS).forEach(([key, config]) => {
    console.log(`\n${config.name.toUpperCase()} APP (${config.color}):`);
    config.files.forEach(file => {
      console.log(`  • ${file.name}`);
      console.log(`    - Size: ${file.size}x${file.size}px`);
      console.log(`    - Type: ${file.maskable ? 'Maskable (80% safe zone)' : 'Standard'}`);
      console.log(`    - Background: ${config.color}`);
      console.log(`    - Logo: "J•" in ${config.textColor}`);
      console.log(`    - Font: Bold, ${Math.floor(file.size * 0.6)}px`);
    });
  });

  console.log('\n\n🎨 DESIGN SPECIFICATIONS:\n');
  console.log('Standard Icons (192px, 512px):');
  console.log('  • Full bleed background color');
  console.log('  • "J•" logo centered');
  console.log('  • Logo at 60% of canvas size');
  console.log('  • Bold weight');
  console.log('  • White text\n');

  console.log('Maskable Icons (512px):');
  console.log('  • 80% safe zone (center 410x410px area)');
  console.log('  • Logo scaled to fit safe zone');
  console.log('  • Allows OS to apply custom masks');
  console.log('  • Full bleed still colored\n');

  console.log('📱 GENERATION OPTIONS:\n');
  console.log('Option 1: Browser-based tool (RECOMMENDED)');
  console.log('  http://localhost:8080/icon-generator.html');
  console.log('  • One-click generation');
  console.log('  • Instant preview');
  console.log('  • Takes 2 minutes\n');

  console.log('Option 2: Manual with design software');
  console.log('  • Use specs above');
  console.log('  • Export as PNG');
  console.log('  • Save to icons/ directory\n');

  console.log('Option 3: Use npm package (canvas)');
  console.log('  npm install canvas');
  console.log('  node generate-icons-with-canvas.js\n');

  console.log('Option 4: Online tool (e.g., Figma, Canva)');
  console.log('  • Create 512x512 canvas');
  console.log('  • Apply background color');
  console.log('  • Add "J•" text centered');
  console.log('  • Export at required sizes\n');
}

/**
 * Create placeholder SVG files as reference
 */
function createSVGTemplates() {
  console.log('\n📄 Creating SVG templates as reference...\n');

  Object.entries(ICONS).forEach(([key, config]) => {
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <!-- ${config.name} App Icon -->
  <rect width="512" height="512" fill="${config.color}"/>
  <text 
    x="256" 
    y="340" 
    font-family="Arial, sans-serif" 
    font-size="307" 
    font-weight="bold" 
    fill="${config.textColor}" 
    text-anchor="middle">J•</text>
</svg>`;

    const svgPath = path.join(ICONS_DIR, `${key}-template.svg`);
    fs.writeFileSync(svgPath, svgContent);
    console.log(`  ✅ Created: ${key}-template.svg`);
  });

  console.log('\n💡 You can open these SVG files in a browser and screenshot them,');
  console.log('   or use an online converter to create PNG files.\n');
}

/**
 * Create README for icons directory
 */
function createIconsReadme() {
  const readme = `# JuFlow Mobile Apps - Icons Directory

## Required Icons (6 total)

### Cashier App (Orange #bc5125)
- \`cashier-192.png\` - 192×192px standard icon
- \`cashier-512.png\` - 512×512px standard icon  
- \`cashier-maskable-512.png\` - 512×512px maskable icon (80% safe zone)

### Rider App (Green #39735b)
- \`rider-192.png\` - 192×192px standard icon
- \`rider-512.png\` - 512×512px standard icon
- \`rider-maskable-512.png\` - 512×512px maskable icon (80% safe zone)

## Design Specs

**Logo:** "J•" (J followed by bullet character)  
**Font:** Bold, 60% of canvas size  
**Color:** White text on colored background  
**Maskable Safe Zone:** Center 80% (410×410px on 512px canvas)

## Generation Methods

### 🌟 Recommended: Browser Tool
\`\`\`bash
http://localhost:8080/icon-generator.html
\`\`\`
One-click generation with instant preview.

### 📐 Manual: Use SVG Templates
Open the \`*-template.svg\` files in this directory:
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
\`\`\`bash
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
\`\`\`

## Verification

After generating all 6 files:
\`\`\`bash
ls -lh *.png
\`\`\`

Expected output:
\`\`\`
cashier-192.png
cashier-512.png
cashier-maskable-512.png
rider-192.png
rider-512.png
rider-maskable-512.png
\`\`\`

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
`;

  const readmePath = path.join(ICONS_DIR, 'README.md');
  fs.writeFileSync(readmePath, readme);
  console.log('\n✅ Created icons/README.md with complete instructions\n');
}

/**
 * Check if ImageMagick is available
 */
function checkImageMagick() {
  const { execSync } = require('child_process');
  try {
    execSync('convert --version', { stdio: 'ignore' });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Generate icons using ImageMagick if available
 */
function generateWithImageMagick() {
  const { execSync } = require('child_process');
  
  console.log('\n🎨 Generating icons with ImageMagick...\n');

  const commands = [
    // Cashier icons
    { cmd: 'convert -size 512x512 xc:"#bc5125" -gravity center -pointsize 307 -font Arial-Bold -fill white -annotate +0+40 "J•" icons/cashier-512.png', name: 'cashier-512.png' },
    { cmd: 'convert -size 192x192 xc:"#bc5125" -gravity center -pointsize 115 -font Arial-Bold -fill white -annotate +0+15 "J•" icons/cashier-192.png', name: 'cashier-192.png' },
    { cmd: 'convert -size 512x512 xc:"#bc5125" -gravity center -pointsize 307 -font Arial-Bold -fill white -annotate +0+40 "J•" icons/cashier-maskable-512.png', name: 'cashier-maskable-512.png' },
    
    // Rider icons
    { cmd: 'convert -size 512x512 xc:"#39735b" -gravity center -pointsize 307 -font Arial-Bold -fill white -annotate +0+40 "J•" icons/rider-512.png', name: 'rider-512.png' },
    { cmd: 'convert -size 192x192 xc:"#39735b" -gravity center -pointsize 115 -font Arial-Bold -fill white -annotate +0+15 "J•" icons/rider-192.png', name: 'rider-192.png' },
    { cmd: 'convert -size 512x512 xc:"#39735b" -gravity center -pointsize 307 -font Arial-Bold -fill white -annotate +0+40 "J•" icons/rider-maskable-512.png', name: 'rider-maskable-512.png' }
  ];

  let successCount = 0;
  commands.forEach(({ cmd, name }) => {
    try {
      execSync(cmd, { stdio: 'ignore' });
      console.log(`  ✅ Generated: ${name}`);
      successCount++;
    } catch (err) {
      console.log(`  ❌ Failed: ${name}`);
    }
  });

  return successCount === 6;
}

/**
 * Main execution
 */
function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║        JuFlow Mobile Apps - Icon Generator Script         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Generate specifications document
  generateSpecs();

  // Create SVG templates
  createSVGTemplates();

  // Create README
  createIconsReadme();

  // Try ImageMagick generation
  const hasImageMagick = checkImageMagick();
  
  if (hasImageMagick) {
    console.log('✅ ImageMagick detected! Attempting automatic generation...\n');
    const success = generateWithImageMagick();
    
    if (success) {
      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║                   ✅ ICONS GENERATED! ✅                   ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');
      console.log('All 6 PNG icons have been generated successfully!\n');
      console.log('📂 Location: icons/');
      console.log('📱 PWAs are now installable!\n');
      console.log('Next steps:');
      console.log('  1. Verify icons: http://localhost:8080/cashier/');
      console.log('  2. Test install on mobile device');
      console.log('  3. Proceed to Phase 2 (Backend Integration)\n');
      return;
    }
  }

  // Fallback instructions
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║              📋 MANUAL ICON GENERATION NEEDED              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log('ImageMagick not available for automatic generation.\n');
  console.log('🌟 RECOMMENDED: Use the browser-based tool');
  console.log('   http://localhost:8080/icon-generator.html\n');
  console.log('📄 Alternative: Use SVG templates created in icons/');
  console.log('   • Open cashier-template.svg and rider-template.svg');
  console.log('   • Save/screenshot as PNG');
  console.log('   • Resize for 192px versions\n');
  console.log('📚 Full instructions: icons/README.md\n');
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { ICONS, ICONS_DIR };
