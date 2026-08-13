// dsh-forge/core/semver.js
// Minimal npm-compatible semver: parse, compare, satisfies.
// Supports: exact, ^, ~, >=, <=, >, <, =, *, x, space-separated AND,
// and '||' OR unions, with npm prerelease rules.
"use strict";

const NUM = /^\d+$/;

export function parseVersion(raw) {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v === "" || v === "*" || v === "x" || v === "X") return { any: true, raw: v, major: 0, minor: 0, patch: 0, prerelease: null };
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
  if (!m) return null;
  return {
    any: false,
    raw: v,
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : null
  };
}

// a < b => -1, a == b => 0, a > b => 1
export function compareVersions(a, b) {
  if (a.any || b.any) return 0;
  for (const k of ["major", "minor", "patch"]) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1; // release > prerelease
  if (!b.prerelease) return -1;
  const la = a.prerelease, lb = b.prerelease;
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] === undefined) return -1;
    if (lb[i] === undefined) return 1;
    if (la[i] === lb[i]) continue;
    const na = NUM.test(la[i]), nb = NUM.test(lb[i]);
    if (na && nb) return Number(la[i]) < Number(lb[i]) ? -1 : 1;
    if (na) return -1; // numeric identifiers sort below alphanumeric
    if (nb) return 1;
    return la[i] < lb[i] ? -1 : 1;
  }
  return 0;
}

// npm prerelease rule: a prerelease version only satisfies a comparator
// when the comparator carries a prerelease on the same [major,minor,patch]
// tuple, or (for >= / <= / =) when the tuples match exactly.
function prereleaseAllowed(ver, cmp) {
  if (!ver.prerelease) return true;
  if (cmp.prerelease) return sameTuple(ver, cmp);
  return sameTuple(ver, cmp);
}
function sameTuple(a, b) {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch;
}

function oneComparator(ver, op, cmpRaw) {
  const cmp = parseVersion(cmpRaw);
  if (!cmp) return null; // unparseable: unknown
  if (cmp.any) {
    // '*' style: any release; prereleases excluded unless the comparator
    // itself is a prerelease (cannot be for '*'), so prerelease fails.
    return !ver.prerelease;
  }
  const c = compareVersions(ver, cmp);
  switch (op) {
    case "=": {
      if (!sameTuple(ver, cmp)) return false;
      if (ver.prerelease || cmp.prerelease) {
        if (!!ver.prerelease !== !!cmp.prerelease) return false;
        return c === 0;
      }
      return c === 0;
    }
    case ">": {
      if (ver.prerelease && !cmp.prerelease && !sameTuple(ver, cmp)) return false;
      return c > 0;
    }
    case "<": {
      if (ver.prerelease && !cmp.prerelease && !sameTuple(ver, cmp)) return false;
      return c < 0;
    }
    case ">=": {
      if (ver.prerelease && !cmp.prerelease && !sameTuple(ver, cmp)) return false;
      return c >= 0;
    }
    case "<=": {
      if (ver.prerelease && !cmp.prerelease && !sameTuple(ver, cmp)) return false;
      return c <= 0;
    }
    case "^": {
      if (!prereleaseAllowed(ver, cmp)) return false;
      if (c < 0) return false;
      // caret: < next breaking version
      let nextMajor = cmp.major, nextMinor = 0, nextPatch = 0;
      if (cmp.major > 0) { nextMajor = cmp.major + 1; nextMinor = 0; nextPatch = 0; }
      else if (cmp.minor > 0) { nextMajor = 0; nextMinor = cmp.minor + 1; nextPatch = 0; }
      else { nextMajor = 0; nextMinor = 0; nextPatch = cmp.patch + 1; }
      return compareVersions(ver, { any: false, raw: "", major: nextMajor, minor: nextMinor, patch: nextPatch, prerelease: null }) < 0;
    }
    case "~": {
      if (!prereleaseAllowed(ver, cmp)) return false;
      if (c < 0) return false;
      const nextMinor = cmp.minor + 1;
      return compareVersions(ver, { any: false, raw: "", major: cmp.major, minor: nextMinor, patch: 0, prerelease: null }) < 0;
    }
    default:
      return null;
  }
}

function andClause(ver, clause) {
  // clause: "op version" tokens separated by spaces
  const parts = clause.trim().split(/\s+/);
  let ok = true;
  for (const p of parts) {
    const m = /^(\^|~|>=|<=|>|<|=)?\s*([^\s]+)$/.exec(p);
    if (!m) { ok = false; break; }
    const op = m[1] || "=";
    const r = oneComparator(ver, op, m[2]);
    if (r === null) { ok = false; break; }
    if (!r) { ok = false; break; }
  }
  return ok;
}

// returns true / false / null(unknown due to unparseable range)
export function satisfies(versionRaw, rangeRaw) {
  const ver = parseVersion(versionRaw);
  if (!ver) return null;
  const range = String(rangeRaw).trim();
  if (range === "" || range === "*") return !ver.prerelease;
  const unions = range.split("||").map((s) => s.trim());
  let anyOk = false, unknown = false;
  for (const u of unions) {
    const r = andClause(ver, u);
    if (r === null) { unknown = true; continue; }
    if (r) { anyOk = true; break; }
  }
  if (anyOk) return true;
  return unknown ? null : false;
}

// highest version among a list that satisfies the range (for resolution hints)
export function maxSatisfying(versions, rangeRaw) {
  let best = null;
  for (const v of versions) {
    const r = satisfies(v, rangeRaw);
    if (r === true) {
      const p = parseVersion(v);
      if (!best || compareVersions(p, parseVersion(best)) > 0) best = v;
    }
  }
  return best;
}
