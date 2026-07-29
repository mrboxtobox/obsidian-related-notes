/**
 * Test double for the `obsidian` module.
 *
 * The published `obsidian` package is types-only: its package.json has an empty
 * `main`, because the real API is injected by the Obsidian app at runtime. Any
 * test that transitively imports a src/ module therefore fails to resolve the
 * import ("Failed to resolve entry for package obsidian") unless the module is
 * aliased to a stub. vitest.config.ts points the `obsidian` specifier here.
 *
 * Only `normalizePath` is executed by the code under test; it is implemented to
 * match Obsidian's real behaviour. The classes exist so that value-position
 * imports resolve — the tested modules use them purely as types.
 */

/**
 * Mirrors Obsidian's normalizePath: converts backslashes to forward slashes,
 * collapses repeated separators, trims leading/trailing separators, and applies
 * Unicode NFC normalization. An empty result becomes "/".
 */
export function normalizePath(path: string): string {
	const trimmed = path.replace(/([\\/])+/g, "/").replace(/(^\/+|\/+$)/g, "");
	return trimmed === "" ? "/" : trimmed.normalize("NFC");
}

export class TFile {
	path = "";
	name = "";
	basename = "";
	extension = "";
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder {
	path = "";
	name = "";
	children: unknown[] = [];
}

export class Vault {}
export class Workspace {}
export class WorkspaceLeaf {}
export class App {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Notice {}
export class ItemView {}
export class MarkdownView {}
