const fsp = require("fs").promises;
const path = require("path");
const {
  deserialize,
  serialize,
  getPrototypeOf,
  setPrototypeOf,
  kNBTConstructor,
  TagType
} = require("@xmcl/nbt");

const createNbtObject = () => ({});
const requiredEntrySchema = {
  [kNBTConstructor]: createNbtObject,
  hidden: TagType.Byte,
  ip: TagType.String,
  name: TagType.String,
  icon: TagType.String,
  acceptTextures: TagType.Byte
};

function formatServerAddress(host, port) {
  return Number(port) === 25565 ? host : `${host}:${port}`;
}

function mergeEntrySchema(entries) {
  let schema = requiredEntrySchema;
  for (const entry of entries) {
    const existing = getPrototypeOf(entry);
    if (!existing) continue;
    schema = {
      ...schema,
      ...existing,
      ...requiredEntrySchema,
      [kNBTConstructor]: existing[kNBTConstructor] || schema[kNBTConstructor] || createNbtObject
    };
  }
  return schema;
}

function applyNbtPrototype(value, schema) {
  const existing = getPrototypeOf(value);
  if (existing) {
    Object.assign(existing, schema);
    return existing;
  }
  setPrototypeOf(value, schema);
  return schema;
}

async function updateServerResourcePackFile(file, server) {
  let serverList;
  try {
    serverList = await deserialize(await fsp.readFile(file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    serverList = { servers: [] };
  }
  if (!Array.isArray(serverList.servers)) {
    throw new Error("servers.dat의 servers 목록이 올바르지 않습니다.");
  }

  const entries = serverList.servers;
  const entrySchema = mergeEntrySchema(entries);
  const existingRootSchema = getPrototypeOf(serverList) || {};
  applyNbtPrototype(serverList, {
    ...existingRootSchema,
    servers: entrySchema,
    [kNBTConstructor]: existingRootSchema[kNBTConstructor] || createNbtObject
  });
  entries.forEach((entry) => applyNbtPrototype(entry, entrySchema));

  const host = String(server.host).trim();
  const port = Number(server.port) || 25565;
  const canonicalAddress = formatServerAddress(host, port);
  const targetAddresses = new Set([
    host.toLowerCase(),
    `${host}:${port}`.toLowerCase()
  ]);
  const matches = entries.filter((entry) => (
    targetAddresses.has(String(entry.ip || "").trim().toLowerCase())
  ));
  let changed = false;

  if (matches.length === 0) {
    const entry = {
      hidden: 0,
      ip: canonicalAddress,
      name: server.name || host,
      icon: "",
      acceptTextures: 1
    };
    applyNbtPrototype(entry, entrySchema);
    entries.push(entry);
    changed = true;
  } else {
    const canonical = matches.find((entry) => (
      String(entry.ip || "").trim().toLowerCase() === canonicalAddress.toLowerCase()
    )) || matches[0];
    if (canonical.ip !== canonicalAddress) {
      canonical.ip = canonicalAddress;
      changed = true;
    }
    if (canonical.acceptTextures !== 1) {
      canonical.acceptTextures = 1;
      changed = true;
    }
    if (matches.length > 1) {
      serverList.servers = entries.filter((entry) => entry === canonical || !matches.includes(entry));
      changed = true;
    }
  }
  if (!changed) return false;

  const temporary = `${file}.${process.pid}.tmp`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  try {
    await fsp.writeFile(temporary, Buffer.from(await serialize(serverList)));
    await fsp.rename(temporary, file);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
  return true;
}

module.exports = { formatServerAddress, updateServerResourcePackFile };
