const PortalThemes = {
  applyTheme(html, theme) {
    if (theme.id === 'default') {
      return this.applyDefault(html);
    }
    if (!theme.css) return html;
    const styleTag = `\n<style>\n${theme.css}\n</style>\n`;
    const themeMarkers = ['neonPulse', 'sunriseShift', 'snowfall'];
    let out = html;
    let replaced = false;
    let searchFrom = 0;
    while (true) {
      const styleStart = out.indexOf('<style', searchFrom);
      if (styleStart === -1) break;
      const styleEnd = out.indexOf('</style>', styleStart);
      if (styleEnd === -1) break;
      const block = out.substring(styleStart, styleEnd + 8);
      if (themeMarkers.some(marker => block.includes(marker))) {
        if (!replaced) {
          out = out.substring(0, styleStart) + styleTag.trim() + out.substring(styleEnd + 8);
          replaced = true;
          searchFrom = styleStart + styleTag.length;
        } else {
          let cleanStart = styleStart;
          while (cleanStart > 0 && (out[cleanStart - 1] === ' ' || out[cleanStart - 1] === '\t' || out[cleanStart - 1] === '\n')) {
            cleanStart--;
          }
          let cleanEnd = styleEnd + 8;
          while (cleanEnd < out.length && (out[cleanEnd] === '\n' || out[cleanEnd] === '\r')) {
            cleanEnd++;
          }
          out = out.substring(0, cleanStart) + out.substring(cleanEnd);
          searchFrom = cleanStart;
        }
      } else {
        searchFrom = styleEnd + 8;
      }
    }
    if (replaced) return out;
    const juanFiLink = /<link[^>]*href=["']assets\/css\/JuanFi\.css["'][^>]*>/i;
    if (juanFiLink.test(out)) {
      return out.replace(juanFiLink, styleTag);
    }
    return out.replace(/<\/head>/i, styleTag + '</head>');
  },

  applyDefault(html) {
    const juanFiLink = '\t<link rel="stylesheet" href="assets/css/JuanFi.css">\n';
    if (/<link[^>]*href=["']assets\/css\/JuanFi\.css["'][^>]*>/i.test(html)) {
      return html;
    }
    const headEnd = html.search(/<\/head\s*>/i);
    if (headEnd === -1) return html;
    const headSection = html.substring(0, headEnd);
    const tailSection = html.substring(headEnd);
    const themeMarkers = ['neonPulse', 'sunriseShift', 'snowfall'];
    let cleaned = headSection;
    let linkInserted = false;
    let searchFrom = 0;
    while (true) {
      const styleStart = cleaned.indexOf('<style', searchFrom);
      if (styleStart === -1) break;
      const styleEnd = cleaned.indexOf('</style>', styleStart);
      if (styleEnd === -1) break;
      const styleContent = cleaned.substring(styleStart, styleEnd + 8);
      const isThemeStyle = themeMarkers.some(marker => styleContent.includes(marker));
      if (isThemeStyle) {
        let cleanStart = styleStart;
        while (cleanStart > 0 && (cleaned[cleanStart - 1] === ' ' || cleaned[cleanStart - 1] === '\t' || cleaned[cleanStart - 1] === '\n')) {
          cleanStart--;
        }
        let cleanEnd = styleEnd + 8;
        while (cleanEnd < cleaned.length && (cleaned[cleanEnd] === '\n' || cleaned[cleanEnd] === '\r')) {
          cleanEnd++;
        }
        if (!linkInserted) {
          cleaned = cleaned.substring(0, cleanStart) + '\n' + juanFiLink + cleaned.substring(cleanEnd);
          linkInserted = true;
          searchFrom = cleanStart + 1 + juanFiLink.length;
        } else {
          cleaned = cleaned.substring(0, cleanStart) + cleaned.substring(cleanEnd);
          searchFrom = cleanStart;
        }
      } else {
        searchFrom = styleEnd + 8;
      }
    }
    if (!linkInserted) {
      return headSection + juanFiLink + tailSection;
    }
    return cleaned + tailSection;
  },

  themes: {
    default: {
      id: 'default',
      name: 'Default (JuanFi)',
      description: 'Original JuanFi dark theme',
      banner: 'linear-gradient(135deg, #191e2d 0%, #3d4044 50%, #57606f 100%)',
      swatches: ['#191e2d', '#ff4d4d', '#4cd137', '#f1c40f'],
      css: null,
    },

    gaming: {
      id: 'gaming',
      name: 'Gaming',
      description: 'Neon arcade with cyan and magenta glow',
      banner: 'linear-gradient(135deg, #0a0118 0%, #1a0b2e 40%, #3d0066 70%, #ff00ff 100%)',
      swatches: ['#0a0118', '#00ffff', '#ff00ff', '#ffff00'],
      css: `
body { background: linear-gradient(135deg, #0a0118 0%, #1a0b2e 50%, #0a0118 100%); }
body::before {
  content: ''; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background-image:
    linear-gradient(rgba(0, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 40px 40px; pointer-events: none; z-index: 0;
}
.container { background: rgba(15, 5, 35, 0.92); border: 2px solid #00ffff; box-shadow: 0 0 30px rgba(0, 255, 255, 0.4), inset 0 0 20px rgba(255, 0, 255, 0.1); position: relative; z-index: 1; }
.status-disconnected, .status-connected { border: 2px solid #ff00ff; color: #00ffff; text-shadow: 0 0 8px #00ffff; background: rgba(0, 0, 0, 0.5); }
.blinking1 { color: #ff00ff !important; text-shadow: 0 0 10px #ff00ff; }
.blinking2 { color: #00ffff !important; text-shadow: 0 0 10px #00ffff; }
.info { color: #00ffff; }
.info-title { color: #ffff00; border: 2px solid #ff00ff; background: rgba(0, 0, 0, 0.5); text-shadow: 0 0 8px #ffff00; }
.info-title img { filter: drop-shadow(0 0 3px #ffff00); }
.info-status { border: 2px solid #00ffff; background: rgba(0, 0, 0, 0.5); }
.break { background: linear-gradient(90deg, #00ffff 20%, #ff00ff 40%, #ffff00 60%, #00ffff 80%); box-shadow: 0 0 10px rgba(0, 255, 255, 0.6); }
.inscoin { border: 2px solid #00ffff; background: rgba(0, 0, 0, 0.6); box-shadow: inset 0 0 15px rgba(0, 255, 255, 0.2); }
.vcCodeHolder { border: 2px dashed #ff00ff; background: rgba(255, 0, 255, 0.08); }
.convertVoucherBlock { border: 2px dashed #00ffff; background: rgba(0, 255, 255, 0.08); }
.status-holder { color: #00ffff; text-shadow: 0 0 5px #00ffff; background: rgba(0, 0, 0, 0.5); }
#insertBtn {
  background: linear-gradient(90deg, #ff00ff, #00ffff);
  box-shadow: 0 0 15px #ff00ff, 0 0 25px rgba(0, 255, 255, 0.5);
  color: #fff; text-shadow: 0 0 8px #fff; border: 2px solid #fff;
  font-weight: 900; letter-spacing: 2px; text-transform: uppercase;
  animation: neonPulse 1.5s infinite alternate;
}
@keyframes neonPulse {
  from { box-shadow: 0 0 10px #ff00ff, 0 0 20px #00ffff; }
  to { box-shadow: 0 0 25px #ff00ff, 0 0 40px #00ffff, 0 0 60px #ff00ff; }
}
#promoRateBtn { background: #ffff00; color: #0a0118 !important; text-shadow: none !important; border: 2px solid #fff; box-shadow: 0 0 15px rgba(255, 255, 0, 0.6); font-weight: bold; }
#chargingBtn { background: #00ffff; color: #0a0118 !important; text-shadow: none !important; border: 2px solid #fff; box-shadow: 0 0 15px rgba(0, 255, 255, 0.6); font-weight: bold; }
#eloadBtn { background: #ff00ff; color: #fff !important; text-shadow: 0 0 5px #fff !important; border: 2px solid #fff; box-shadow: 0 0 15px rgba(255, 0, 255, 0.6); font-weight: bold; }
#memberLoginBtn { background: transparent; color: #00ffff !important; border: 2px solid #00ffff; box-shadow: 0 0 10px rgba(0, 255, 255, 0.5); text-shadow: 0 0 5px #00ffff !important; }
#connectBtn { background: linear-gradient(90deg, #00ffff, #ff00ff); color: #fff !important; border: 2px solid #fff; box-shadow: 0 0 15px rgba(0, 255, 255, 0.6); text-shadow: 0 0 5px #fff !important; font-weight: bold; }
#scanQrBtn { background: #ffff00; color: #0a0118 !important; text-shadow: none !important; border: 2px solid #fff; }
.form-group { border: 2px solid #00ffff; background: rgba(0, 0, 0, 0.5); box-shadow: inset 0 0 10px rgba(0, 255, 255, 0.15); }
.form-control, #vendoSelected { background: rgba(0, 0, 0, 0.7) !important; color: #00ffff !important; border: 1px solid #00ffff !important; box-shadow: inset 0 0 5px rgba(0, 255, 255, 0.3); }
.form-control::placeholder { color: rgba(0, 255, 255, 0.4) !important; }
.form-control:focus, #vendoSelected:focus { background: rgba(0, 0, 0, 0.9) !important; box-shadow: 0 0 10px #00ffff !important; }
#vendoSelectDiv { border: 2px solid #ff00ff; background: rgba(0, 0, 0, 0.5); box-shadow: 0 0 10px rgba(255, 0, 255, 0.3); }
#vendoSelectDiv label { color: #ffff00 !important; text-shadow: 0 0 5px #ffff00; }
.modal-content { background: #0a0118 !important; color: #00ffff !important; border: 2px solid #ff00ff; box-shadow: 0 0 30px rgba(255, 0, 255, 0.5); }
.modal-header, .modal-footer { border-color: #ff00ff !important; }
.modal-title { color: #ffff00 !important; text-shadow: 0 0 8px #ffff00; }
.modal-body { color: #00ffff !important; }
.close span { color: #ff00ff !important; text-shadow: 0 0 5px #ff00ff; }
.modal { z-index: 1500 !important; }
.modal-backdrop { pointer-events: none !important; opacity: 0.5 !important; }
.modal-content { position: relative !important; z-index: 1502 !important; }
.modal-content { display: flex !important; flex-direction: column !important; max-height: calc(100vh - 32px) !important; border: 2px solid #ff00ff !important; }
.modal-header, .modal-footer { flex-shrink: 0 !important; }
.modal-header { background: #1a0b2e !important; }
.modal-content .modal-header .close span { color: #ff00ff !important; text-shadow: 0 0 5px #ff00ff; }
.modal-body { overflow-y: auto !important; min-height: 0 !important; flex: 1 !important; }
.modal-body .inscoinholder { height: 50px !important; margin-top: 10px !important; }
.modal-body .vcCodeHolder { height: 90px !important; }
.modal-body .convertVoucherBlock { height: 142px !important; }
.inscoinholder { background: rgba(0, 0, 0, 0.5) !important; }
.vcCodeHolder { background: rgba(255, 0, 255, 0.08) !important; }
.convertVoucherBlock { background: rgba(0, 255, 255, 0.08) !important; }
.inscoinholder span { color: #00ffff !important; }
.modal-footer.bg-light { background-color: #0a0118 !important; }
.btn-outline-danger { background: transparent !important; color: #ff0066 !important; border-color: #ff0066 !important; }
.btn-outline-danger:hover, .btn-outline-danger:focus, .btn-outline-danger:active { background: #ff0066 !important; color: #fff !important; }
.progress { background-color: rgba(0, 255, 255, 0.15) !important; }
.btn-primary { background: #ff00ff !important; border-color: #ff00ff !important; box-shadow: 0 0 10px rgba(255, 0, 255, 0.6); }
.btn-success { background: #00ffff !important; color: #0a0118 !important; border: none !important; box-shadow: 0 0 10px rgba(0, 255, 255, 0.6); }
.btn-danger { background: #ff0066 !important; border-color: #ff0066 !important; box-shadow: 0 0 10px rgba(255, 0, 102, 0.6); }
.btn-warning { background: #ffff00 !important; color: #0a0118 !important; border: none !important; box-shadow: 0 0 10px rgba(255, 255, 0, 0.6); }
.btn-info { background: #00ccff !important; color: #0a0118 !important; border: none !important; box-shadow: 0 0 10px rgba(0, 204, 255, 0.6); }
.btn-secondary { background: transparent !important; color: #00ffff !important; border: 1px solid #00ffff !important; }
.btn-default { background: transparent !important; color: #ff00ff !important; border: 1px solid #ff00ff !important; }
.footer { border: 2px solid #00ffff; color: #00ffff; background: rgba(0, 0, 0, 0.5); box-shadow: 0 0 10px rgba(0, 255, 255, 0.3); }
.footers a { color: #ffff00 !important; text-shadow: 0 0 5px #ffff00; }
.footers a:hover { color: #ff00ff !important; text-shadow: 0 0 8px #ff00ff; }
.memdiv { border: 2px solid #00ffff; background: rgba(0, 0, 0, 0.6); box-shadow: 0 0 15px rgba(0, 255, 255, 0.4); }
.memdiv input { background: rgba(0, 0, 0, 0.7); color: #00ffff; border: 1px solid #00ffff; }
.memdiv span { color: #ffff00 !important; }
.rholder { border-color: #ff00ff; background: linear-gradient(90deg, #ff00ff 8%, rgba(15, 5, 35, 0.9) 8%); box-shadow: 0 0 10px rgba(255, 0, 255, 0.4); }
.rdata { color: #00ffff; text-shadow: 0 0 5px #00ffff; }
#codeGenerated { color: #ffff00 !important; text-shadow: 0 0 10px #ffff00; }
#totalCoin, #totalTime, #expectedCoin { color: #00ffff !important; text-shadow: 0 0 8px #00ffff; }
.progress-bar { background: linear-gradient(90deg, #00ffff, #ff00ff) !important; box-shadow: 0 0 10px rgba(0, 255, 255, 0.6); }
#noticeText { color: #ffff00 !important; text-shadow: 0 0 8px #ffff00; }
#eloadConfirm, #eloadConfirm2 { color: #ffff00 !important; text-shadow: 0 0 8px #ffff00 !important; }
.input-bottom-space-20px { margin-bottom: 20px; }
.qrcode-wrapper { background: #fff; box-shadow: 0 0 20px #00ffff; }
      `.trim(),
    },

    sunrise: {
      id: 'sunrise',
      name: 'Sunrise',
      description: 'Warm dawn gradient with cozy cream card',
      banner: 'linear-gradient(135deg, #1e3c72 0%, #ff6b6b 40%, #feca57 80%, #ff9ff3 100%)',
      swatches: ['#ff6b6b', '#feca57', '#ff9ff3', '#2c1810'],
      css: `
body {
  background: linear-gradient(135deg, #1e3c72 0%, #ff6b6b 40%, #feca57 80%, #ff9ff3 100%);
  background-size: 400% 400%;
  animation: sunriseShift 20s ease infinite;
}
@keyframes sunriseShift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
.container {
  background: rgba(255, 253, 245, 0.96);
  border: 2px solid #fff5e6;
  box-shadow: 0 10px 40px rgba(255, 107, 107, 0.3);
  color: #2c1810;
}
.status-disconnected, .status-connected {
  border: 2px solid #ff9f43;
  color: #2c1810;
  background: rgba(255, 245, 230, 0.7);
  text-shadow: none;
}
.blinking1 { color: #ee5253 !important; }
.blinking2 { color: #10ac84 !important; }
.info { color: #2c1810; }
.info-title {
  color: #ee5253;
  border: 2px solid #ff9f43;
  background: rgba(255, 245, 230, 0.7);
  text-shadow: none;
}
.info-status { border: 2px solid #ff9f43; background: rgba(255, 245, 230, 0.5); }
.break {
  background: linear-gradient(90deg, #ff6b6b 20%, #feca57 40%, #ff9ff3 60%, #54a0ff 80%);
  box-shadow: 0 2px 8px rgba(255, 107, 107, 0.4);
}
.inscoin { border: 2px solid #ff9f43; background: rgba(255, 245, 230, 0.6); }
.vcCodeHolder { border: 2px dashed #ff6b6b; background: rgba(255, 245, 230, 0.8); }
.convertVoucherBlock { border: 2px dashed #feca57; background: rgba(255, 245, 230, 0.8); }
.status-holder { color: #2c1810; text-shadow: none; background: rgba(255, 245, 230, 0.5); }
#insertBtn {
  background: linear-gradient(90deg, #ff6b6b, #feca57);
  box-shadow: 0 4px 15px rgba(255, 107, 107, 0.5);
  color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  border: none; font-weight: bold; letter-spacing: 1px;
}
#promoRateBtn {
  background: #feca57; color: #2c1810 !important;
  text-shadow: none !important; border: none;
  box-shadow: 0 4px 12px rgba(254, 202, 87, 0.5);
}
#chargingBtn {
  background: #10ac84; color: #fff !important;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
  border: none; box-shadow: 0 4px 12px rgba(16, 172, 132, 0.5);
}
#eloadBtn {
  background: #54a0ff; color: #fff !important;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
  border: none; box-shadow: 0 4px 12px rgba(84, 160, 255, 0.5);
}
#memberLoginBtn {
  background: transparent; color: #ff6b6b !important;
  border: 2px solid #ff6b6b; text-shadow: none !important;
}
#connectBtn {
  background: linear-gradient(90deg, #ff6b6b, #ff9ff3);
  color: #fff !important; border: none;
  box-shadow: 0 4px 15px rgba(255, 107, 107, 0.5);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important; font-weight: bold;
}
#scanQrBtn { background: #feca57; color: #2c1810 !important; text-shadow: none !important; border: none; }
.form-group { border: 2px solid #ff9f43; background: rgba(255, 245, 230, 0.5); }
.form-control, #vendoSelected {
  background: #fffaf0 !important; color: #2c1810 !important;
  border: 1px solid #ff9f43 !important;
}
.form-control::placeholder { color: #b9886b !important; }
.form-control:focus, #vendoSelected:focus {
  background: #fff !important; border-color: #ff6b6b !important;
  box-shadow: 0 0 8px rgba(255, 107, 107, 0.3) !important;
}
#vendoSelectDiv { border: 2px solid #ff9f43; background: rgba(255, 245, 230, 0.5); }
#vendoSelectDiv label { color: #ee5253 !important; font-weight: bold; }
.modal-content {
  background: #fffdf5 !important; color: #2c1810 !important;
  border: 2px solid #ff9f43; box-shadow: 0 10px 40px rgba(255, 107, 107, 0.3);
}
.modal-header, .modal-footer { border-color: #ff9f43 !important; }
.modal-title { color: #ee5253 !important; }
.close span { color: #ee5253 !important; }
.modal { z-index: 1500 !important; }
.modal-backdrop { pointer-events: none !important; opacity: 0.5 !important; }
.modal-content { position: relative !important; z-index: 1502 !important; }
.modal-content { display: flex !important; flex-direction: column !important; max-height: calc(100vh - 32px) !important; border: 2px solid #ff9f43 !important; }
.modal-header, .modal-footer { flex-shrink: 0 !important; }
.modal-header { background: #fff5e6 !important; }
.modal-content .modal-header .close span { color: #ee5253 !important; }
.modal-body { overflow-y: auto !important; min-height: 0 !important; flex: 1 !important; }
.modal-body .inscoinholder { height: 50px !important; margin-top: 10px !important; }
.modal-body .vcCodeHolder { height: 90px !important; }
.modal-body .convertVoucherBlock { height: 142px !important; }
.inscoinholder { background: rgba(255, 245, 230, 0.6) !important; }
.vcCodeHolder { background: rgba(255, 245, 230, 0.8) !important; }
.convertVoucherBlock { background: rgba(255, 245, 230, 0.8) !important; }
.inscoinholder span { color: #b9886b !important; }
.modal-footer.bg-light { background-color: #fffaf0 !important; }
.btn-outline-danger { background: transparent !important; color: #ee5253 !important; border-color: #ee5253 !important; }
.btn-outline-danger:hover, .btn-outline-danger:focus, .btn-outline-danger:active { background: #ee5253 !important; color: #fff !important; }
.progress { background-color: #ffedd5 !important; }
.btn-primary { background: #ff6b6b !important; border-color: #ff6b6b !important; }
.btn-success { background: #10ac84 !important; border-color: #10ac84 !important; color: #fff !important; }
.btn-danger { background: #ee5253 !important; border-color: #ee5253 !important; }
.btn-warning { background: #feca57 !important; border-color: #feca57 !important; color: #2c1810 !important; }
.btn-info { background: #54a0ff !important; border-color: #54a0ff !important; color: #fff !important; }
.btn-secondary { background: transparent !important; color: #ff6b6b !important; border: 1px solid #ff6b6b !important; }
.btn-default { background: transparent !important; color: #ee5253 !important; border: 1px solid #ee5253 !important; }
.footer { border: 2px solid #ff9f43; color: #2c1810; background: rgba(255, 245, 230, 0.5); }
.footers a { color: #ee5253 !important; }
.footers a:hover { color: #ff6b6b !important; }
.memdiv { border: 2px solid #ff9f43; background: rgba(255, 245, 230, 0.7); box-shadow: 0 4px 15px rgba(255, 107, 107, 0.2); }
.memdiv input { background: #fffaf0; color: #2c1810; border: 1px solid #ff9f43; }
.memdiv span { color: #ee5253 !important; }
.rholder { border-color: #ff9f43; background: linear-gradient(90deg, #ff9f43 8%, rgba(255, 253, 245, 0.9) 8%); }
.rdata { color: #2c1810; text-shadow: none; }
#codeGenerated { color: #10ac84 !important; text-shadow: none; }
#totalCoin, #totalTime, #expectedCoin { color: #ee5253 !important; text-shadow: none; }
.progress-bar { background: linear-gradient(90deg, #ff6b6b, #feca57) !important; }
#noticeText { color: #ee5253 !important; }
#eloadConfirm, #eloadConfirm2 { color: #ee5253 !important; text-shadow: none !important; }
.qrcode-wrapper { background: #fff; box-shadow: 0 4px 15px rgba(255, 107, 107, 0.3); }
      `.trim(),
    },

    christmas: {
      id: 'christmas',
      name: 'Christmas',
      description: 'Festive green with falling snow and red/gold trim',
      banner: 'linear-gradient(135deg, #0d3b2e 0%, #1e5c47 40%, #c0392b 75%, #f1c40f 100%)',
      swatches: ['#0d3b2e', '#c0392b', '#f1c40f', '#ffffff'],
      css: `
body {
  background: linear-gradient(180deg, #0d3b2e 0%, #1e5c47 50%, #0d3b2e 100%);
  position: relative; overflow-x: hidden;
}
body::before {
  content: ''; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background-image:
    radial-gradient(2px 2px at 20px 30px, #fff, transparent),
    radial-gradient(2px 2px at 40px 70px, #fff, transparent),
    radial-gradient(1px 1px at 90px 40px, #fff, transparent),
    radial-gradient(2px 2px at 130px 80px, #fff, transparent),
    radial-gradient(1px 1px at 160px 30px, #fff, transparent);
  background-size: 200px 100px;
  animation: snowfall 8s linear infinite;
  pointer-events: none; z-index: 0; opacity: 0.7;
}
@keyframes snowfall {
  0% { background-position: 0 0; }
  100% { background-position: 200px 400px; }
}
.container {
  background: rgba(255, 253, 245, 0.97);
  border: 3px solid #c0392b;
  box-shadow: 0 0 30px rgba(192, 57, 43, 0.4), 0 0 60px rgba(241, 196, 15, 0.2);
  position: relative; z-index: 1; color: #2c1810;
}
.status-disconnected, .status-connected {
  border: 2px solid #c0392b; color: #2c1810;
  background: rgba(255, 245, 230, 0.7); text-shadow: none;
}
.blinking1 { color: #c0392b !important; }
.blinking2 { color: #27ae60 !important; }
.info { color: #2c1810; }
.info-title {
  color: #c0392b; border: 2px solid #f1c40f;
  background: rgba(255, 245, 230, 0.7); text-shadow: none;
}
.info-status { border: 2px solid #c0392b; background: rgba(255, 245, 230, 0.5); }
.break {
  background: linear-gradient(90deg, #c0392b 20%, #f1c40f 40%, #27ae60 60%, #c0392b 80%);
  box-shadow: 0 2px 8px rgba(192, 57, 43, 0.4);
}
.inscoin { border: 2px solid #c0392b; background: rgba(255, 245, 230, 0.6); }
.vcCodeHolder { border: 2px dashed #f1c40f; background: rgba(255, 245, 230, 0.8); }
.convertVoucherBlock { border: 2px dashed #c0392b; background: rgba(255, 245, 230, 0.8); }
.status-holder { color: #2c1810; text-shadow: none; background: rgba(255, 245, 230, 0.5); }
#insertBtn {
  background: linear-gradient(90deg, #c0392b, #f1c40f);
  box-shadow: 0 4px 15px rgba(192, 57, 43, 0.5);
  color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  border: 2px solid #f1c40f; font-weight: bold; letter-spacing: 1px;
}
#promoRateBtn {
  background: #27ae60; color: #fff !important;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
  border: 2px solid #f1c40f; box-shadow: 0 4px 12px rgba(39, 174, 96, 0.4);
}
#chargingBtn {
  background: #c0392b; color: #fff !important;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
  border: 2px solid #f1c40f; box-shadow: 0 4px 12px rgba(192, 57, 43, 0.4);
}
#eloadBtn {
  background: #f1c40f; color: #2c1810 !important;
  text-shadow: none !important; border: 2px solid #c0392b;
  box-shadow: 0 4px 12px rgba(241, 196, 15, 0.5);
}
#memberLoginBtn {
  background: transparent; color: #c0392b !important;
  border: 2px solid #c0392b; text-shadow: none !important;
}
#connectBtn {
  background: linear-gradient(90deg, #27ae60, #c0392b);
  color: #fff !important; border: 2px solid #f1c40f;
  box-shadow: 0 4px 15px rgba(39, 174, 96, 0.5);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important; font-weight: bold;
}
#scanQrBtn { background: #f1c40f; color: #2c1810 !important; text-shadow: none !important; border: 2px solid #c0392b; }
.form-group { border: 2px solid #c0392b; background: rgba(255, 245, 230, 0.5); }
.form-control, #vendoSelected {
  background: #fffcf0 !important; color: #2c1810 !important;
  border: 1px solid #c0392b !important;
}
.form-control::placeholder { color: #a87070 !important; }
.form-control:focus, #vendoSelected:focus {
  background: #fff !important; border-color: #f1c40f !important;
  box-shadow: 0 0 8px rgba(241, 196, 15, 0.4) !important;
}
#vendoSelectDiv { border: 2px solid #c0392b; background: rgba(255, 245, 230, 0.5); }
#vendoSelectDiv label { color: #c0392b !important; font-weight: bold; }
.modal-content {
  background: #fffcf0 !important; color: #2c1810 !important;
  border: 3px solid #c0392b; box-shadow: 0 10px 40px rgba(192, 57, 43, 0.4);
}
.modal-header, .modal-footer { border-color: #c0392b !important; }
.modal-title { color: #c0392b !important; }
.close span { color: #c0392b !important; }
.modal { z-index: 1500 !important; }
.modal-backdrop { pointer-events: none !important; opacity: 0.5 !important; }
.modal-content { position: relative !important; z-index: 1502 !important; }
.modal-content { display: flex !important; flex-direction: column !important; max-height: calc(100vh - 32px) !important; border: 3px solid #c0392b !important; }
.modal-header, .modal-footer { flex-shrink: 0 !important; }
.modal-header { background: #faf0ca !important; }
.modal-content .modal-header .close span { color: #c0392b !important; }
.modal-body { overflow-y: auto !important; min-height: 0 !important; flex: 1 !important; }
.modal-body .inscoinholder { height: 50px !important; margin-top: 10px !important; }
.modal-body .vcCodeHolder { height: 90px !important; }
.modal-body .convertVoucherBlock { height: 142px !important; }
.inscoinholder { background: rgba(255, 245, 230, 0.6) !important; }
.vcCodeHolder { background: rgba(255, 245, 230, 0.8) !important; }
.convertVoucherBlock { background: rgba(255, 245, 230, 0.8) !important; }
.inscoinholder span { color: #a87070 !important; }
.modal-footer.bg-light { background-color: #fffcf0 !important; }
.btn-outline-danger { background: transparent !important; color: #c0392b !important; border-color: #c0392b !important; }
.btn-outline-danger:hover, .btn-outline-danger:focus, .btn-outline-danger:active { background: #c0392b !important; color: #fff !important; }
.progress { background-color: #faf0ca !important; }
.btn-primary { background: #c0392b !important; border-color: #c0392b !important; }
.btn-success { background: #27ae60 !important; border-color: #27ae60 !important; color: #fff !important; }
.btn-danger { background: #c0392b !important; border-color: #c0392b !important; }
.btn-warning { background: #f1c40f !important; border-color: #f1c40f !important; color: #2c1810 !important; }
.btn-info { background: #27ae60 !important; border-color: #27ae60 !important; color: #fff !important; }
.btn-secondary { background: transparent !important; color: #c0392b !important; border: 1px solid #c0392b !important; }
.btn-default { background: transparent !important; color: #c0392b !important; border: 1px solid #c0392b !important; }
.footer { border: 2px solid #c0392b; color: #2c1810; background: rgba(255, 245, 230, 0.5); }
.footers a { color: #c0392b !important; }
.footers a:hover { color: #27ae60 !important; }
.memdiv { border: 2px solid #c0392b; background: rgba(255, 245, 230, 0.7); box-shadow: 0 4px 15px rgba(192, 57, 43, 0.3); }
.memdiv input { background: #fffcf0; color: #2c1810; border: 1px solid #c0392b; }
.memdiv span { color: #c0392b !important; }
.rholder { border-color: #c0392b; background: linear-gradient(90deg, #c0392b 8%, rgba(255, 253, 245, 0.9) 8%); }
.rdata { color: #2c1810; text-shadow: none; }
#codeGenerated { color: #27ae60 !important; text-shadow: none; }
#totalCoin, #totalTime, #expectedCoin { color: #c0392b !important; text-shadow: none; }
.progress-bar { background: linear-gradient(90deg, #c0392b, #f1c40f) !important; }
#noticeText { color: #c0392b !important; }
#eloadConfirm, #eloadConfirm2 { color: #c0392b !important; text-shadow: none !important; }
.qrcode-wrapper { background: #fff; box-shadow: 0 4px 15px rgba(192, 57, 43, 0.3); border: 2px solid #f1c40f; }
      `.trim(),
    },
  },

  getThemeList() {
    return Object.values(this.themes);
  },

  getTheme(id) {
    return this.themes[id] || this.themes.default;
  },
};

if (typeof window !== 'undefined') {
  window.PortalThemes = PortalThemes;
}
