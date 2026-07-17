const fsp = require("fs").promises;
const path = require("path");
const {
  deserialize,
  serialize,
  getPrototypeOf,
  TagType
} = require("@xmcl/nbt");

const requiredEntrySchema = {
  hidden: TagType.Byte,
  ip: TagType.String,
  name: TagType.String,
  icon: TagType.String,
  acceptTextures: TagType.Byte
};

function formatServerAddress(host, port) {
  return Number(port) === 25565 ? host : `${host}:${port}`;
}

async function createServerListType(fileData) {
  const discoveredSchema = {};
  if (fileData) {
    const raw = await deserialize(fileData);
    for (const entry of Array.isArray(raw.servers) ? raw.servers : []) {
      Object.assign(discoveredSchema, getPrototypeOf(entry) || {});
    }
  }

  class ServerEntry {}
  for (const [key, type] of Object.entries({ ...discoveredSchema, ...requiredEntrySchema })) {
    TagType(type)(ServerEntry.prototype, key);
  }
  class ServerList {
    constructor() {
      this.servers = [];
    }
  }
  TagType([ServerEntry])(ServerList.prototype, "servers");
  return ServerList;
}

async function updateServerResourcePackFile(file, server) {
  let fileData;
  try {
    fileData = await fsp.readFile(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const ServerList = await createServerListType(fileData);
  const serverList = fileData
    ? await deserialize(fileData, { type: ServerList })
    : new ServerList();
  if (!Array.isArray(serverList.servers)) {
    throw new Error("servers.dat의 servers 목록이 올바르지 않습니다.");
  }

  const entries = serverList.servers;

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
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index] !== canonical && matches.includes(entries[index])) entries.splice(index, 1);
      }
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
