// dsh-forge/core/skins.js
// 仪表盘皮肤 token（零依赖）。dashboard.js 的样式表引用 var(--dsh-*) 变量；
// 切换皮肤只需替换 :root 变量块，布局与组件 CSS 完全不动，安全可回退。
// 默认 light 的取值与原硬编码样式一致，未注入变量块时也不会改变观感。

export const DEFAULT_SKIN = "light";

// 语义 token：key 为 camelCase，导出为 --dsh-<key> CSS 变量。
export const SKINS = {
  light: {
    bg: "#f4f6f8",
    surface: "#ffffff",
    text: "#222222",
    textStrong: "#555555",
    textNav: "#444444",
    textMuted: "#7a828b",
    textFaint: "#98a1aa",
    textSecondary: "#666666",
    border: "#e3e6ea",
    borderSoft: "#e7eaee",
    borderSofter: "#eef0f2",
    inputBorder: "#cfd5da",
    hover: "#f2f4f6",
    hoverRow: "#f7f9fb",
    brand: "#2e86c1",
    accent: "#1f6feb",
    accentHoverBg: "#eef5fc",
    accentBorder: "#cfe3f5",
    accentText: "#3a4a5a",
    sevBlocking: "#d64545",
    sevHigh: "#e67e22",
    sevMedium: "#f1c40f",
    sevLow: "#27ae60",
    sevDisabled: "#95a5a6",
    sevFatal: "#7a1f1f",
    sevError: "#d64545",
    sevVerified: "#16a085",
    rowBlocking: "#fdecea",
    rowHigh: "#fdf2e6",
    rowMedium: "#fdf8e3",
    verifiedBorder: "#b8e0d5",
    verifiedBg: "#f2fbf8",
    fbDisclaimerBg: "#f6f8fa",
    fbDisclaimerText: "#888888",
    tipBg: "#23272b",
    tipText: "#f4f6f8",
    track: "#eef0f2"
  },
  dark: {
    bg: "#16191d",
    surface: "#1f242b",
    text: "#e8eaed",
    textStrong: "#d0d4da",
    textNav: "#c2c6cc",
    textMuted: "#9aa4ae",
    textFaint: "#7a828b",
    textSecondary: "#b0b6bf",
    border: "#2b323b",
    borderSoft: "#343c46",
    borderSofter: "#2a3038",
    inputBorder: "#3a424d",
    hover: "#2a313a",
    hoverRow: "#252b33",
    brand: "#4a9fe0",
    accent: "#5aa7ef",
    accentHoverBg: "#223142",
    accentBorder: "#2d4a66",
    accentText: "#bcd6ee",
    sevBlocking: "#e06c6c",
    sevHigh: "#e8964a",
    sevMedium: "#e0c05a",
    sevLow: "#4db87d",
    sevDisabled: "#6b7279",
    sevFatal: "#c05a5a",
    sevError: "#e06c6c",
    sevVerified: "#2bb299",
    rowBlocking: "rgba(224,108,108,.14)",
    rowHigh: "rgba(232,150,74,.14)",
    rowMedium: "rgba(224,192,90,.14)",
    verifiedBorder: "#27503f",
    verifiedBg: "#1e2b28",
    fbDisclaimerBg: "#1d2228",
    fbDisclaimerText: "#9aa4ae",
    tipBg: "#0b0d10",
    tipText: "#e8eaed",
    track: "#2a3038"
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
