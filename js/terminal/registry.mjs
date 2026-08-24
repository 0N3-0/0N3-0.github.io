function asciiLower(value) {
  return String(value).replace(/[A-Z]/gu, character => character.toLowerCase());
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeKey(value, field) {
  const normalized = typeof value === 'string' ? asciiLower(value) : '';
  if (!/^[a-z][a-z0-9-]*$/u.test(normalized)) {
    throw new TypeError(`Invalid command ${field}`);
  }
  return normalized;
}

function normalizeDefinition(definition) {
  if (!definition || typeof definition !== 'object') throw new TypeError('Invalid command definition');
  const name = normalizeKey(definition.name, 'name');
  if (definition.aliases !== undefined && !Array.isArray(definition.aliases)) {
    throw new TypeError('Invalid command aliases');
  }
  const aliases = (definition.aliases || []).map(alias => normalizeKey(alias, 'alias'));
  if (new Set([name, ...aliases]).size !== aliases.length + 1) {
    throw new Error(`Command conflict: ${name}`);
  }
  const order = definition.order === undefined ? 100 : definition.order;
  if (!Number.isFinite(order)) throw new TypeError('Invalid command order');
  if (definition.showInCompletion !== undefined && typeof definition.showInCompletion !== 'boolean') {
    throw new TypeError('Invalid command completion visibility');
  }
  if (typeof definition.usage !== 'string') throw new TypeError('Invalid command usage');
  if (typeof definition.description !== 'string') throw new TypeError('Invalid command description');
  if (typeof definition.complete !== 'function') throw new TypeError('Invalid command complete');
  if (typeof definition.execute !== 'function') throw new TypeError('Invalid command execute');
  const showInCompletion = definition.showInCompletion !== false;
  return Object.freeze({ ...definition, name, aliases: Object.freeze(aliases), order, showInCompletion });
}

function sameRange(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left[0] === right[0] && left[1] === right[1];
}

function isCandidate(candidate) {
  return candidate
    && typeof candidate.id === 'string'
    && typeof candidate.type === 'string'
    && typeof candidate.label === 'string'
    && typeof candidate.value === 'string'
    && typeof candidate.description === 'string';
}

function compareCandidate(left, right) {
  return compareText(left.value, right.value)
    || compareText(left.label, right.label)
    || compareText(left.type, right.type)
    || compareText(left.id, right.id);
}

export class CommandRegistry {
  #commands = new Map();
  #aliases = new Map();

  register(definition) {
    const normalized = normalizeDefinition(definition);
    const keys = [normalized.name, ...normalized.aliases];
    if (keys.some(key => this.#commands.has(key) || this.#aliases.has(key))) {
      throw new Error(`Command conflict: ${normalized.name}`);
    }
    this.#commands.set(normalized.name, normalized);
    for (const alias of normalized.aliases) this.#aliases.set(alias, normalized.name);
    return normalized;
  }

  resolve(value) {
    const key = asciiLower(value ?? '');
    return this.#commands.get(key) || this.#commands.get(this.#aliases.get(key));
  }

  list() {
    return [...this.#commands.values()].sort((left, right) => left.order - right.order || compareText(left.name, right.name));
  }

  complete(context = {}) {
    const parsed = context.parsed || context;
    if (parsed.error) return [];
    const firstToken = parsed.tokens?.[0];
    const completingCommand = !parsed.command || (firstToken && sameRange(firstToken.range, parsed.activeToken?.range));

    if (completingCommand) {
      return this.list().filter(command => command.showInCompletion).map(command => ({
        id: `command:${command.name}`,
        type: 'command',
        label: command.name,
        value: command.name,
        description: command.description
      }));
    }

    const command = this.resolve(parsed.command);
    if (!command) return [];
    const candidates = command.complete(context, Array.isArray(parsed.args) ? parsed.args : []);
    if (!Array.isArray(candidates)) return [];
    return candidates.filter(isCandidate).map(candidate => ({ ...candidate })).sort(compareCandidate);
  }
}
