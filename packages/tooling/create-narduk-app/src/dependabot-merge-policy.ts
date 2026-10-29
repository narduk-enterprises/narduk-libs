/** Fail closed on unsigned, mixed-author, major or unsupported Dependabot metadata. */
export const DEPENDABOT_MERGE_POLICY = String.raw`import json
import re
import sys

# Read only GitHub API data. Never import or execute anything from the PR.
head, branch, filename = sys.argv[1:]
with open(filename, encoding="utf-8") as source:
    commits = json.load(source)
eligible = isinstance(commits, list) and 0 < len(commits) <= 100
eligible = eligible and commits[-1].get("sha") == head
for entry in commits if eligible else []:
    author = entry.get("author") or {}
    committer = entry.get("committer") or {}
    commit = entry.get("commit") or {}
    eligible = eligible and author.get("id") == 49699333
    eligible = eligible and author.get("login") == "dependabot[bot]"
    eligible = eligible and author.get("type") == "Bot"
    # Genuine GitHub-signed Dependabot commits are committed by web-flow.
    eligible = eligible and committer.get("id") == 19864447
    eligible = eligible and committer.get("login") == "web-flow"
    eligible = eligible and committer.get("type") == "User"
    eligible = eligible and commit.get("verification", {}).get("verified") is True

message = commits[-1].get("commit", {}).get("message", "") if eligible else ""
blocks = re.findall(r"(?m)^---\n([\s\S]*?)^\.\.\.\s*$", message)
eligible = eligible and len(blocks) == 1
metadata = blocks[0] if len(blocks) == 1 else ""
names = re.findall(r"(?m)^- dependency-name: ([^\n]+)$", metadata)
types = re.findall(r"(?m)^  update-type: ([^\n]+)$", metadata)
groups = re.findall(r"(?m)^  dependency-group: ([^\n]+)$", metadata)
eligible = eligible and metadata.startswith("updated-dependencies:\n")
eligible = eligible and len(names) > 0 and len(types) == len(names)
eligible = eligible and all(value in ("version-update:semver-minor", "version-update:semver-patch") for value in types)
# The branch narrows the ecosystem, but never supplies the merge authority.
eligible = eligible and branch.startswith("dependabot/npm_and_yarn/")
eligible = eligible and ((len(groups) == len(names) and all(group == "safe" for group in groups)) or (not groups and len(names) == 1))
print("true" if eligible else "false")`
