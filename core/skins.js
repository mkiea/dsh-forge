// dsh-forge/core/skins.js
// 仪表盘皮肤 token（零依赖）。dashboard.js 的样式表引用 var(--dsh-*) 变量；
// 切换皮肤只需替换 :root 变量块，布局与组件 CSS 完全不动，安全可回退。
// 默认 dark：深色工作台更接近专业节点编辑器/分析台的观感；light 为同结构的高亮皮肤。

export const DEFAULT_SKIN = "dark";

// 语义 token：key 为 camelCase，导出为 --dsh-<key> CSS 变量。
export const SKINS = {
  light: {
    bg: "#f5f7fb",
    surface: "#ffffff",
    surfaceAlt: "#f8fafc",
    surfaceRaised: "#ffffff",
    headerBg: "rgba(255,255,255,.82)",
    navBg: "#fbfcfe",
    canvasBg: "#f7f9fc",
    canvasDot: "rgba(16,24,40,.10)",
    canvasLine: "rgba(16,24,40,.05)",
    text: "#101828",
    textStrong: "#1d2939",
    textNav: "#344054",
    textMuted: "#667085",
    textFaint: "#98a2b3",
    textSecondary: "#475467",
    border: "#e4e7ec",
    borderSoft: "#eef1f5",
    borderSofter: "#f2f4f7",
    inputBorder: "#d0d5dd",
    hover: "#f2f4f7",
    hoverRow: "#f9fafb",
    brand: "#4f6ef7",
    accent: "#4f6ef7",
    accentStrong: "#7c5cfc",
    accentHoverBg: "#eef1ff",
    accentBorder: "#d7ddff",
    accentText: "#4a5578",
    accentSoft: "#eef1ff",
    ring: "rgba(79,110,247,.35)",
    sevBlocking: "#ef4444",
    sevHigh: "#f59e0b",
    sevMedium: "#eab308",
    sevLow: "#10b981",
    sevDisabled: "#98a2b3",
    sevFatal: "#b42318",
    sevError: "#ef4444",
    sevVerified: "#059669",
    rowBlocking: "rgba(239,68,68,.05)",
    rowHigh: "rgba(245,158,11,.07)",
    rowMedium: "rgba(234,179,8,.07)",
    verifiedBorder: "rgba(16,185,129,.25)",
    verifiedBg: "rgba(236,253,245,.75)",
    fbDisclaimerBg: "#f8fafc",
    fbDisclaimerText: "#667085",
    tipBg: "#101828",
    tipText: "#f9fafb",
    track: "#eef1f5",
    tableHead: "#f8fafc",
    rowStripe: "rgba(16,24,40,.022)",
    shadow: "0 1px 2px rgba(16,24,40,.05), 0 16px 32px -20px rgba(16,24,40,.18)",
    shadowSm: "0 1px 2px rgba(16,24,40,.04)",
    shadowLg: "0 2px 6px rgba(16,24,40,.06), 0 30px 60px -34px rgba(16,24,40,.30)",
    surfaceSunken: "#eff3f9",
    borderStrong: "#d3d9e4",
    accentWash: "rgba(79,110,247,.06)",
    chartGrid: "rgba(16,24,40,.07)",
    sheen: "rgba(255,255,255,.9)"
  },
  dark: {
    bg: "#070a0f",
    surface: "#0f141b",
    surfaceAlt: "#0b1016",
    surfaceRaised: "#151c25",
    headerBg: "rgba(7,10,15,.78)",
    navBg: "#0b1017",
    canvasBg: "#080b10",
    canvasDot: "rgba(255,255,255,.075)",
    canvasLine: "rgba(255,255,255,.035)",
    text: "#e6ebf2",
    textStrong: "#f4f7fb",
    textNav: "#aeb8c8",
    textMuted: "#8a94a6",
    textFaint: "#5f6b7d",
    textSecondary: "#b6c0d0",
    border: "#212a36",
    borderSoft: "#1a2230",
    borderSofter: "#141b26",
    inputBorder: "#2a3546",
    hover: "#161e2a",
    hoverRow: "#111924",
    brand: "#7aa2ff",
    accent: "#6f8cff",
    accentStrong: "#9a7dff",
    accentHoverBg: "#151e33",
    accentBorder: "#2c3a5e",
    accentText: "#c3d1f2",
    accentSoft: "#131c2f",
    ring: "rgba(111,140,255,.38)",
    sevBlocking: "#ff6b6b",
    sevHigh: "#ffa94d",
    sevMedium: "#ffd43b",
    sevLow: "#34d399",
    sevDisabled: "#5f6b7d",
    sevFatal: "#ff8787",
    sevError: "#ff6b6b",
    sevVerified: "#2dd4bf",
    rowBlocking: "rgba(255,107,107,.10)",
    rowHigh: "rgba(255,169,77,.10)",
    rowMedium: "rgba(255,212,59,.09)",
    verifiedBorder: "rgba(45,212,191,.25)",
    verifiedBg: "rgba(6,78,59,.22)",
    fbDisclaimerBg: "#0c1219",
    fbDisclaimerText: "#8a94a6",
    tipBg: "#04070b",
    tipText: "#e6ebf2",
    track: "#1a2230",
    tableHead: "#0d141c",
    rowStripe: "rgba(255,255,255,.02)",
    shadow: "0 1px 0 rgba(255,255,255,.03) inset, 0 20px 44px -24px rgba(0,0,0,.8)",
    shadowSm: "0 1px 2px rgba(0,0,0,.4)",
    shadowLg: "0 1px 0 rgba(255,255,255,.04) inset, 0 34px 72px -34px rgba(0,0,0,.92)",
    surfaceSunken: "#080c12",
    borderStrong: "#2e3b4e",
    accentWash: "rgba(111,140,255,.10)",
    chartGrid: "rgba(255,255,255,.07)",
    sheen: "rgba(255,255,255,.06)"
  }
};

export const SKIN_LIST = Object.keys(SKINS);

// 把一个皮肤序列化成一条 --dsh-* 变量行（供皮肤变量块拼接）。
function skinLines(skin) {
  const t = SKINS[skin];
  return Object.keys(t).map(function (k) { return "  --dsh-" + k + ": " + t[k] + ";"; }).join("\n");
}

// 生成全部皮肤的 :root 变量块。默认皮肤挂在 :root，其余皮肤用
// :root[data-skin="..."]（specificity 更高）覆盖，切换 data-skin 即换肤。
export function skinCssVars() {
  const parts = [":root {\n" + skinLines(DEFAULT_SKIN) + "\n}"];
  for (const name of SKIN_LIST) {
    if (name === DEFAULT_SKIN) continue;
    parts.push(':root[data-skin="' + name + '"] {\n' + skinLines(name) + "\n}");
  }
  return parts.join("\n");
}
