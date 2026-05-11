import nbt from "prismarine-nbt";
import type { Tags, TagType } from "prismarine-nbt";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import { assertSafeRegexPattern } from "../../../../shared/validation/regex-safety";
import type {
  NbtKeyInfo,
  NbtPort,
  NbtStructureEntry,
  NbtValue,
} from "../../domain/ports/nbt.port";
import { NbtFileNotFoundError } from "../../domain/errors/nbt-file-not-found.error";
import { NbtPathNotFoundError } from "../../domain/errors/nbt-path-not-found.error";

type NbtTag = Tags[TagType];

export class PrismarineNbtAdapter implements NbtPort {
  constructor(private readonly logger: LoggerPort) {}

  async read(filePath: string, depth: number): Promise<NbtValue> {
    const parsed = await this.parseFile(filePath);
    const truncated = this.truncate(parsed, depth);
    this.logger.info("nbt.adapter.read", { filePath, depth });
    return { type: parsed.type, value: truncated };
  }

  async get(filePath: string, dotPath: string): Promise<NbtValue> {
    const parsed = await this.parseFile(filePath);
    const tag = this.navigateToPath(parsed, dotPath, filePath);
    this.logger.info("nbt.adapter.get", { filePath, dotPath });
    return { type: tag.type, value: this.simplify(tag) };
  }

  async search(
    filePath: string,
    pattern: string,
    limit: number,
  ): Promise<string[]> {
    const parsed = await this.parseFile(filePath);
    assertSafeRegexPattern(pattern);
    const regex = new RegExp(pattern, "i");
    const matches: string[] = [];
    this.collectMatches(parsed, "", regex, limit, matches);
    this.logger.info("nbt.adapter.search", {
      filePath,
      pattern,
      resultCount: matches.length,
    });
    return matches;
  }

  async keys(
    filePath: string,
    dotPath: string | undefined,
  ): Promise<NbtKeyInfo[]> {
    const parsed = await this.parseFile(filePath);
    let target: NbtTag = parsed;

    if (dotPath !== undefined && dotPath.length > 0) {
      target = this.navigateToPath(parsed, dotPath, filePath);
    }

    const childKeys = this.getChildKeys(target);
    this.logger.info("nbt.adapter.keys", {
      filePath,
      dotPath: dotPath ?? "",
      keyCount: childKeys.length,
    });
    return childKeys;
  }

  async structure(
    filePath: string,
    depth: number,
  ): Promise<NbtStructureEntry[]> {
    const parsed = await this.parseFile(filePath);
    const entries: NbtStructureEntry[] = [];
    this.collectStructure(parsed, "", depth, entries);
    this.logger.info("nbt.adapter.structure", {
      filePath,
      depth,
      entryCount: entries.length,
    });
    return entries;
  }

  private async parseFile(filePath: string): Promise<NbtTag> {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      throw new NbtFileNotFoundError(filePath);
    }

    const buffer = await file.arrayBuffer();
    try {
      const { parsed } = await nbt.parse(buffer);
      return parsed as unknown as NbtTag;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse NBT file (${filePath}): ${message}`);
    }
  }

  private navigateToPath(
    root: NbtTag,
    dotPath: string,
    filePath: string,
  ): NbtTag {
    const segments = dotPath.split(".");
    let current: NbtTag = root;

    for (const segment of segments) {
      if (current.type === "compound") {
        const compound = current as Tags[TagType.Compound];
        const children = compound.value as Record<string, NbtTag | undefined>;
        const child = children[segment];
        if (child === undefined) {
          throw new NbtPathNotFoundError(filePath, dotPath);
        }
        current = child;
      } else if (current.type === "list") {
        const list = current as Tags[TagType.List];
        const index = Number.parseInt(segment, 10);
        if (
          Number.isNaN(index) ||
          index < 0 ||
          index >= (list.value.value as NbtTag[]).length
        ) {
          throw new NbtPathNotFoundError(filePath, dotPath);
        }
        current = (list.value.value as NbtTag[])[index]!;
      } else {
        throw new NbtPathNotFoundError(filePath, dotPath);
      }
    }

    return current;
  }

  private truncate(tag: NbtTag, depth: number): unknown {
    if (depth <= 0) {
      return this.typeHint(tag);
    }

    if (tag.type === "compound") {
      const compound = tag as Tags[TagType.Compound];
      const entries = compound.value as Record<string, NbtTag>;
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(entries)) {
        result[key] = this.truncate(child, depth - 1);
      }
      return result;
    }

    if (tag.type === "list") {
      const list = tag as Tags[TagType.List];
      const items = list.value.value as NbtTag[];
      return items.map((item) => this.truncate(item, depth - 1));
    }

    return this.simplify(tag);
  }

  private simplify(tag: NbtTag): unknown {
    if (tag.type === "compound") {
      const compound = tag as Tags[TagType.Compound];
      const entries = compound.value as Record<string, NbtTag>;
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(entries)) {
        result[key] = this.simplify(child);
      }
      return result;
    }

    if (tag.type === "list") {
      const list = tag as Tags[TagType.List];
      const items = list.value.value as NbtTag[];
      return items.map((item) => this.simplify(item));
    }

    return (tag as { value: unknown }).value;
  }

  private typeHint(tag: NbtTag): string {
    if (tag.type === "compound") {
      const compound = tag as Tags[TagType.Compound];
      const keys = Object.keys(compound.value as Record<string, NbtTag>);
      return `{compound, ${keys.length} keys: [${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ", ..." : ""}]}`;
    }
    if (tag.type === "list") {
      const list = tag as Tags[TagType.List];
      const items = list.value.value as NbtTag[];
      return `[list<${list.value.type}>, ${items.length} items]`;
    }
    return `{${tag.type}}`;
  }

  private collectMatches(
    tag: NbtTag,
    path: string,
    regex: RegExp,
    limit: number,
    results: string[],
  ): void {
    if (results.length >= limit) return;

    if (tag.type === "compound") {
      const compound = tag as Tags[TagType.Compound];
      const entries = compound.value as Record<string, NbtTag>;
      for (const [key, child] of Object.entries(entries)) {
        if (results.length >= limit) break;
        const childPath = path.length > 0 ? `${path}.${key}` : key;
        if (regex.test(key)) {
          results.push(childPath);
        }
        this.collectMatches(child, childPath, regex, limit, results);
      }
    } else if (tag.type === "list") {
      const list = tag as Tags[TagType.List];
      const items = list.value.value as NbtTag[];
      for (let i = 0; i < items.length; i++) {
        if (results.length >= limit) break;
        const childPath = path.length > 0 ? `${path}.${i}` : String(i);
        this.collectMatches(
          items[i]!,
          childPath,
          regex,
          limit,
          results,
        );
      }
    }
  }

  private getChildKeys(tag: NbtTag): NbtKeyInfo[] {
    if (tag.type === "compound") {
      const compound = tag as Tags[TagType.Compound];
      const entries = compound.value as Record<string, NbtTag>;
      return Object.entries(entries).map(([key, child]) => ({
        key,
        type: child.type,
      }));
    }

    if (tag.type === "list") {
      const list = tag as Tags[TagType.List];
      const items = list.value.value as NbtTag[];
      return items.map((_item, index) => ({
        key: String(index),
        type: list.value.type,
      }));
    }

    return [];
  }

  private collectStructure(
    tag: NbtTag,
    path: string,
    depth: number,
    entries: NbtStructureEntry[],
  ): void {
    if (depth <= 0) return;

    if (tag.type === "compound") {
      const compound = tag as Tags[TagType.Compound];
      const children = compound.value as Record<string, NbtTag>;
      for (const [key, child] of Object.entries(children)) {
        const childPath = path.length > 0 ? `${path}.${key}` : key;
        entries.push({ path: childPath, type: child.type });
        this.collectStructure(child, childPath, depth - 1, entries);
      }
    } else if (tag.type === "list") {
      const list = tag as Tags[TagType.List];
      const items = list.value.value as NbtTag[];
      entries.push({
        path: path.length > 0 ? path : "(root)",
        type: `list<${list.value.type}>, ${items.length} items`,
      });
      const limit = Math.min(items.length, 5);
      for (let i = 0; i < limit; i++) {
        const childPath = path.length > 0 ? `${path}.${i}` : String(i);
        entries.push({ path: childPath, type: list.value.type });
        this.collectStructure(items[i]!, childPath, depth - 1, entries);
      }
      if (items.length > 5) {
        entries.push({
          path: `${path}[...${items.length - 5} more]`,
          type: list.value.type,
        });
      }
    }
  }
}
