/**
 * The declaration digest (spec 4.2): a hash of the catalog's SOURCE, because
 * the executable step bodies are part of the declaration - a prose-only
 * projection would call two behaviourally different catalogs identical. Files
 * are hashed as sorted (relative path, content) pairs so the digest is stable
 * across traversal order and machines.
 */
export declare function digestFiles(files: ReadonlyMap<string, Buffer | string>): string;
/** Digest every regular file under a catalog directory. */
export declare function digestDirectory(root: string): string;
//# sourceMappingURL=digest.d.ts.map