import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// pnpm resolves workspace dependencies asynchronously while packing: identical
// manifests can acquire a different dependency-key order. Compare the complete
// archive contents, canonicalizing only package/package.json object-key order.
// Every other file remains byte-exact; member paths, modes, types and links are
// part of the proof. Transport headers and member order are not installed input.
export function packedInput(path) {
  const digest = execFileSync(
    'python3',
    [
      '-c',
      `
import hashlib, json, sys, tarfile

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result: raise ValueError("Duplicate manifest key")
        result[key] = value
    return result

entries = []
seen = set()
with tarfile.open(sys.argv[1], "r:gz") as archive:
    for member in archive:
        if member.name in seen: raise ValueError("Duplicate archive path")
        seen.add(member.name)
        if member.name.startswith("/") or ".." in member.name.split("/"):
            raise ValueError("Unsafe archive path")
        if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
            raise ValueError("Unsupported archive member")
        content = b""
        if member.isfile():
            content = archive.extractfile(member).read()
            if member.name == "package/package.json":
                content = json.dumps(json.loads(content, object_pairs_hook=unique_object), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
        entries.append([member.name, member.type.decode(), member.mode, member.uid, member.gid, member.linkname, hashlib.sha256(content).hexdigest()])
print(hashlib.sha256(json.dumps(sorted(entries), separators=(",", ":")).encode()).hexdigest())
`,
      path,
    ],
    { encoding: 'utf8', maxBuffer: 4096, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim()
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error('Invalid packed input digest')
  return {
    digest,
    integrity: `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`,
  }
}

// Replace only checksums of the freshly packed local archives. Registry
// resolutions, URLs, versions, peer contexts and all other lockfile bytes stay
// exact. This representation is used for comparison only, never for installing.
export function consumerLockDigest(path, packedInputs) {
  let content = readFileSync(path, 'utf8')
  for (const { integrity, digest } of packedInputs.values()) {
    content = content.replaceAll(integrity, `packed-content-sha256-${digest}`)
  }
  return createHash('sha256').update(content).digest('hex')
}
