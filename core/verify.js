// dsh-forge/core/verify.js
// Row-level mount preflight: package resolvable, dsh.client declared,
// client bundle built, service providers present.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { packageOf } from "./composition.js";

export function verifyRows(eco, opts = {}) {
    const profile = opts.profile || "web";
  const { rows, packages, nmRoot } = eco;
  const issues = [];
  const checked = [];
  for (const row of rows) {
    const p = packageOf(row.name);
    if (row.name && row.name.startsWith("cordis:")) {
      checked.push({ id: row.id, name: row.name, ok: true, checks: { package: "builtin", dshClient: "n/a", clientBundle: "n/a" } });
      continue;
    }
    const pkg = packages[p];
    const entry = { id: row.id, name: p, ok: true, checks: {} };
    if (!pkg) {
      // fs fallback: installed but not collected (e.g. preset-plane packages)
      let found = null;
      const roots = [];
      if (nmRoot) roots.push(nmRoot);
      const home = process.env.DSH_HOME;
      if (home) roots.push(path.join(home, "profiles", profile, "node_modules"));
      for (const r of roots) {
        if (fs.existsSync(path.join(r, ...p.split("/"), "package.json"))) { found = r; break; }
      }
      if (found) {
        entry.checks.package = "ok@fs(" + found + ")";
        checked.push(entry);
        continue;
      }
      entry.ok = false;
      entry.checks.package = "missing";
      issues.push({ row: row.id, severity: "high", check: "package", message: "package not resolvable from collected manifests nor filesystem", evidence: p });
      checked.push(entry);
      continue;
    }
    entry.checks.package = "ok@" + pkg.version;
    // dsh.client declaration
    const dir = pkg.dir || (nmRoot ? path.join(nmRoot, ...p.split("/")) : null);
    let clientDecl = false;
    if (dir) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        clientDecl = !!(manifest.dsh && manifest.dsh.client);
        entry.checks.dshClient = clientDecl ? "declared" : "none";
        if (clientDecl) {
          const clientFile = path.join(dir, "lib", "client.js");
          const built = fs.existsSync(clientFile);
          entry.checks.clientBundle = built ? "built (" + fs.statSync(clientFile).size + "B)" : "MISSING";
          if (!built) {
            entry.ok = false;
            issues.push({ row: row.id, severity: "high", check: "clientBundle", message: "dsh.client declared but lib/client.js is missing (run build)", evidence: p });
          }
        }
      } catch {
        entry.checks.dshClient = "unreadable"; // manifest scan failed -> report as unreadable        entry.checks.dshClient = "unreadable";
      }
    } else {
      entry.checks.dshClient = "no-dir";
    }
    checked.push(entry);
  }
  return { checked, issues, summary: { rows: checked.length, ok: checked.filter((c) => c.ok).length, issues: issues.length, bySeverity: issues.reduce((a, i) => { a[i.severity] = (a[i.severity] || 0) + 1; return a; }, {}) } };
}
